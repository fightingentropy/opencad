// Collab runtime bridge — the only file in src/collab/ that the main
// bundle is allowed to touch directly. Everything here is plain JS
// (no Yjs imports), so importing it doesn't pull the Yjs/y-webrtc/
// y-indexeddb chunk into the main bundle.
//
// When the user opts into collaboration, the modal calls
// `loadCollab()` which dynamic-imports the actual implementation —
// at that point the collab chunk is fetched from the network.

import type { EntityId, Vec2 } from '../types';

// Mirror of the rich PresenceState in ./presence — kept here so
// consumers (CadCanvas, App) can refer to the type without importing
// the Yjs-laden module.
export interface RuntimePresence {
  userId: string;
  name: string;
  color: string;
  sheetId?: string;
  cursor?: Vec2;
  selection?: EntityId[];
  ts?: number;
}

// Module-level state holding the loaded collab module. Once set, the
// app uses these refs to publish presence and subscribe to remote
// updates without re-importing the chunk.
type CollabModule = typeof import('./index');
let mod: CollabModule | null = null;
let active = false;

const subscribers = new Set<(active: boolean) => void>();

const setActive = (next: boolean): void => {
  if (active === next) return;
  active = next;
  for (const cb of subscribers) cb(active);
};

export const onActiveChange = (cb: (active: boolean) => void): () => void => {
  subscribers.add(cb);
  cb(active);
  return () => subscribers.delete(cb);
};

export const isActive = (): boolean => active;

/**
 * Lazy-load the collaboration chunk. The first call fetches the
 * Yjs/y-webrtc/y-indexeddb bundle (~150KB minified); subsequent
 * calls return the cached module.
 */
export async function loadCollab(): Promise<CollabModule> {
  if (mod) return mod;
  mod = await import('./index');
  return mod;
}

/** Has the chunk already been fetched? */
export const isCollabLoaded = (): boolean => mod !== null;

/**
 * Publish local presence — safe to call from hot paths (canvas
 * mousemove). When collab isn't active it's a cheap no-op; when it
 * is, it forwards into the loaded session module.
 */
export const publishPresence = (state: {
  sheetId?: string;
  cursor?: Vec2;
  selection?: EntityId[];
}): void => {
  if (!active || !mod) return;
  mod.publishLocalPresence(state);
};

/** Mark a session as active/inactive (called by the modal on connect/disconnect). */
export const _setActive = (next: boolean): void => setActive(next);
