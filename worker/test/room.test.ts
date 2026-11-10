import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64, COLLAB_LIMITS } from '../../src/collab/protocol';
import { type AuthenticatedPrincipal } from '../src/auth';
import { encodeInternalPrincipal, INTERNAL_PRINCIPAL_HEADER } from '../src/internal-principal';
import { CollaborationRoom } from '../src/room';

const roomId = 'oc_0123456789abcdef0123456789abcdef';

const principal = (role: AuthenticatedPrincipal['role']): AuthenticatedPrincipal => ({
  userId: `${role}-subject`,
  email: `${role}@example.com`,
  name: role,
  color: '#3ba3ff',
  role,
});

const openRoom = async (role: AuthenticatedPrincipal['role'], suffix: string) => {
  const stub = env.COLLAB_ROOM.getByName(`${roomId}-${suffix}`);
  const response = await stub.fetch(new Request('https://internal/websocket', {
    headers: {
      Upgrade: 'websocket',
      'X-OpenCAD-Room': roomId,
      [INTERNAL_PRINCIPAL_HEADER]: encodeInternalPrincipal(principal(role)),
    },
  }));
  expect(response.status).toBe(101);
  const webSocket = response.webSocket;
  expect(webSocket).not.toBeNull();
  webSocket!.accept();
  return { stub, webSocket: webSocket! };
};

const nextMessage = (webSocket: WebSocket): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup();
      try {
        resolve(JSON.parse(String(event.data)) as unknown);
      } catch (error) {
        reject(error);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket failed'));
    };
    const cleanup = () => {
      webSocket.removeEventListener('message', onMessage);
      webSocket.removeEventListener('error', onError);
    };
    webSocket.addEventListener('message', onMessage);
    webSocket.addEventListener('error', onError);
  });

const yUpdate = (): string => {
  const doc = new Y.Doc();
  doc.getMap('fixture').set('answer', 42);
  return bytesToBase64(Y.encodeStateAsUpdate(doc));
};

const largeYUpdate = (index: number): string => {
  const doc = new Y.Doc();
  doc.getMap('large-fixture').set(`chunk-${index}`, `${index}:${'x'.repeat(1_050_000)}`);
  return bytesToBase64(Y.encodeStateAsUpdate(doc));
};

const namedYUpdate = (key: string, value: string): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('fixture').set(key, value);
  return Y.encodeStateAsUpdate(doc);
};

// Valid base64 that the protocol parser accepts, but not something Yjs can decode.
const undecodableBytes = new TextEncoder().encode('valid base64, but not a Yjs update');

const insertStoredUpdate = (state: DurableObjectState, idempotencyKey: string, update: Uint8Array): void => {
  const blob = new ArrayBuffer(update.byteLength);
  new Uint8Array(blob).set(update);
  state.storage.sql.exec(
    `INSERT INTO room_updates (idempotency_key, actor_id, update_blob, byte_length, created_at)
     VALUES (?, 'editor-subject', ?, ?, ?)`,
    idempotencyKey,
    blob,
    update.byteLength,
    Date.now(),
  );
};

const storedUpdateKeys = (stub: DurableObjectStub<CollaborationRoom>): Promise<string[]> =>
  runInDurableObject(stub, async (_instance: CollaborationRoom, state) =>
    state.storage.sql
      .exec<{ idempotency_key: string }>('SELECT idempotency_key FROM room_updates ORDER BY sequence')
      .toArray()
      .map((row) => row.idempotency_key));

const welcomeFixture = async (webSocket: WebSocket): Promise<Record<string, unknown>> => {
  const welcome = await nextMessage(webSocket) as { type: string; update: string };
  expect(welcome.type).toBe('welcome');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, base64ToBytes(welcome.update, COLLAB_LIMITS.roomSnapshotBytes));
  return doc.getMap('fixture').toJSON();
};

