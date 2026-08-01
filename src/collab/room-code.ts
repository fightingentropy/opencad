const ROOM_CODE_PATTERN = /^oc_[0-9a-f]{32}$/;

/** Generate 128 bits of browser CSPRNG entropy, encoded without punctuation. */
export const generateCollaborationRoomCode = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `oc_${hex}`;
};

export const isSecureCollaborationRoomCode = (room: string): boolean =>
  ROOM_CODE_PATTERN.test(room);

export const assertSecureCollaborationRoomCode = (room: string): void => {
  if (!isSecureCollaborationRoomCode(room)) {
    throw new Error('Room codes must use the generated 128-bit oc_ format. Generate a new code and share the new link.');
  }
};

export const collaborationRoomCodeFromHash = (hash: string): string | null => {
  if (!hash.startsWith('#collab=')) return null;
  try {
    const room = decodeURIComponent(hash.slice('#collab='.length));
    return isSecureCollaborationRoomCode(room) ? room : null;
  } catch {
    return null;
  }
};
