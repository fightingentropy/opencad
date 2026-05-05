// Bidirectional sync between the Zustand store and a Y.Doc.
//
// Strategy (MVP, deliberately simple): the entire `Project` is stored
// as a single JSON blob inside a Y.Map under the key `data`. We diff
// at the JSON level — when the local store changes, we serialise and
// write; when the remote map changes, we deserialise and replace the
// store project. This avoids fine-grained CRDT modelling at the cost
// of merge sophistication: concurrent edits resolve last-writer-wins
// at the project granularity, which is acceptable for an MVP focused
// on live cursors + low-frequency entity sync.
//
// Future work: split each sheet into its own Y.Doc subdoc and model
// entity records as Y.Maps so concurrent edits to different entities
// merge cleanly without overwriting each other.

import type * as Y from 'yjs';
import type { StoreApi } from 'zustand';
import type { Project } from '../types';

// The key inside the Y.Map under which we stash the serialised project.
const PROJECT_KEY = 'data';

interface BindHandle {
  /** Tear down both directions. */
  dispose: () => void;
}

interface StoreShape {
  project: Project;
  setProject: (p: Project) => void;
}

/**
 * Bind a Zustand store to a Y.Doc. Returns a dispose handle that
 * unsubscribes both directions when collaboration stops.
 *
 * Loop guard: a flag is set during local→remote writes that suppresses
 * the corresponding remote→local re-emission. Without it, every local
 * change would echo back through the Yjs observer and fire setProject,
 * which then triggers another store update, and so on.
 */
export function bindStoreToYjs(
  store: StoreApi<StoreShape>,
  projectMap: Y.Map<unknown>,
  doc: Y.Doc,
): BindHandle {
  // Re-entrancy flag: set while we're applying changes in either
  // direction. The corresponding listener bails when it sees the
  // flag, breaking the echo loop.
  let applyingLocal = false;
  let applyingRemote = false;
  let lastSerialized: string | null = null;

  // ---- Initial sync ----
  // If the remote map already has data (we joined a session in
  // progress, or IndexedDB rehydrated a prior session), adopt it.
  // Otherwise, seed the remote with the current local project so the
  // next peer to join sees the same starting point.
  const remoteRaw = projectMap.get(PROJECT_KEY) as string | undefined;
  if (typeof remoteRaw === 'string' && remoteRaw.length > 0) {
    try {
      const remoteProject = JSON.parse(remoteRaw) as Project;
      applyingRemote = true;
      try {
        store.getState().setProject(remoteProject);
        lastSerialized = remoteRaw;
      } finally {
        applyingRemote = false;
      }
    } catch (err) {
      console.warn('[opencad collab] failed to parse remote project', err);
    }
  } else {
    const local = store.getState().project;
    const serialized = serializeProject(local);
    applyingLocal = true;
    try {
      doc.transact(() => {
        projectMap.set(PROJECT_KEY, serialized);
      }, 'local');
      lastSerialized = serialized;
    } finally {
      applyingLocal = false;
    }
  }

  // ---- Local → Remote ----
  // Subscribe to project mutations on the store. Whenever the
  // identity of `project` changes, serialise and push to the Y.Map.
  const unsubStore = store.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (applyingRemote) return; // we caused this update
    const serialized = serializeProject(state.project);
    if (serialized === lastSerialized) return; // nothing changed payload-wise
    applyingLocal = true;
    try {
      doc.transact(() => {
        projectMap.set(PROJECT_KEY, serialized);
      }, 'local');
      lastSerialized = serialized;
    } finally {
      applyingLocal = false;
    }
  });

  // ---- Remote → Local ----
  const onMapChange = (
    _event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ) => {
    if (applyingLocal) return; // we caused this update
    if (transaction.origin === 'local') return; // belt-and-braces
    const raw = projectMap.get(PROJECT_KEY) as string | undefined;
    if (typeof raw !== 'string' || raw.length === 0) return;
    if (raw === lastSerialized) return;
    let next: Project;
    try {
      next = JSON.parse(raw) as Project;
    } catch (err) {
      console.warn('[opencad collab] failed to parse remote update', err);
      return;
    }
    applyingRemote = true;
    try {
      store.getState().setProject(next);
      lastSerialized = raw;
    } finally {
      applyingRemote = false;
    }
  };
  projectMap.observe(onMapChange);

  return {
    dispose: () => {
      unsubStore();
      projectMap.unobserve(onMapChange);
    },
  };
}

/** Backwards-compat thin alias — same binding handles both directions. */
export const bindYjsToStore = bindStoreToYjs;

/**
 * Drop fields that aren't useful to share over the wire. Catalogues
 * are 100KB+ of static data that the receiving peer rehydrates from
 * its own bundle — sending them would balloon every sync update.
 */
function serializeProject(p: Project): string {
  // Strip catalogues (rehydrated from bundle on the receiver).
  const { catalogues: _omit, ...rest } = p;
  return JSON.stringify(rest);
}
