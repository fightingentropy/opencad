import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  base64ToBytes,
  bytesToBase64,
  canWrite,
  COLLAB_LIMITS,
  COLLAB_PROTOCOL_VERSION,
  CollaborationProtocolError,
  parseClientMessage,
  type CollaborationIdentity,
  type CollaborationServerMessage,
} from '../../src/collab/protocol';
import {
  decodeInternalPrincipal,
  INTERNAL_PRINCIPAL_HEADER,
  isConnectionAttachment,
  type ConnectionAttachment,
} from './internal-principal';

const ROOM_CODE_PATTERN = /^oc_[0-9a-f]{32}$/;

interface SnapshotMetaRow extends Record<string, SqlStorageValue> {
  sequence: number;
  byte_length: number;
  chunk_count: number;
}

interface SnapshotChunkRow extends Record<string, SqlStorageValue> {
  chunk_index: number;
  update_blob: ArrayBuffer;
}

interface UpdateRow extends Record<string, SqlStorageValue> {
  sequence: number;
  update_blob: ArrayBuffer;
  byte_length: number;
}

interface UpdateCountRow extends Record<string, SqlStorageValue> {
  count: number;
  bytes: number;
}

const publicIdentity = (
  attachment: ConnectionAttachment,
  includeEmail: boolean,
): CollaborationIdentity => ({
  userId: attachment.principal.userId,
  name: attachment.principal.name,
  color: attachment.principal.color,
  role: attachment.principal.role,
  ...(includeEmail ? { email: attachment.principal.email } : {}),
});

const copiedArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export class CollaborationRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>('SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations')
      .one().version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE room_identity (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_id TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE room_snapshot_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          sequence INTEGER NOT NULL,
          byte_length INTEGER NOT NULL,
          chunk_count INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE room_snapshot_chunks (
          chunk_index INTEGER PRIMARY KEY,
          update_blob BLOB NOT NULL
        );
        CREATE TABLE room_updates (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT NOT NULL UNIQUE,
          actor_id TEXT NOT NULL,
          update_blob BLOB NOT NULL,
          byte_length INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE processed_updates (
          idempotency_key TEXT PRIMARY KEY,
          sequence INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX processed_updates_sequence_idx ON processed_updates(sequence);
        CREATE INDEX room_updates_sequence_idx ON room_updates(sequence);
        INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, unixepoch() * 1000);
      `);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'WebSocket upgrade required' }, { status: 426 });
    }
    const roomId = request.headers.get('X-OpenCAD-Room');
    if (!roomId || !ROOM_CODE_PATTERN.test(roomId)) {
      return Response.json({ error: 'Invalid room' }, { status: 400 });
    }
    let principal;
    try {
      principal = decodeInternalPrincipal(request.headers.get(INTERNAL_PRINCIPAL_HEADER));
      this.bindRoomIdentity(roomId);
    } catch {
      return Response.json({ error: 'Unauthorized room request' }, { status: 401 });
    }

    const snapshot = this.materializeRoomUpdate();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      version: 1,
      roomId,
      connectionId: crypto.randomUUID(),
      presenceId: this.allocatePresenceId(),
      principal,
      joinedAt: Date.now(),
      rateWindowStartedAt: Date.now(),
      rateMessageCount: 0,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    this.send(server, {
      type: 'welcome',
      protocol: COLLAB_PROTOCOL_VERSION,
      connectionId: attachment.connectionId,
      presenceId: attachment.presenceId,
      identity: publicIdentity(attachment, true),
      update: bytesToBase64(snapshot.update),
      lastSequence: snapshot.sequence,
    });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === server) continue;
      const peerAttachment = peer.deserializeAttachment();
      if (!isConnectionAttachment(peerAttachment) || !peerAttachment.presence) continue;
      this.send(server, {
        type: 'presence',
        connectionId: peerAttachment.connectionId,
        presenceId: peerAttachment.presenceId,
        identity: publicIdentity(peerAttachment, false),
        presence: peerAttachment.presence,
      });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(webSocket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const value = webSocket.deserializeAttachment();
    if (!isConnectionAttachment(value)) {
      webSocket.close(1008, 'missing authenticated session');
      return;
    }
    if (!this.consumeMessageBudget(webSocket, value)) return;
    if (typeof raw !== 'string') {
      this.send(webSocket, { type: 'error', code: 'bad-message', message: 'Binary frames are not supported' });
      return;
    }
    try {
      const message = parseClientMessage(raw);
      if (message.type === 'presence') {
        if (message.presence === null) {
          delete value.presence;
          webSocket.serializeAttachment(value);
          this.broadcast({ type: 'leave', connectionId: value.connectionId, presenceId: value.presenceId }, webSocket);
          return;
        }
        value.presence = message.presence;
        webSocket.serializeAttachment(value);
        this.broadcast({
          type: 'presence',
          connectionId: value.connectionId,
          presenceId: value.presenceId,
          identity: publicIdentity(value, false),
          presence: message.presence,
        }, webSocket);
        return;
      }
      if (!canWrite(value.principal.role)) {
        this.send(webSocket, { type: 'error', code: 'forbidden', message: 'Viewer sessions cannot edit rooms' });
        return;
      }
      const result = this.persistUpdate(
        message.idempotencyKey,
        value.principal.userId,
        message.update,
      );
      this.send(webSocket, {
        type: 'ack',
        idempotencyKey: message.idempotencyKey,
        sequence: result.sequence,
        duplicate: result.duplicate,
      });
      if (!result.duplicate) {
        this.broadcast({
          type: 'update',
          sequence: result.sequence,
          actorId: value.principal.userId,
          update: message.update,
        }, webSocket);
      }
    } catch (error) {
      if (error instanceof CollaborationProtocolError) {
        this.send(webSocket, { type: 'error', code: error.code, message: error.message });
        return;
      }
      console.error(JSON.stringify({ message: 'collaboration message failed', error: 'internal-error' }));
      this.send(webSocket, { type: 'error', code: 'server-error', message: 'Collaboration update failed' });
    }
  }

  async webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.broadcastLeave(webSocket);
    webSocket.close(code, reason);
  }

  async webSocketError(webSocket: WebSocket, _error: unknown): Promise<void> {
    this.broadcastLeave(webSocket);
  }

  private bindRoomIdentity(roomId: string): void {
    const row = this.ctx.storage.sql
      .exec<{ room_id: string }>('SELECT room_id FROM room_identity WHERE singleton = 1')
      .toArray()[0];
    if (row && row.room_id !== roomId) throw new Error('Durable Object room identity mismatch');
    if (!row) {
      this.ctx.storage.sql.exec(
        'INSERT INTO room_identity (singleton, room_id, created_at) VALUES (1, ?, ?)',
        roomId,
        Date.now(),
      );
    }
  }

  private allocatePresenceId(): number {
    const used = new Set<number>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (isConnectionAttachment(attachment)) used.add(attachment.presenceId);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      if (!used.has(id)) return id;
    }
    throw new Error('Could not allocate collaboration presence identity');
  }

  private consumeMessageBudget(webSocket: WebSocket, attachment: ConnectionAttachment): boolean {
    const now = Date.now();
    if (now - attachment.rateWindowStartedAt >= COLLAB_LIMITS.messageWindowMs) {
      attachment.rateWindowStartedAt = now;
      attachment.rateMessageCount = 0;
    }
    attachment.rateMessageCount += 1;
    webSocket.serializeAttachment(attachment);
    if (attachment.rateMessageCount <= COLLAB_LIMITS.messagesPerWindow) return true;
    this.send(webSocket, { type: 'error', code: 'rate-limited', message: 'Collaboration message rate exceeded' });
    webSocket.close(1008, 'message rate exceeded');
    return false;
  }

  private materializeRoomUpdate(): { update: Uint8Array; sequence: number } {
    const snapshot = this.ctx.storage.sql
      .exec<SnapshotMetaRow>('SELECT sequence, byte_length, chunk_count FROM room_snapshot_meta WHERE singleton = 1')
      .toArray()[0];
    const snapshotChunks = this.ctx.storage.sql
      .exec<SnapshotChunkRow>('SELECT chunk_index, update_blob FROM room_snapshot_chunks ORDER BY chunk_index')
      .toArray();
    const rows = this.ctx.storage.sql
      .exec<UpdateRow>('SELECT sequence, update_blob, byte_length FROM room_updates ORDER BY sequence')
      .toArray();
    const updates: Uint8Array[] = [];
    if (snapshot) {
      if (snapshot.chunk_count !== snapshotChunks.length) throw new Error('Room snapshot is incomplete');
      const snapshotUpdate = new Uint8Array(snapshot.byte_length);
      let offset = 0;
      for (let index = 0; index < snapshotChunks.length; index += 1) {
        const chunk = snapshotChunks[index];
        if (chunk.chunk_index !== index) throw new Error('Room snapshot chunk ordering is invalid');
        const bytes = new Uint8Array(chunk.update_blob);
        if (offset + bytes.byteLength > snapshotUpdate.byteLength) throw new Error('Room snapshot is oversized');
        snapshotUpdate.set(bytes, offset);
        offset += bytes.byteLength;
      }
      if (offset !== snapshotUpdate.byteLength) throw new Error('Room snapshot length is invalid');
      updates.push(snapshotUpdate);
    } else if (snapshotChunks.length > 0) {
      throw new Error('Room snapshot metadata is missing');
    }
    for (const row of rows) updates.push(new Uint8Array(row.update_blob));
    const update = updates.length === 0
      ? Y.encodeStateAsUpdate(new Y.Doc())
      : updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
    if (update.byteLength > COLLAB_LIMITS.roomSnapshotBytes) {
      throw new CollaborationProtocolError('Room snapshot exceeds its storage limit', 'too-large');
    }
    return {
      update,
      sequence: rows.at(-1)?.sequence ?? snapshot?.sequence ?? 0,
    };
  }

  private persistUpdate(
    idempotencyKey: string,
    actorId: string,
    updateBase64: string,
  ): { sequence: number; duplicate: boolean } {
    const duplicate = this.ctx.storage.sql
      .exec<{ sequence: number }>('SELECT sequence FROM processed_updates WHERE idempotency_key = ?', idempotencyKey)
      .toArray()[0];
    if (duplicate) return { sequence: duplicate.sequence, duplicate: true };

    const updateBytes = base64ToBytes(updateBase64);
    const snapshotBytes = this.ctx.storage.sql
      .exec<{ bytes: number }>('SELECT COALESCE(byte_length, 0) AS bytes FROM room_snapshot_meta WHERE singleton = 1')
      .toArray()[0]?.bytes ?? 0;
    const pending = this.pendingUpdateStats();
    if (snapshotBytes + pending.bytes + updateBytes.byteLength > COLLAB_LIMITS.roomSnapshotBytes) {
      throw new CollaborationProtocolError('Room has reached its collaboration storage limit', 'too-large');
    }

    const inserted = this.ctx.storage.sql.exec<{ sequence: number }>(
      `INSERT INTO room_updates (idempotency_key, actor_id, update_blob, byte_length, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING sequence`,
      idempotencyKey,
      actorId,
      copiedArrayBuffer(updateBytes),
      updateBytes.byteLength,
      Date.now(),
    ).one();
    this.ctx.storage.sql.exec(
      'INSERT INTO processed_updates (idempotency_key, sequence, created_at) VALUES (?, ?, ?)',
      idempotencyKey,
      inserted.sequence,
      Date.now(),
    );
    const afterInsert = { count: pending.count + 1, bytes: pending.bytes + updateBytes.byteLength };
    if (
      afterInsert.count >= COLLAB_LIMITS.roomUpdatesBeforeCompaction
      || afterInsert.bytes >= COLLAB_LIMITS.roomPendingBytesBeforeCompaction
    ) this.compact(inserted.sequence);
    return { sequence: inserted.sequence, duplicate: false };
  }

  private pendingUpdateStats(): UpdateCountRow {
    return this.ctx.storage.sql.exec<UpdateCountRow>(
      'SELECT COUNT(*) AS count, COALESCE(SUM(byte_length), 0) AS bytes FROM room_updates',
    ).one();
  }

  private compact(sequence: number): void {
    const merged = this.materializeRoomUpdate().update;
    const chunkCount = Math.ceil(merged.byteLength / COLLAB_LIMITS.snapshotChunkBytes);
    this.ctx.storage.sql.exec(
      `INSERT INTO room_snapshot_meta (singleton, sequence, byte_length, chunk_count, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         sequence = excluded.sequence,
         byte_length = excluded.byte_length,
         chunk_count = excluded.chunk_count,
         updated_at = excluded.updated_at`,
      sequence,
      merged.byteLength,
      chunkCount,
      Date.now(),
    );
    this.ctx.storage.sql.exec('DELETE FROM room_snapshot_chunks');
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * COLLAB_LIMITS.snapshotChunkBytes;
      const chunk = merged.subarray(start, start + COLLAB_LIMITS.snapshotChunkBytes);
      this.ctx.storage.sql.exec(
        'INSERT INTO room_snapshot_chunks (chunk_index, update_blob) VALUES (?, ?)',
        chunkIndex,
        copiedArrayBuffer(chunk),
      );
    }
    this.ctx.storage.sql.exec('DELETE FROM room_updates WHERE sequence <= ?', sequence);
    this.ctx.storage.sql.exec('DELETE FROM processed_updates WHERE sequence <= ?', Math.max(0, sequence - 20_000));
  }

  private send(webSocket: WebSocket, message: CollaborationServerMessage): void {
    try {
      webSocket.send(JSON.stringify(message));
    } catch {
      // A peer may close between getWebSockets() and send(). Its close/error
      // event removes presence for the remaining peers.
    }
  }

  private broadcast(message: CollaborationServerMessage, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) this.send(socket, message);
    }
  }

  private broadcastLeave(webSocket: WebSocket): void {
    const value = webSocket.deserializeAttachment();
    if (!isConnectionAttachment(value)) return;
    this.broadcast({ type: 'leave', connectionId: value.connectionId, presenceId: value.presenceId }, webSocket);
  }
}
