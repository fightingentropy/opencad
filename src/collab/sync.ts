// Bidirectional sync between the Zustand store and a Y.Doc.
//
// Strategy (v2, per-entity): instead of one JSON blob per project (the
// v1 MVP, which resolved every concurrent edit last-writer-wins at
// whole-project granularity), the project is fanned out across three
// top-level Y.Maps:
//
//   meta      PROJECT_META_KEY -> JSON of the project minus `sheets`
//             (and minus `catalogues`, which never travel — peers
//             rehydrate those from their own bundle)
//   sheets    sheetId -> JSON of the sheet minus its entities
//   entities  `${sheetId}␟${entityId}` -> JSON of a single entity
//
// Local store changes are diffed per entity — the store is immutable,
// so object identity tells us which sheets/entities a given update
// actually touched — and written as individual map entries. Remote
// transactions rebuild the project from the maps and replace the store
// project. Concurrent edits to different entities therefore merge
// cleanly; last-writer-wins now only applies when two peers edit the
// *same* entity (or the same sheet/project metadata) simultaneously.
//
// `entityOrder` and `sheetOrder` live inside sheet/project metadata,
// so a concurrent add on two peers would drop one id under plain LWW.
// The remote-apply path reconciles: order ids without a backing record
// are dropped, records missing from the order are appended in sorted
// order — deterministic, so every peer converges on the same list.
//
// Future work: model entity records as nested Y.Maps so concurrent
// edits to different *fields* of the same entity merge too.

import type * as Y from 'yjs';
import type { StoreApi } from 'zustand';
import type { Entity, EntityId, Project, Sheet, SheetId } from '../types';

// ---- v2 doc schema ----
// Top-level shared-type names. v1 stored a single blob under
// getMap('project'); the bumped names (and the bumped IndexedDB / room
// prefixes in ./yjs-doc) keep old project-blob docs from colliding
// with the per-entity layout.
const META_MAP_NAME = 'opencad-v2-meta';
const SHEETS_MAP_NAME = 'opencad-v2-sheets';
const ENTITIES_MAP_NAME = 'opencad-v2-entities';

/** Key inside the meta map holding the serialised project-level fields. */
export const PROJECT_META_KEY = 'project';

// Composite-key separator for the entities map. ASCII unit separator —
// it can't appear in nanoid-style ids or anything a sane import emits.
const KEY_SEP = '\u001f';

export interface CollabMaps {
  meta: Y.Map<unknown>;
  sheets: Y.Map<unknown>;
  entities: Y.Map<unknown>;
}

/** Resolve the three v2 shared maps on a doc. */
export const getCollabMaps = (doc: Y.Doc): CollabMaps => ({
  meta: doc.getMap<unknown>(META_MAP_NAME),
  sheets: doc.getMap<unknown>(SHEETS_MAP_NAME),
  entities: doc.getMap<unknown>(ENTITIES_MAP_NAME),
});

/** Composite key for one entity record in the entities map. */
export const entityKey = (sheetId: SheetId, entityId: EntityId): string =>
  `${sheetId}${KEY_SEP}${entityId}`;

const splitEntityKey = (key: string): [SheetId, EntityId] | null => {
  const i = key.indexOf(KEY_SEP);
  return i < 0 ? null : [key.slice(0, i), key.slice(i + 1)];
};

// Wire shapes: the project minus what's fanned out / never sent, and a
// sheet minus its entity records.
type ProjectWireMeta = Omit<Project, 'sheets' | 'catalogues'>;
type SheetShell = Omit<Sheet, 'entities'>;

const serializeProjectMeta = (p: Project): string => {
  // Sheets travel via the sheets/entities maps; catalogues are 100KB+
  // of static data the receiving peer rehydrates from its own bundle.
  const { sheets: _sheets, catalogues: _catalogues, ...rest } = p;
  return JSON.stringify(rest);
};

