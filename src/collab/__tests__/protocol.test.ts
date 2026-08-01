import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  canWrite,
  COLLAB_LIMITS,
  CollaborationProtocolError,
  parseClientMessage,
} from '../protocol';

describe('authenticated collaboration protocol', () => {
  it('round-trips bounded binary Yjs updates', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(parseClientMessage(JSON.stringify({
      type: 'update',
      idempotencyKey: 'fixture-update-001',
      update: bytesToBase64(bytes),
    }))).toMatchObject({ type: 'update', idempotencyKey: 'fixture-update-001' });
  });

  it('rejects oversized or malformed frames before processing', () => {
    const oversized = new Uint8Array(COLLAB_LIMITS.updateBytes + 1);
    expect(() => base64ToBytes(bytesToBase64(oversized))).toThrow(CollaborationProtocolError);
    expect(() => parseClientMessage('{broken')).toThrow(/valid JSON/);
    expect(() => parseClientMessage(JSON.stringify({
      type: 'update',
      idempotencyKey: '../bad',
      update: 'AAAA',
    }))).toThrow(/Idempotency key/);
  });

  it('only accepts bounded presence fields and strips no identity server-side', () => {
    expect(parseClientMessage(JSON.stringify({
      type: 'presence',
      presence: {
        sheetId: 'sheet-1',
        cursor: { x: 12, y: -4 },
        selection: ['entity-1'],
        ts: 1,
      },
    }))).toMatchObject({ type: 'presence' });
    expect(() => parseClientMessage(JSON.stringify({
      type: 'presence',
      presence: { userId: 'forged-admin' },
    }))).toThrow(/not allowed/);
  });

  it('keeps viewer writes forbidden while editors and owners can write', () => {
    expect(canWrite('viewer')).toBe(false);
    expect(canWrite('editor')).toBe(true);
    expect(canWrite('owner')).toBe(true);
  });
});
