import { describe, expect, it } from 'vitest';
import {
  assertSecureCollaborationRoomCode,
  collaborationRoomCodeFromHash,
  generateCollaborationRoomCode,
  isSecureCollaborationRoomCode,
} from '../room-code';

describe('collaboration room codes', () => {
  it('generates 128-bit, namespaced room codes', () => {
    const first = generateCollaborationRoomCode();
    const second = generateCollaborationRoomCode();
    expect(first).toMatch(/^oc_[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(isSecureCollaborationRoomCode(first)).toBe(true);
  });

  it('rejects human-selected and project-id room names', () => {
    expect(() => assertSecureCollaborationRoomCode('my-shared-project')).toThrow(/128-bit/);
    expect(isSecureCollaborationRoomCode('project-123')).toBe(false);
  });

  it('only accepts secure collaboration hashes', () => {
    const room = generateCollaborationRoomCode();
    expect(collaborationRoomCodeFromHash(`#collab=${encodeURIComponent(room)}`)).toBe(room);
    expect(collaborationRoomCodeFromHash('#collab=guessable')).toBeNull();
  });
});
