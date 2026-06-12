import type { Project } from '../types';

// Structural validation shared by every path that installs a whole project:
// File → Open (io/project.ts) and the localStorage autosave (io/persist.ts).
// The checks are deliberately shallow — containers exist and every id in an
// order array resolves — because that is exactly the depth the render and
// migration code dereferences without guarding (e.g. `layers[id].visible` in
// the layer list, `Object.values(sheet.entities)` in the migration shims).
// Per-entity field validation is left to the canvas, which already tolerates
// odd entities; a missing `sheets` record, by contrast, takes down the whole
// app and lets autosave overwrite the last good copy with the wreckage.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * Returns a human-readable list of structural defects, empty when the value
 * is safe to hand to setProject. Callers decide how to surface the list —
 * File → Open joins it into the error toast, the autosave guard logs it.
 */
export function projectStructureDefects(value: unknown): string[] {
  if (!isRecord(value)) return ['project is not an object'];
  const defects: string[] = [];

  if (typeof value.id !== 'string' || value.id.length === 0) defects.push('missing project id');
  if (typeof value.name !== 'string') defects.push('missing project name');

  const sheets = value.sheets;
  if (!isRecord(sheets)) {
    defects.push('missing sheets');
  } else {
    for (const [sheetId, sheet] of Object.entries(sheets)) {
      if (!isRecord(sheet)) {
        defects.push(`sheet "${sheetId}" is not an object`);
        continue;
      }
      if (!isRecord(sheet.entities)) defects.push(`sheet "${sheetId}" has no entities record`);
      if (!isStringArray(sheet.entityOrder)) defects.push(`sheet "${sheetId}" has no entity order`);
    }
  }

  if (!isStringArray(value.sheetOrder)) {
    defects.push('missing sheet order');
  } else if (value.sheetOrder.length === 0) {
    defects.push('project has no sheets');
  } else if (isRecord(sheets)) {
    for (const sheetId of value.sheetOrder) {
      if (!(sheetId in sheets)) defects.push(`sheet order references missing sheet "${sheetId}"`);
    }
  }

  const layers = value.layers;
  if (!isRecord(layers)) defects.push('missing layers');
  if (!isStringArray(value.layerOrder)) {
    defects.push('missing layer order');
  } else if (isRecord(layers)) {
    for (const layerId of value.layerOrder) {
      if (!(layerId in layers)) defects.push(`layer order references missing layer "${layerId}"`);
    }
  }

  if (typeof value.activeSheetId !== 'string') {
    defects.push('missing active sheet id');
  } else if (isRecord(sheets) && !(value.activeSheetId in sheets)) {
    defects.push(`active sheet "${value.activeSheetId}" does not exist`);
  }

  // activeLayerId only has to be a string — projects with zero layers are
  // legal (the id then points at nothing and downstream code tolerates it),
  // so resolution is not required the way it is for activeSheetId.
  if (typeof value.activeLayerId !== 'string') defects.push('missing active layer id');

  return defects;
}

/** Type-guard convenience over projectStructureDefects. */
export const isStructurallyValidProject = (value: unknown): value is Project =>
  projectStructureDefects(value).length === 0;

/**
 * Best-effort structural repair, run before projectStructureDefects on both
 * install paths (File → Open and the autosave loader). Mutates `value` in
 * place — callers always hold a freshly-parsed JSON blob, never live store
 * state.
 *
 * Only repairs that cannot lose drawing data are attempted:
 * - derivable fields are rebuilt (order arrays from their records, active
 *   ids from their orders, a fresh project id/name);
 * - dangling order ids are dropped — a dangling id points at an entry that
 *   no longer exists, so removing it discards nothing;
 * - entries present in a record but missing from its order array are
 *   appended, so they become visible again instead of being silently lost.
 *
 * Sheets and their `entities` records are never fabricated: inventing an
 * empty `entities` for a damaged sheet would silently turn data loss into a
 * blank sheet, which is exactly what this module exists to prevent — those
 * remain defects and the caller rejects the file. Unknown extra fields are
 * left untouched, so files written by newer app versions still load.
 *
 * Returns a human-readable list of repairs applied (empty = untouched).
 */
