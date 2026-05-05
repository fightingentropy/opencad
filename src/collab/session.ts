// Session-level orchestration: ties together the Y.Doc lifecycle, the
// store binding, and presence in a single API the rest of the app can
// drive without knowing about Yjs internals.
//
// The session is a tiny module-level singleton (one collab session per
// tab). Calling `startSession()` again with the same room is a no-op;
// calling with a different room first stops the old session.

import { connectCollab, disconnectCollab, type CollabHandle } from './yjs-doc';
import { bindStoreToYjs } from './sync';
import {
  setLocalPresence,
  subscribeRemotePresence,
  clearLocalPresence,
  getLocalIdentity,
  type PresenceState,
} from './presence';
import type { StoreApi } from 'zustand';
import type { Project, EntityId, Vec2 } from '../types';

interface StoreShape {
  project: Project;
  setProject: (p: Project) => void;
}

interface ActiveSession {
  handle: CollabHandle;
  unbindStore: () => void;
  unsubPresence: () => void;
  remoteCallbacks: Set<(states: PresenceState[]) => void>;
  lastRemoteStates: PresenceState[];
}

let active: ActiveSession | null = null;

export interface StartSessionOptions {
  room: string;
  store: StoreApi<StoreShape>;
}

export interface SessionInfo {
  room: string;
  identity: ReturnType<typeof getLocalIdentity>;
}

/** Start (or rejoin) a collaboration session. Idempotent per room. */
export function startSession(opts: StartSessionOptions): SessionInfo {
  if (active && active.handle.room === opts.room) {
    return { room: opts.room, identity: getLocalIdentity() };
  }
  if (active) stopSession();

  const handle = connectCollab({ room: opts.room });
  const binding = bindStoreToYjs(opts.store, handle.projectMap, handle.doc);

  const callbacks = new Set<(states: PresenceState[]) => void>();
  const fanout: PresenceState[] = [];
  const unsubPresence = subscribeRemotePresence(handle.awareness, (states) => {
    fanout.length = 0;
    for (const s of states) fanout.push(s);
    if (active) active.lastRemoteStates = [...states];
    for (const cb of callbacks) cb(states);
  });

  // Seed the awareness channel with the local identity so peers see
  // us straight away even if the cursor hasn't moved yet.
  const id = getLocalIdentity();
  setLocalPresence(handle.awareness, {
    sheetId: opts.store.getState().project.activeSheetId,
    cursor: { x: 0, y: 0 },
    selection: [],
  });

  active = {
    handle,
    unbindStore: binding.dispose,
    unsubPresence,
    remoteCallbacks: callbacks,
    lastRemoteStates: [],
  };

  return { room: opts.room, identity: id };
}

/** Stop the active session. Safe to call when nothing is active. */
export function stopSession(): void {
  if (!active) return;
  try {
    clearLocalPresence(active.handle.awareness);
  } catch {
    // ignore — provider may already be down
  }
  active.unsubPresence();
  active.unbindStore();
  active.remoteCallbacks.clear();
  disconnectCollab();
  active = null;
}

/** Whether a session is currently active. */
export function isSessionActive(): boolean {
  return active !== null;
}

/** Current room code, or null if not connected. */
export function activeRoom(): string | null {
  return active?.handle.room ?? null;
}

/** Subscribe to remote presence updates. Returns an unsubscribe fn. */
export function onRemotePresence(
  cb: (states: PresenceState[]) => void,
): () => void {
  if (!active) return () => {};
  active.remoteCallbacks.add(cb);
  // Fire immediately with the most recent snapshot so a late
  // subscriber sees the current state without waiting for a change.
  cb(active.lastRemoteStates);
  return () => {
    if (!active) return;
    active.remoteCallbacks.delete(cb);
  };
}

/** Update our local cursor / sheet / selection in awareness. */
export function publishLocalPresence(state: {
  sheetId?: string;
  cursor?: Vec2;
  selection?: EntityId[];
}): void {
  if (!active) return;
  setLocalPresence(active.handle.awareness, state);
}

/** Number of connected peers (excluding self). */
export function peerCount(): number {
  if (!active) return 0;
  // The awareness map includes the local client, so subtract 1.
  return Math.max(0, active.handle.awareness.getStates().size - 1);
}
