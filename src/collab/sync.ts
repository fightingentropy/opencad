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
// transactions patch only the records they touched (see
// patchProjectFromMaps), falling back to a rebuild from the maps for
// sheet-list changes. Concurrent edits to different entities therefore merge
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
import { repairLayerNames } from '../lib/layer-names';
import { applyAuthenticatedCollaborationUpdate } from '../state/collaboration-guard';

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

// A sheet's entityOrder reconciled against the records that exist: ids whose
// record is gone are dropped and records missing from the order are appended
// in sorted order, so every peer ends up with the identical list.
const reconcileEntityOrder = (sheet: Sheet): EntityId[] => {
  const order = (sheet.entityOrder ?? []).filter((id) => sheet.entities[id] !== undefined);
  const present = new Set(order);
  const missing = Object.keys(sheet.entities)
    .filter((id) => !present.has(id))
    .sort();
  return [...order, ...missing];
};

// True when every project field that travels in the meta payload is the very
// same value as before (the store is immutable, so identity proves it).
const projectMetaUnchanged = (a: Project, b: Project): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'sheets' || key === 'catalogues') continue;
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
};

// True when the two projects differ in the meta payload only by `modified`,
// which every store edit bumps. Compared by value: a patched project's meta is
// parsed from the wire, so its fields are never identical to the old ones.
const projectMetaOnlyModifiedDiffers = (a: Project, b: Project): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'sheets' || key === 'catalogues' || key === 'modified') continue;
    if (JSON.stringify((a as unknown as Record<string, unknown>)[key]) !==
      JSON.stringify((b as unknown as Record<string, unknown>)[key])) return false;
  }
  return true;
};

// Carry the records a remote transaction touched into an undo/redo snapshot, so
// that undo reverts local edits without restoring stale copies of what a peer
// changed or deleted. Sheets the snapshot does not have are left alone.
const rebaseSnapshot = (
  snapshot: Project,
  remote: Project,
  sheetKeys: ReadonlySet<string>,
  entityKeys: ReadonlySet<string>,
): Project => {
  const ids = new Map<SheetId, EntityId[]>();
  for (const sheetId of sheetKeys) if (snapshot.sheets[sheetId] && remote.sheets[sheetId]) ids.set(sheetId, []);
  for (const key of entityKeys) {
    const parts = splitEntityKey(key);
    if (!parts || !snapshot.sheets[parts[0]] || !remote.sheets[parts[0]]) continue;
    ids.set(parts[0], [...(ids.get(parts[0]) ?? []), parts[1]]);
  }
  if (ids.size === 0) return snapshot;
  const sheets = { ...snapshot.sheets };
  for (const [sheetId, entityIds] of ids) {
    const { entities: _remoteEntities, ...remoteShell } = remote.sheets[sheetId];
    const entities = { ...snapshot.sheets[sheetId].entities };
    for (const id of entityIds) {
      const current = remote.sheets[sheetId].entities[id];
      if (current) entities[id] = current;
      else delete entities[id];
    }
    // A sheet whose shell changed takes the remote shell; the order is rebuilt
    // from the snapshot's own order, so local reordering is not lost.
    const sheet = { ...(sheetKeys.has(sheetId) ? remoteShell : snapshot.sheets[sheetId]), entities,
      entityOrder: snapshot.sheets[sheetId].entityOrder };
    sheets[sheetId] = { ...sheet, entityOrder: reconcileEntityOrder(sheet) };
  }
  return { ...snapshot, sheets };
};

interface BindHandle {
  /** Tear down both directions. */
  dispose: () => void;
}