export function repairProjectStructure(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const repairs: string[] = [];

  if (typeof value.id !== 'string' || value.id.length === 0) {
    value.id = `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    repairs.push('generated a new project id');
  }
  if (typeof value.name !== 'string') {
    value.name = 'Untitled project';
    repairs.push('reset the missing project name');
  }

  const sheets = value.sheets;
  if (isRecord(sheets)) {
    // Per-sheet entity order. The entities record itself is never invented —
    // see the doc comment — but its order array is fully derivable.
    for (const [sheetId, sheet] of Object.entries(sheets)) {
      if (!isRecord(sheet) || !isRecord(sheet.entities)) continue; // left for the validator
      const entities = sheet.entities;
      if (!isStringArray(sheet.entityOrder)) {
        sheet.entityOrder = Object.keys(entities);
        repairs.push(`rebuilt the entity order of sheet "${sheetId}"`);
        continue;
      }
      const order = sheet.entityOrder;
      const kept = order.filter((id) => id in entities);
      if (kept.length !== order.length) {
        repairs.push(`dropped ${order.length - kept.length} dangling entity id(s) from sheet "${sheetId}"`);
        sheet.entityOrder = kept;
      }
      const present = new Set(kept);
      const orphaned = Object.keys(entities).filter((id) => !present.has(id));
      if (orphaned.length > 0) {
        sheet.entityOrder = [...kept, ...orphaned];
        repairs.push(`restored ${orphaned.length} entity(ies) to the draw order of sheet "${sheetId}"`);
      }
    }

    // Sheet order: drop dangling ids, rebuild from the record when empty or
    // missing, and re-append sheets the order lost track of.
    const sheetIds = Object.keys(sheets);
    if (isStringArray(value.sheetOrder)) {
      const kept = value.sheetOrder.filter((id) => id in sheets);
      if (kept.length === 0 && sheetIds.length > 0) {
        value.sheetOrder = sheetIds;
        repairs.push('rebuilt the sheet order from the sheets record');
      } else if (kept.length !== value.sheetOrder.length) {
        repairs.push(`dropped ${value.sheetOrder.length - kept.length} sheet order entr(ies) that match no sheet`);
        value.sheetOrder = kept;
      }
    } else if (sheetIds.length > 0) {
      value.sheetOrder = sheetIds;
      repairs.push('rebuilt the sheet order from the sheets record');
    }
    if (isStringArray(value.sheetOrder)) {
      const present = new Set(value.sheetOrder);
      const orphaned = sheetIds.filter((id) => !present.has(id));
      if (orphaned.length > 0) {
        value.sheetOrder = [...value.sheetOrder, ...orphaned];
        repairs.push(`restored ${orphaned.length} sheet(s) to the sheet order`);
      }
    }

    // Active sheet: must resolve; point it at the first ordered sheet.
    const order = isStringArray(value.sheetOrder) ? value.sheetOrder : [];
    if ((typeof value.activeSheetId !== 'string' || !(value.activeSheetId in sheets)) && order.length > 0) {
      value.activeSheetId = order[0];
      repairs.push('reset the active sheet to the first sheet');
    }
  }

  // Layers: zero layers is legal downstream, and a non-record here holds no
  // recoverable per-layer styling anyway, so an empty record is the safe
  // default. The layer order is then fully derivable.
  if (!isRecord(value.layers)) {
    value.layers = {};
    repairs.push('reset the missing layers record');
  }
  const layers = value.layers as Record<string, unknown>;
  if (isStringArray(value.layerOrder)) {
    const kept = value.layerOrder.filter((id) => id in layers);
    if (kept.length !== value.layerOrder.length) {
      repairs.push(`dropped ${value.layerOrder.length - kept.length} layer order entr(ies) that match no layer`);
      value.layerOrder = kept;
    }
    const present = new Set(kept);
    const orphaned = Object.keys(layers).filter((id) => !present.has(id));
    if (orphaned.length > 0) {
      value.layerOrder = [...kept, ...orphaned];
      repairs.push(`restored ${orphaned.length} layer(s) to the layer order`);
    }
  } else {
    value.layerOrder = Object.keys(layers);
    repairs.push('rebuilt the layer order from the layers record');
  }

  // Only string-ness is required (see the validator) — repair just the type.
  if (typeof value.activeLayerId !== 'string') {
    value.activeLayerId = (value.layerOrder as string[])[0] ?? '';
    repairs.push('reset the active layer');
  }

  return repairs;
}