describe('collaboration Worker boundary', () => {
  it('serves health but fails closed before calling a room', async () => {
    const health = await exports.default.fetch(new Request('https://example.com/healthz'));
    expect(health.status).toBe(200);
    const noOrigin = await exports.default.fetch(new Request(`https://example.com/v1/rooms/${roomId}/websocket`, {
      headers: { Upgrade: 'websocket' },
    }));
    expect(noOrigin.status).toBe(403);
    const wrongOrigin = await exports.default.fetch(new Request(`https://example.com/v1/rooms/${roomId}/websocket`, {
      headers: { Upgrade: 'websocket', Origin: 'https://attacker.invalid' },
    }));
    expect(wrongOrigin.status).toBe(403);
    const noJwt = await exports.default.fetch(new Request(`https://example.com/v1/rooms/${roomId}/websocket`, {
      headers: { Upgrade: 'websocket', Origin: 'https://opencad.pages.dev' },
    }));
    expect(noJwt.status).toBe(401);
  });

  it('rejects viewer updates without persisting them', async () => {
    const { stub, webSocket } = await openRoom('viewer', 'viewer');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    const response = nextMessage(webSocket);
    webSocket.send(JSON.stringify({
      type: 'update',
      idempotencyKey: 'viewer-update-0001',
      update: yUpdate(),
    }));
    expect(await response).toMatchObject({ type: 'error', code: 'forbidden' });
    const count = await runInDurableObject(stub, async (_instance: CollaborationRoom, state) =>
      state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM room_updates').one().count);
    expect(count).toBe(0);
    webSocket.close(1000, 'done');
  });

  it('persists before ack, deduplicates retries, and restores role after hibernation', async () => {
    const { stub, webSocket } = await openRoom('editor', 'editor');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    webSocket.send(JSON.stringify({
      type: 'presence',
      presence: { sheetId: 'sheet-1', cursor: { x: 1, y: 2 }, selection: [] },
    }));
    await evictDurableObject(stub);

    const update = {
      type: 'update',
      idempotencyKey: 'editor-update-0001',
      update: yUpdate(),
    };
    const first = nextMessage(webSocket);
    webSocket.send(JSON.stringify(update));
    expect(await first).toMatchObject({ type: 'ack', duplicate: false, sequence: 1 });
    const stored = await runInDurableObject(stub, async (_instance: CollaborationRoom, state) =>
      state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM room_updates').one().count);
    expect(stored).toBe(1);

    const retry = nextMessage(webSocket);
    webSocket.send(JSON.stringify(update));
    expect(await retry).toMatchObject({ type: 'ack', duplicate: true, sequence: 1 });
    webSocket.close(1000, 'done');
  });

  it('compacts large room state into SQLite-safe snapshot chunks', async () => {
    const { stub, webSocket } = await openRoom('owner', 'chunked-snapshot');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    for (let index = 0; index < 4; index += 1) {
      const ack = nextMessage(webSocket);
      webSocket.send(JSON.stringify({
        type: 'update',
        idempotencyKey: `large-update-${String(index).padStart(4, '0')}`,
        update: largeYUpdate(index),
      }));
      expect(await ack).toMatchObject({ type: 'ack', duplicate: false });
    }
    const storage = await runInDurableObject(stub, async (_instance: CollaborationRoom, state) => {
      const meta = state.storage.sql
        .exec<{ chunk_count: number }>('SELECT chunk_count FROM room_snapshot_meta WHERE singleton = 1')
        .one();
      const pending = state.storage.sql
        .exec<{ count: number }>('SELECT COUNT(*) AS count FROM room_updates')
        .one().count;
      const largest = state.storage.sql
        .exec<{ bytes: number }>('SELECT MAX(length(update_blob)) AS bytes FROM room_snapshot_chunks')
        .one().bytes;
      return { chunks: meta.chunk_count, pending, largest };
    });
    expect(storage.chunks).toBeGreaterThan(1);
    expect(storage.pending).toBe(0);
    expect(storage.largest).toBeLessThanOrEqual(1024 * 1024);
    webSocket.close(1000, 'done');
  });

  it('rejects an update Yjs cannot decode, so it cannot lock the room', async () => {
    const { stub, webSocket } = await openRoom('editor', 'undecodable');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    const peer = await openRoom('viewer', 'undecodable');
    expect(await nextMessage(peer.webSocket)).toMatchObject({ type: 'welcome' });

    const rejected = nextMessage(webSocket);
    webSocket.send(JSON.stringify({
      type: 'update',
      idempotencyKey: 'undecodable-0001',
      update: bytesToBase64(undecodableBytes),
    }));
    expect(await rejected).toMatchObject({ type: 'error', code: 'bad-message' });

    // The room keeps working, and the peer is only ever sent the valid updates.
    const updates = [namedYUpdate('first', 'a'), namedYUpdate('second', 'b')].map(bytesToBase64);
    for (const [index, update] of updates.entries()) {
      const ack = nextMessage(webSocket);
      const relayed = nextMessage(peer.webSocket);
      webSocket.send(JSON.stringify({ type: 'update', idempotencyKey: `decodable-000${index + 1}`, update }));
      expect(await ack).toMatchObject({ type: 'ack', duplicate: false, sequence: index + 1 });
      expect(await relayed).toMatchObject({ type: 'update', sequence: index + 1, update });
    }
    expect(await storedUpdateKeys(stub)).toEqual(['decodable-0001', 'decodable-0002']);

    // A join merges every stored update. With the undecodable one among them the merge threw, and
    // the room refused every join from then on.
    const late = await openRoom('viewer', 'undecodable');
    expect(await welcomeFixture(late.webSocket)).toEqual({ first: 'a', second: 'b' });
    for (const socket of [webSocket, peer.webSocket, late.webSocket]) socket.close(1000, 'done');
  });

  it('recovers a room that stored undecodable updates before they were validated', async () => {
    const { stub, webSocket } = await openRoom('editor', 'poisoned');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    const ack = nextMessage(webSocket);
    webSocket.send(JSON.stringify({
      type: 'update',
      idempotencyKey: 'before-poison-0001',
      update: bytesToBase64(namedYUpdate('before', 'kept')),
    }));
    expect(await ack).toMatchObject({ type: 'ack', sequence: 1 });

    // The state an editor could leave behind before updates were validated: an undecodable row,
    // then valid rows from sessions that were still connected.
    await runInDurableObject(stub, async (_instance: CollaborationRoom, state) => {
      insertStoredUpdate(state, 'poison-0001', undecodableBytes);
      insertStoredUpdate(state, 'after-poison-0001', namedYUpdate('after', 'kept too'));
      insertStoredUpdate(state, 'poison-0002', new Uint8Array(0));
      state.storage.sql.exec('DROP TABLE room_updates_rejected');
      state.storage.sql.exec('DELETE FROM _sql_schema_migrations WHERE id >= 2');
    });
    await evictDurableObject(stub); // the next request starts the object again, as a deploy does

    const late = await openRoom('viewer', 'poisoned');
    expect(await welcomeFixture(late.webSocket)).toEqual({ before: 'kept', after: 'kept too' });
    expect(await storedUpdateKeys(stub)).toEqual(['before-poison-0001', 'after-poison-0001']);
    // The undecodable rows are kept out of the room, with who sent them.
    const rejected = await runInDurableObject(stub, async (_instance: CollaborationRoom, state) =>
      state.storage.sql
        .exec<{ idempotency_key: string; actor_id: string; byte_length: number }>(
          'SELECT idempotency_key, actor_id, byte_length FROM room_updates_rejected ORDER BY sequence',
        )
        .toArray());
    expect(rejected).toEqual([
      { idempotency_key: 'poison-0001', actor_id: 'editor-subject', byte_length: undecodableBytes.byteLength },
      { idempotency_key: 'poison-0002', actor_id: 'editor-subject', byte_length: 0 },
    ]);
    for (const socket of [webSocket, late.webSocket]) socket.close(1000, 'done');
  });

  it('starts again after its storage migrations were cut short', async () => {
    const { stub, webSocket } = await openRoom('editor', 'interrupted-migration');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    const ack = nextMessage(webSocket);
    webSocket.send(JSON.stringify({
      type: 'update',
      idempotencyKey: 'kept-0001',
      update: bytesToBase64(namedYUpdate('kept', 'yes')),
    }));
    expect(await ack).toMatchObject({ type: 'ack', sequence: 1 });

    // What a start that stopped part-way would leave: every table exists, one undecodable row is
    // already copied to room_updates_rejected but still in room_updates, and no migration is
    // recorded as applied. The next start runs both migrations again over that.
    await runInDurableObject(stub, async (_instance: CollaborationRoom, state) => {
      insertStoredUpdate(state, 'poison-0001', undecodableBytes);
      insertStoredUpdate(state, 'poison-0002', undecodableBytes);
      state.storage.sql.exec(
        `INSERT INTO room_updates_rejected
           (sequence, idempotency_key, actor_id, update_blob, byte_length, created_at, rejected_at)
         SELECT sequence, idempotency_key, actor_id, update_blob, byte_length, created_at, 0
         FROM room_updates WHERE idempotency_key = 'poison-0001'`,
      );
      state.storage.sql.exec('DELETE FROM _sql_schema_migrations');
    });
    await evictDurableObject(stub);

    const late = await openRoom('viewer', 'interrupted-migration');
    expect(await welcomeFixture(late.webSocket)).toEqual({ kept: 'yes' });
    expect(await storedUpdateKeys(stub)).toEqual(['kept-0001']);
    const after = await runInDurableObject(stub, async (_instance: CollaborationRoom, state) => ({
      rejected: state.storage.sql
        .exec<{ idempotency_key: string }>('SELECT idempotency_key FROM room_updates_rejected ORDER BY sequence')
        .toArray()
        .map((row) => row.idempotency_key),
      migrations: state.storage.sql
        .exec<{ id: number }>('SELECT id FROM _sql_schema_migrations ORDER BY id')
        .toArray()
        .map((row) => row.id),
    }));
    expect(after).toEqual({ rejected: ['poison-0001', 'poison-0002'], migrations: [1, 2] });
    for (const socket of [webSocket, late.webSocket]) socket.close(1000, 'done');
  });

  it('does not keep an update when its compaction fails', async () => {
    const { stub, webSocket } = await openRoom('owner', 'failed-compaction');
    expect(await nextMessage(webSocket)).toMatchObject({ type: 'welcome' });
    for (let index = 0; index < 3; index += 1) {
      const ack = nextMessage(webSocket);
      webSocket.send(JSON.stringify({
        type: 'update',
        idempotencyKey: `large-update-${String(index).padStart(4, '0')}`,
        update: largeYUpdate(index),
      }));
      expect(await ack).toMatchObject({ type: 'ack', duplicate: false });
    }
    // Make the next compaction fail: this row cannot be merged.
    await runInDurableObject(stub, async (_instance: CollaborationRoom, state) =>
      insertStoredUpdate(state, 'unmergeable-0001', undecodableBytes));
    const before = await storedUpdateKeys(stub);

    // The fourth large update crosses the pending-bytes limit and starts a compaction. A client
    // that is told the update failed must be able to retry it: it must not be stored already,
    // or the retry is acknowledged as a duplicate that no peer was ever sent.
    const update = {
      type: 'update',
      idempotencyKey: 'large-update-0003',
      update: largeYUpdate(3),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = nextMessage(webSocket);
      webSocket.send(JSON.stringify(update));
      expect(await failed).toMatchObject({ type: 'error', code: 'server-error' });
      expect(await storedUpdateKeys(stub)).toEqual(before);
    }
    webSocket.close(1000, 'done');
  });
});