interface StoreShape {
  project: Project;
  setProject: (p: Project) => void;
  /**
   * Replace the project with a remote state. When `rebase` is given, the local
   * undo and redo snapshots are kept and passed through it; without it the
   * history is cleared, as setProject does. Stores that do not provide it
   * fall back to setProject.
   */
  applyRemoteProject?: (p: Project, rebase?: (snapshot: Project) => Project) => void;
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
  options: { writeEnabled?: boolean } = {},
): BindHandle {
  const writeEnabled = options.writeEnabled ?? true;
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
    // Project-level fields keep their object identity across store updates
    // that only touch sheets, so skip re-serialising them when none changed.
    const metaSer =
      prev && sentMeta !== null && projectMetaUnchanged(prev, project)
        ? sentMeta
        : serializeProjectMeta(project);
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
      sheet.entityOrder = reconcileEntityOrder(sheet);
    }
    return assembleProject(meta, sheets);
  };

  // Combine parsed project meta with reconciled sheets into a project.
  const assembleProject = (meta: ProjectWireMeta, sheets: Record<SheetId, Sheet>): Project => {
    // Reconcile the sheet list itself the same way.
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

  // Patch the last synced project with only the records a remote
  // transaction touched. Entities and sheets that were not touched keep their
  // object identity, so identity-keyed caches (spatial index, 3D diff) stay
  // valid and nothing else is re-parsed. Returns null when a sheet was added or
  // removed or a record could not be read, and the
  // caller rebuilds the whole project instead.
  const patchProjectFromMaps = (
    base: Project,
    metaChanged: boolean,
    changedSheetKeys: ReadonlySet<string>,
    changedEntityKeys: ReadonlySet<string>,
  ): Project | null => {
    for (const sheetId of changedSheetKeys) {
      if ((maps.sheets.get(sheetId) !== undefined) !== (base.sheets[sheetId] !== undefined)) return null;
    }
    const entityIdsBySheet = new Map<SheetId, Set<EntityId>>();
    for (const key of changedEntityKeys) {
      const parts = splitEntityKey(key);
      if (!parts) continue;
      const [sheetId, entityId] = parts;
      if (maps.sheets.get(sheetId) === undefined) continue; // record for a sheet that no longer exists
      if (!base.sheets[sheetId]) return null;
      let ids = entityIdsBySheet.get(sheetId);
      if (!ids) entityIdsBySheet.set(sheetId, (ids = new Set()));
      ids.add(entityId);
    }
    const touched = new Set<SheetId>([...changedSheetKeys, ...entityIdsBySheet.keys()]);
    const sheets: Record<SheetId, Sheet> = { ...base.sheets };
    for (const sheetId of touched) {
      const baseSheet = base.sheets[sheetId];
      const entities: Record<EntityId, Entity> = { ...baseSheet.entities };
      let structural = false;
      for (const entityId of entityIdsBySheet.get(sheetId) ?? []) {
        const raw = maps.entities.get(entityKey(sheetId, entityId));
        let parsed: Entity | undefined;
        if (typeof raw === 'string') {
          try {
            parsed = JSON.parse(raw) as Entity;
          } catch (err) {
            console.warn('[opencad collab] failed to parse remote entity', err);
          }
        }
        if (parsed === undefined) {
          if (entityId in entities) {
            delete entities[entityId];
            structural = true;
          }
        } else {
          if (!(entityId in entities)) structural = true;
          entities[entityId] = parsed;
        }
      }
      if (!changedSheetKeys.has(sheetId) && !structural) {
        // Only existing entities changed: the order is still the reconciled one.
        sheets[sheetId] = { ...baseSheet, entities };
        continue;
      }
      const shellRaw = maps.sheets.get(sheetId);
      if (typeof shellRaw !== 'string') return null;
      let shell: SheetShell;
      try {
        shell = JSON.parse(shellRaw) as SheetShell;
      } catch (err) {
        console.warn('[opencad collab] failed to parse remote sheet', err);
        return null;
      }
      const sheet: Sheet = { ...shell, entities };
      sheet.entityOrder = reconcileEntityOrder(sheet);
      sheets[sheetId] = sheet;
    }
    if (!metaChanged) return { ...base, sheets };
    const metaRaw = maps.meta.get(PROJECT_META_KEY);
    if (typeof metaRaw !== 'string' || metaRaw.length === 0) return null;
    try {
      return assembleProject(JSON.parse(metaRaw) as ProjectWireMeta, sheets);
    } catch (err) {
      console.warn('[opencad collab] failed to parse remote project meta', err);
      return null;
    }
  };

  // Keys that differ between the mirror and the doc after a patch.
  const refreshMirrorKeys = (
    sheetKeys: ReadonlySet<string>,
    entityKeys: ReadonlySet<string>,
  ): void => {
    for (const sheetId of sheetKeys) {
      const raw = maps.sheets.get(sheetId);
      if (typeof raw === 'string') sentSheets.set(sheetId, raw);
      else sentSheets.delete(sheetId);
    }
    for (const key of entityKeys) {
      const raw = maps.entities.get(key);
      if (typeof raw === 'string') sentEntities.set(key, raw);
      else sentEntities.delete(key);
    }
  };

  // Set when a remote update could not be applied, so the next one cannot
  // trust the last synced project as a base and rebuilds from the maps.
  let needFullRebuild = false;

  const applyRemote = (changed?: {
    meta: boolean;
    sheets: ReadonlySet<string>;
    entities: ReadonlySet<string>;
  }): void => {
    let built: Project | null = null;
    let patched = false;
    if (changed && lastSynced && !needFullRebuild) {
      built = patchProjectFromMaps(lastSynced, changed.meta, changed.sheets, changed.entities);
      patched = built !== null;
    }
    if (!built) built = buildProjectFromMaps();
    if (!built) {
      needFullRebuild = true;
      return;
    }
    needFullRebuild = false;
    // A room can hold entities saved with a layer name as their layerId, which
    // are never drawn (see repairLayerNames). Files and autosaves are repaired
    // when they load; a room is repaired here, each time it is read, and only
    // in this peer's copy. Nothing is written back for it: a viewer could not,
    // and peers that all wrote on joining would be editing the room just by
    // opening it. The repair gives every peer the same result, including the
    // id of a layer it has to create, so when an edit does carry a repaired
    // entity or a created layer into the room, the peers agree on it.
    const next = repairLayerNames(built);
    // Refresh the mirrors first so the next local diff compares against
    // what the doc now holds, not what we last wrote.
    if (patched && changed) refreshMirrorKeys(changed.sheets, changed.entities);
    else refreshMirrors();
    applyingRemote = true;
    try {
      // A remote transaction that left the project settings alone and did not
      // add or remove a sheet keeps the local undo history, rebased onto the
      // remote state. Anything wider (settings changed, a sheet added or
      // removed, or a full rebuild) clears it.
      const state = store.getState();
      // A change to `modified` alone (every peer edit makes one) does not count
      // as a settings change.
      const keepHistory = patched && changed !== undefined && lastSynced !== null &&
        (!changed.meta || projectMetaOnlyModifiedDiffers(lastSynced, next));
      applyAuthenticatedCollaborationUpdate(() => {
        if (state.applyRemoteProject) {
          state.applyRemoteProject(next, keepHistory
            ? (snapshot) => rebaseSnapshot(snapshot, next, changed.sheets, changed.entities)
            : undefined);
        } else state.setProject(next);
      });
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
  } else if (writeEnabled) {
    pushLocal(store.getState().project);
  }

  // Subscribe to project mutations on the store. Whenever the identity
  // of `project` changes, diff per entity and push to the maps.
  const unsubStore = writeEnabled
    ? store.subscribe((state, prevState) => {
        if (state.project === prevState.project) return;
        if (applyingRemote) return; // we caused this update
        pushLocal(state.project);
      })
    : () => {};

  // A remote transaction can touch all three maps; each map fires its
  // own observer call but they share one Transaction object, so dedupe
  // on it and rebuild the project once.
  let handledTx: Y.Transaction | null = null;
  const changedKeys = (tx: Y.Transaction, map: Y.Map<unknown>): Set<string> => {
    const keys = new Set<string>();
    for (const key of tx.changed.get(map as unknown as Y.AbstractType<Y.YEvent<any>>) ?? []) if (key !== null) keys.add(key);
    return keys;
  };
  const onRemoteChange = (
    _event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ): void => {
    if (applyingLocal) return; // we caused this update
    if (transaction.origin === 'local') return; // belt-and-braces
    if (transaction === handledTx) return; // already rebuilt for this tx
    handledTx = transaction;
    applyRemote({
      meta: changedKeys(transaction, maps.meta).size > 0,
      sheets: changedKeys(transaction, maps.sheets),
      entities: changedKeys(transaction, maps.entities),
    });
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
