import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bytesToBase64 } from '../../src/collab/protocol';
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
});