const serializeSheetShell = (s: Sheet): string => {
  const { entities: _entities, ...rest } = s;
  return JSON.stringify(rest);
};

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
  maps: CollabMaps,
  doc: Y.Doc,
): BindHandle {
  // Re-entrancy flags: set while we're applying changes in either
  // direction. The corresponding listener bails when it sees the
  // flag, breaking the echo loop.
  let applyingLocal = false;
  let applyingRemote = false;

  // Mirror of the string payloads we believe the maps hold — lets the
  // local→remote diff use plain string compares and detect deletions
  // without re-serialising the whole project on every store change.
  let sentMeta: string | null = null;
  const sentSheets = new Map<SheetId, string>();
  const sentEntities = new Map<string, string>();
  // The last project pushed or applied; object identity against it
  // tells us which sheets/entities a store update actually touched.
  let lastSynced: Project | null = null;

  const refreshMirrors = (): void => {
    const metaRaw = maps.meta.get(PROJECT_META_KEY);
    sentMeta = typeof metaRaw === 'string' ? metaRaw : null;
    sentSheets.clear();
    maps.sheets.forEach((raw, sheetId) => {
      if (typeof raw === 'string') sentSheets.set(sheetId, raw);
    });
    sentEntities.clear();
    maps.entities.forEach((raw, key) => {
      if (typeof raw === 'string') sentEntities.set(key, raw);
    });
  };

  // ---- Local → Remote ----
  const pushLocal = (project: Project): void => {
    const prev = lastSynced;
    // Which sheets actually changed? Store updates are immutable, so a
    // sheet that kept its object identity can be skipped wholesale.
    const changedSheets: SheetId[] = [];
    for (const sheetId of Object.keys(project.sheets)) {
      if (prev?.sheets[sheetId] !== project.sheets[sheetId] || !sentSheets.has(sheetId)) {
        changedSheets.push(sheetId);
      }
    }
    const removedSheets: SheetId[] = [];
    for (const sheetId of sentSheets.keys()) {
      if (!project.sheets[sheetId]) removedSheets.push(sheetId);
    }
    const metaSer = serializeProjectMeta(project);
    if (metaSer === sentMeta && changedSheets.length === 0 && removedSheets.length === 0) {
      lastSynced = project;
      return; // nothing changed payload-wise
    }
    applyingLocal = true;
    try {
      doc.transact(() => {
        if (metaSer !== sentMeta) {
          maps.meta.set(PROJECT_META_KEY, metaSer);
          sentMeta = metaSer;
        }
        for (const sheetId of removedSheets) {
          maps.sheets.delete(sheetId);
          sentSheets.delete(sheetId);
        }
        // Deletions: one pass over the mirror catches both the records
        // of removed sheets and entities removed from changed sheets.
        if (removedSheets.length > 0 || changedSheets.length > 0) {
          const changed = new Set(changedSheets);
          for (const key of [...sentEntities.keys()]) {
            const parts = splitEntityKey(key);
            if (!parts) continue;
            const [sheetId, entityId] = parts;
            const sheet = project.sheets[sheetId];
            if (sheet && (!changed.has(sheetId) || sheet.entities[entityId])) continue;
            maps.entities.delete(key);
            sentEntities.delete(key);
          }
        }
        // Adds / updates.
        for (const sheetId of changedSheets) {
          const sheet = project.sheets[sheetId];
          const prevSheet = prev?.sheets[sheetId];
          const shellSer = serializeSheetShell(sheet);
          if (shellSer !== sentSheets.get(sheetId)) {
            maps.sheets.set(sheetId, shellSer);
            sentSheets.set(sheetId, shellSer);
          }
          for (const entityId of Object.keys(sheet.entities)) {
            const key = entityKey(sheetId, entityId);
            if (
              prevSheet &&
              prevSheet.entities[entityId] === sheet.entities[entityId] &&
              sentEntities.has(key)
            ) {
              continue; // untouched entity — skip the serialise entirely
            }
            const ser = JSON.stringify(sheet.entities[entityId]);
            if (ser !== sentEntities.get(key)) {
              maps.entities.set(key, ser);
              sentEntities.set(key, ser);
            }
          }
        }
      }, 'local');
    } finally {
      applyingLocal = false;
    }
    lastSynced = project;
  };

  // ---- Remote → Local ----
  const buildProjectFromMaps = (): Project | null => {
    const metaRaw = maps.meta.get(PROJECT_META_KEY);
    if (typeof metaRaw !== 'string' || metaRaw.length === 0) return null;
    let meta: ProjectWireMeta;
    try {
      meta = JSON.parse(metaRaw) as ProjectWireMeta;
    } catch (err) {
      console.warn('[opencad collab] failed to parse remote project meta', err);
      return null;
    }
    const sheets: Record<SheetId, Sheet> = {};
    maps.sheets.forEach((raw, sheetId) => {
      if (typeof raw !== 'string') return;
      try {
        const shell = JSON.parse(raw) as SheetShell;
        sheets[sheetId] = { ...shell, entities: {} };
      } catch (err) {
        console.warn('[opencad collab] failed to parse remote sheet', err);
      }
    });
    maps.entities.forEach((raw, key) => {
      if (typeof raw !== 'string') return;
      const parts = splitEntityKey(key);
      if (!parts) return;
      const [sheetId, entityId] = parts;
      const sheet = sheets[sheetId];
      if (!sheet) return; // record for a sheet that no longer exists
      try {
        sheet.entities[entityId] = JSON.parse(raw) as Entity;
      } catch (err) {
        console.warn('[opencad collab] failed to parse remote entity', err);
      }
    });
    if (Object.keys(sheets).length === 0) return null;

    // Reconcile entityOrder against the records that actually exist:
    // concurrent adds on two peers LWW the order, so drop ids whose
    // record was deleted elsewhere and append missing records (sorted,
    // so every peer reconciles to the identical list).
    for (const sheet of Object.values(sheets)) {
      const order = (sheet.entityOrder ?? []).filter((id) => sheet.entities[id] !== undefined);
      const present = new Set(order);
      const missing = Object.keys(sheet.entities)
        .filter((id) => !present.has(id))
        .sort();
      sheet.entityOrder = [...order, ...missing];
    }
    // Same reconciliation for the sheet list itself.
    const order = (meta.sheetOrder ?? []).filter((id) => sheets[id] !== undefined);
    const present = new Set(order);
    const missingSheets = Object.keys(sheets)
      .filter((id) => !present.has(id))
      .sort();
    const sheetOrder = [...order, ...missingSheets];

    // Active sheet/layer are per-user UI state: keep ours while they
    // still exist so a peer switching sheets doesn't yank ours around.
    const local = store.getState().project;
    const activeSheetId =
      sheets[local.activeSheetId] !== undefined
        ? local.activeSheetId
        : sheets[meta.activeSheetId] !== undefined
          ? meta.activeSheetId
          : sheetOrder[0];
    const activeLayerId =
      meta.layers[local.activeLayerId] !== undefined ? local.activeLayerId : meta.activeLayerId;

    return {
      ...meta,
      sheets,
      sheetOrder,
      activeSheetId,
      activeLayerId,
      // Catalogues never travel — the receiver keeps its bundle copy.
      catalogues: local.catalogues,
    };
  };

  const applyRemote = (): void => {
    const next = buildProjectFromMaps();
    if (!next) return;
    // Refresh the mirrors first so the next local diff compares against
    // what the doc now holds, not what we last wrote.
    refreshMirrors();
    applyingRemote = true;
    try {
      store.getState().setProject(next);
    } finally {
      applyingRemote = false;
    }
    lastSynced = next;
  };

  // ---- Initial sync ----
  // If the doc already holds a project (we joined a session in
  // progress, or IndexedDB rehydrated a prior session), adopt it.
  // Otherwise, seed the doc with the current local project so the
  // next peer to join sees the same starting point.
  if (typeof maps.meta.get(PROJECT_META_KEY) === 'string') {
    applyRemote();
  } else {
    pushLocal(store.getState().project);
  }

  // Subscribe to project mutations on the store. Whenever the identity
  // of `project` changes, diff per entity and push to the maps.
  const unsubStore = store.subscribe((state, prevState) => {
    if (state.project === prevState.project) return;
    if (applyingRemote) return; // we caused this update
    pushLocal(state.project);
  });

  // A remote transaction can touch all three maps; each map fires its
  // own observer call but they share one Transaction object, so dedupe
  // on it and rebuild the project once.
  let handledTx: Y.Transaction | null = null;
  const onRemoteChange = (
    _event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ): void => {
    if (applyingLocal) return; // we caused this update
    if (transaction.origin === 'local') return; // belt-and-braces
    if (transaction === handledTx) return; // already rebuilt for this tx
    handledTx = transaction;
    applyRemote();
  };
  maps.meta.observe(onRemoteChange);
  maps.sheets.observe(onRemoteChange);
  maps.entities.observe(onRemoteChange);

  return {
    dispose: () => {
      unsubStore();
      maps.meta.unobserve(onRemoteChange);
      maps.sheets.unobserve(onRemoteChange);
      maps.entities.unobserve(onRemoteChange);
    },
  };
}

/** Backwards-compat thin alias — same binding handles both directions. */
export const bindYjsToStore = bindStoreToYjs;
