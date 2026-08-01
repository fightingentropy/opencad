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
  type PresenceState,
} from './presence';
import type { StoreApi } from 'zustand';
import type { Project, EntityId, Vec2 } from '../types';
import { assertSecureCollaborationRoomCode } from './room-code';
import { canWrite, type CollaborationIdentity } from './protocol';
import type { CollaborationConnection } from './yjs-doc';
import { setCollaborationReadOnly } from '../state/collaboration-guard';

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
  identity: CollaborationIdentity;
}

let active: ActiveSession | null = null;

export interface StartSessionOptions {
  room: string;
  store: StoreApi<StoreShape>;
  connection: CollaborationConnection;
}

export interface SessionInfo {
  room: string;
  identity: CollaborationIdentity;
  readOnly: boolean;
  transport: CollabHandle['transport'];
}

/** Start (or rejoin) a collaboration session. Idempotent per room. */
export async function startSession(opts: StartSessionOptions): Promise<SessionInfo> {
  assertSecureCollaborationRoomCode(opts.room);
  if (active && active.handle.room === opts.room && active.handle.transport === opts.connection.kind) {
    return {
      room: opts.room,
      identity: active.identity,
      readOnly: !canWrite(active.identity.role),
      transport: active.handle.transport,
    };
  }
  if (active) stopSession();

  const handle = connectCollab({ room: opts.room, connection: opts.connection });
  let identity: CollaborationIdentity;
  try {
    identity = await handle.ready;
  } catch (error) {
    handle.disconnect();
    throw error;
  }
  const writeEnabled = canWrite(identity.role);
  setCollaborationReadOnly(!writeEnabled);
  const binding = bindStoreToYjs(opts.store, handle.maps, handle.doc, { writeEnabled });

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
    identity,
  };

  return {
    room: opts.room,
    identity,
    readOnly: !writeEnabled,
    transport: handle.transport,
  };
}

/** Stop the active session. Safe to call when nothing is active. */
export function stopSession(): void {
  setCollaborationReadOnly(false);
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

/** The authenticated session identity/role, or null while disconnected. */
export const activeIdentity = (): CollaborationIdentity | null => active?.identity ?? null;
