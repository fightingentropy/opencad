import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  base64ToBytes,
  bytesToBase64,
  canWrite,
  COLLAB_LIMITS,
  COLLAB_PROTOCOL_VERSION,
  type CollaborationIdentity,
  type CollaborationPresence,
  type CollaborationServerMessage,
} from './protocol';

const REMOTE_ORIGIN = Symbol('opencad-durable-collaboration');
const READY_TIMEOUT_MS = 12_000;
const RECONNECT_MAX_MS = 30_000;

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIdentity = (value: unknown): value is CollaborationIdentity =>
  isRecord(value)
  && typeof value.userId === 'string'
  && typeof value.name === 'string'
  && typeof value.color === 'string'
  && (value.role === 'owner' || value.role === 'editor' || value.role === 'viewer')
  && (value.email === undefined || typeof value.email === 'string');

const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const parseServerMessage = (raw: string): CollaborationServerMessage => {
  if (new TextEncoder().encode(raw).byteLength > COLLAB_LIMITS.serverFrameBytes) {
    throw new Error('Collaboration response exceeds the client limit');
  }
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Invalid collaboration response');
  if (
    value.type === 'welcome'
    && value.protocol === COLLAB_PROTOCOL_VERSION
    && typeof value.connectionId === 'string'
    && numeric(value.presenceId)
    && isIdentity(value.identity)
    && typeof value.update === 'string'
    && numeric(value.lastSequence)
  ) return {
    type: 'welcome',
    protocol: COLLAB_PROTOCOL_VERSION,
    connectionId: value.connectionId,
    presenceId: value.presenceId,
    identity: value.identity,
    update: value.update,
    lastSequence: value.lastSequence,
  };
  if (
    value.type === 'update'
    && numeric(value.sequence)
    && typeof value.actorId === 'string'
    && typeof value.update === 'string'
  ) return { type: 'update', sequence: value.sequence, actorId: value.actorId, update: value.update };
  if (
    value.type === 'ack'
    && typeof value.idempotencyKey === 'string'
    && numeric(value.sequence)
    && typeof value.duplicate === 'boolean'
  ) return {
    type: 'ack',
    idempotencyKey: value.idempotencyKey,
    sequence: value.sequence,
    duplicate: value.duplicate,
  };
  if (
    value.type === 'presence'
    && typeof value.connectionId === 'string'
    && numeric(value.presenceId)
    && isIdentity(value.identity)
    && isRecord(value.presence)
  ) return {
    type: 'presence',
    connectionId: value.connectionId,
    presenceId: value.presenceId,
    identity: value.identity,
    presence: toPresence(value.presence) ?? {},
  };
  if (value.type === 'leave' && typeof value.connectionId === 'string' && numeric(value.presenceId)) {
    return { type: 'leave', connectionId: value.connectionId, presenceId: value.presenceId };
  }
  if (
    value.type === 'error'
    && (
      value.code === 'bad-message'
      || value.code === 'forbidden'
      || value.code === 'too-large'
      || value.code === 'rate-limited'
      || value.code === 'server-error'
    )
    && typeof value.message === 'string'
  ) return { type: 'error', code: value.code, message: value.message };
  throw new Error('Invalid collaboration response');
};

