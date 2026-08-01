export const COLLAB_PROTOCOL_VERSION = 1 as const;

export const COLLAB_LIMITS = {
  frameBytes: 3 * 1024 * 1024,
  serverFrameBytes: 48 * 1024 * 1024,
  updateBytes: 1_500 * 1024,
  roomUpdatesBeforeCompaction: 64,
  roomPendingBytesBeforeCompaction: 4 * 1024 * 1024,
  roomSnapshotBytes: 16 * 1024 * 1024,
  snapshotChunkBytes: 1024 * 1024,
  sheetIdCharacters: 128,
  selectionItems: 32,
  entityIdCharacters: 64,
  messagesPerWindow: 600,
  messageWindowMs: 10_000,
} as const;

export type CollaborationRole = 'owner' | 'editor' | 'viewer';
export type CollaborationTransport = 'authenticated' | 'anonymous-beta';

export interface CollaborationIdentity {
  userId: string;
  name: string;
  color: string;
  email?: string;
  role: CollaborationRole;
}

export interface CollaborationPresence {
  sheetId?: string;
  cursor?: { x: number; y: number };
  selection?: string[];
  ts?: number;
}

export interface UpdateClientMessage {
  type: 'update';
  idempotencyKey: string;
  update: string;
}

export interface PresenceClientMessage {
  type: 'presence';
  presence: CollaborationPresence | null;
}

export type CollaborationClientMessage = UpdateClientMessage | PresenceClientMessage;

export type CollaborationServerMessage =
  | {
      type: 'welcome';
      protocol: typeof COLLAB_PROTOCOL_VERSION;
      connectionId: string;
      presenceId: number;
      identity: CollaborationIdentity;
      update: string;
      lastSequence: number;
    }
  | {
      type: 'update';
      sequence: number;
      actorId: string;
      update: string;
    }
  | {
      type: 'ack';
      idempotencyKey: string;
      sequence: number;
      duplicate: boolean;
    }
  | {
      type: 'presence';
      connectionId: string;
      presenceId: number;
      identity: CollaborationIdentity;
      presence: CollaborationPresence;
    }
  | {
      type: 'leave';
      connectionId: string;
      presenceId: number;
    }
  | {
      type: 'error';
      code: 'bad-message' | 'forbidden' | 'too-large' | 'rate-limited' | 'server-error';
      message: string;
    };

export class CollaborationProtocolError extends Error {
  constructor(
    message: string,
    readonly code: 'bad-message' | 'too-large' = 'bad-message',
  ) {
    super(message);
    this.name = 'CollaborationProtocolError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const isBase64 = (value: string): boolean =>
  value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

export const bytesToBase64 = (value: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunk) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string, maxBytes = COLLAB_LIMITS.updateBytes): Uint8Array => {
  if (!isBase64(value)) throw new CollaborationProtocolError('Update is not valid base64');
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > maxBytes + 2) {
    throw new CollaborationProtocolError('Update exceeds the collaboration size limit', 'too-large');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new CollaborationProtocolError('Update is not valid base64');
  }
  if (binary.length > maxBytes) {
    throw new CollaborationProtocolError('Update exceeds the collaboration size limit', 'too-large');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const boundedString = (value: unknown, label: string, max: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new CollaborationProtocolError(`${label} is invalid`);
  }
  return value;
};

const boundedCoordinate = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
    throw new CollaborationProtocolError(`${label} is invalid`);
  }
  return value;
};

export const sanitizePresence = (value: unknown): CollaborationPresence | null => {
  if (value === null) return null;
  if (!isRecord(value)) throw new CollaborationProtocolError('Presence is invalid');
  const allowed = new Set(['sheetId', 'cursor', 'selection', 'ts']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CollaborationProtocolError(`Presence field "${key}" is not allowed`);
  }

  const presence: CollaborationPresence = {};
  if (value.sheetId !== undefined) {
    presence.sheetId = boundedString(value.sheetId, 'Sheet id', COLLAB_LIMITS.sheetIdCharacters);
  }
  if (value.cursor !== undefined) {
    if (!isRecord(value.cursor)) throw new CollaborationProtocolError('Cursor is invalid');
    presence.cursor = {
      x: boundedCoordinate(value.cursor.x, 'Cursor x'),
      y: boundedCoordinate(value.cursor.y, 'Cursor y'),
    };
  }
  if (value.selection !== undefined) {
    if (!Array.isArray(value.selection) || value.selection.length > COLLAB_LIMITS.selectionItems) {
      throw new CollaborationProtocolError('Selection is invalid');
    }
    presence.selection = value.selection.map((item) =>
      boundedString(item, 'Entity id', COLLAB_LIMITS.entityIdCharacters));
  }
  if (value.ts !== undefined) {
    if (typeof value.ts !== 'number' || !Number.isFinite(value.ts) || value.ts < 0) {
      throw new CollaborationProtocolError('Presence timestamp is invalid');
    }
    presence.ts = Math.floor(value.ts);
  }
  return presence;
};

export const parseClientMessage = (raw: string): CollaborationClientMessage => {
  if (utf8Bytes(raw) > COLLAB_LIMITS.frameBytes) {
    throw new CollaborationProtocolError('Message exceeds the collaboration frame limit', 'too-large');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CollaborationProtocolError('Message is not valid JSON');
  }
  if (!isRecord(value)) throw new CollaborationProtocolError('Message must be an object');
  if (value.type === 'update') {
    const idempotencyKey = boundedString(value.idempotencyKey, 'Idempotency key', 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
      throw new CollaborationProtocolError('Idempotency key is invalid');
    }
    const update = boundedString(value.update, 'Update', Math.ceil(COLLAB_LIMITS.updateBytes * 4 / 3) + 4);
    base64ToBytes(update);
    return { type: 'update', idempotencyKey, update };
  }
  if (value.type === 'presence') {
    return { type: 'presence', presence: sanitizePresence(value.presence) };
  }
  throw new CollaborationProtocolError('Message type is not supported');
};

export const canWrite = (role: CollaborationRole): boolean =>
  role === 'owner' || role === 'editor';