const makeWebSocketUrl = (endpoint: string, room: string): URL => {
  const base = new URL(endpoint, window.location.href);
  if (base.protocol === 'https:') base.protocol = 'wss:';
  else if (base.protocol === 'http:') base.protocol = 'ws:';
  if (base.protocol !== 'wss:' && !(base.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new Error('Authenticated collaboration requires HTTPS (or localhost for development)');
  }
  const prefix = base.pathname.replace(/\/$/, '');
  base.pathname = `${prefix}/v1/rooms/${encodeURIComponent(room)}/websocket`;
  base.search = '';
  base.hash = '';
  return base;
};

const toPresence = (value: Record<string, unknown> | null): CollaborationPresence | null => {
  if (!value) return null;
  const presence: CollaborationPresence = {};
  if (typeof value.sheetId === 'string') presence.sheetId = value.sheetId;
  if (isRecord(value.cursor) && typeof value.cursor.x === 'number' && typeof value.cursor.y === 'number') {
    presence.cursor = { x: value.cursor.x, y: value.cursor.y };
  }
  if (Array.isArray(value.selection)) {
    presence.selection = value.selection.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value.ts === 'number') presence.ts = value.ts;
  return presence;
};

export class AuthenticatedDurableProvider {
  readonly awareness: Awareness;
  readonly ready: Promise<CollaborationIdentity>;

  private socket: WebSocket | null = null;
  private destroyed = false;
  private welcomed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveReady!: (identity: CollaborationIdentity) => void;
  private rejectReady!: (error: Error) => void;
  private readySettled = false;
  private identityValue: CollaborationIdentity | null = null;
  private readonly pendingUpdates = new Map<string, string>();
  private readonly remotePresenceIds = new Set<number>();

  constructor(
    private readonly endpoint: string,
    private readonly room: string,
    private readonly doc: Y.Doc,
  ) {
    this.awareness = new Awareness(doc);
    this.ready = new Promise<CollaborationIdentity>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.doc.on('update', this.onDocumentUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.readyTimer = setTimeout(() => {
      if (this.readySettled) return;
      this.readySettled = true;
      this.rejectReady(new Error('Authenticated collaboration did not complete the Cloudflare Access handshake'));
      this.destroy();
    }, READY_TIMEOUT_MS);
    this.connect();
  }

  get identity(): CollaborationIdentity | null {
    return this.identityValue;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.doc.off('update', this.onDocumentUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.socket?.close(1000, 'client disconnect');
    this.socket = null;
    this.clearRemotePresence();
    this.awareness.destroy();
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error('Collaboration disconnected before authentication completed'));
    }
  }

  private connect(): void {
    if (this.destroyed) return;
    const socket = new WebSocket(makeWebSocketUrl(this.endpoint, this.room));
    this.socket = socket;
    this.welcomed = false;
    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        this.handleMessage(parseServerMessage(event.data));
      } catch (error) {
        console.error('[opencad] rejected malformed collaboration response', error);
        socket.close(1002, 'invalid server message');
      }
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.welcomed = false;
      this.clearRemotePresence();
      if (!this.destroyed) this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // The close event drives bounded reconnect/backoff and the initial
      // handshake timeout surfaces a useful error to the UI.
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(message: CollaborationServerMessage): void {
    if (message.type === 'welcome') {
      if (message.protocol !== COLLAB_PROTOCOL_VERSION) throw new Error('Unsupported collaboration protocol');
      Y.applyUpdate(this.doc, base64ToBytes(message.update, COLLAB_LIMITS.roomSnapshotBytes), REMOTE_ORIGIN);
      this.identityValue = message.identity;
      this.welcomed = true;
      if (!this.readySettled) {
        this.readySettled = true;
        if (this.readyTimer) clearTimeout(this.readyTimer);
        this.resolveReady(message.identity);
      }
      this.flushPendingUpdates();
      this.sendPresence();
      return;
    }
    if (message.type === 'update') {
      Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE_ORIGIN);
      return;
    }
    if (message.type === 'ack') {
      this.pendingUpdates.delete(message.idempotencyKey);
      return;
    }
    if (message.type === 'presence') {
      this.applyRemotePresence(message.presenceId, {
        ...message.presence,
        userId: message.identity.userId,
        name: message.identity.name,
        color: message.identity.color,
      });
      return;
    }
    if (message.type === 'leave') {
      this.removeRemotePresence(message.presenceId);
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'forbidden') {
        console.warn('[opencad] the collaboration server rejected a write for this viewer session');
      } else {
        console.warn(`[opencad] collaboration server error: ${message.code}`);
      }
    }
  }

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (
      origin === REMOTE_ORIGIN
      || this.destroyed
      || (this.identityValue && !canWrite(this.identityValue.role))
    ) return;
    const idempotencyKey = crypto.randomUUID();
    const frame = JSON.stringify({
      type: 'update',
      idempotencyKey,
      update: bytesToBase64(update),
    });
    this.pendingUpdates.set(idempotencyKey, frame);
    this.send(frame);
  };

  private readonly onAwarenessUpdate = (
    change: AwarenessChange,
    origin: unknown,
  ): void => {
    if (origin === REMOTE_ORIGIN || this.destroyed) return;
    const changedLocal = [...change.added, ...change.updated, ...change.removed]
      .includes(this.awareness.clientID);
    if (changedLocal) this.sendPresence();
  };

  private sendPresence(): void {
    const presence = toPresence(this.awareness.getLocalState());
    this.send(JSON.stringify({ type: 'presence', presence }));
  }

  private send(frame: string): void {
    if (!this.welcomed || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(frame);
  }

  private flushPendingUpdates(): void {
    for (const frame of this.pendingUpdates.values()) this.send(frame);
  }

  private applyRemotePresence(presenceId: number, state: Record<string, unknown>): void {
    if (!Number.isInteger(presenceId) || presenceId < 1 || presenceId > 0xffff_ffff) return;
    if (presenceId === this.awareness.clientID) return;
    const existed = this.awareness.states.has(presenceId);
    const clock = (this.awareness.meta.get(presenceId)?.clock ?? -1) + 1;
    this.awareness.states.set(presenceId, state);
    this.awareness.meta.set(presenceId, { clock, lastUpdated: Date.now() });
    this.remotePresenceIds.add(presenceId);
    const change: AwarenessChange = {
      added: existed ? [] : [presenceId],
      updated: existed ? [presenceId] : [],
      removed: [],
    };
    this.awareness.emit('change', [change, REMOTE_ORIGIN]);
  }

  private removeRemotePresence(presenceId: number): void {
    if (!this.remotePresenceIds.delete(presenceId)) return;
    this.awareness.states.delete(presenceId);
    this.awareness.meta.delete(presenceId);
    this.awareness.emit('change', [{ added: [], updated: [], removed: [presenceId] }, REMOTE_ORIGIN]);
  }

  private clearRemotePresence(): void {
    const ids = [...this.remotePresenceIds];
    if (ids.length === 0) return;
    for (const id of ids) {
      this.awareness.states.delete(id);
      this.awareness.meta.delete(id);
    }
    this.remotePresenceIds.clear();
    this.awareness.emit('change', [{ added: [], updated: [], removed: ids }, REMOTE_ORIGIN]);
  }
}
