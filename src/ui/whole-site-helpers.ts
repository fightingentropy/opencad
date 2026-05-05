// Shared helpers for whole-site UI panels.
//
// Thin facade over the engineering calculations engine in `src/calc/*`.
// Bodies delegate to the real engine; the UI imports from this module so
// the public API stays stable while internals can evolve.

import type { Project, Entity, Sheet, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import {
  AMPACITY_REF_C_PVC_COPPER,
  AMPACITY_REF_C_XLPE_COPPER,
  DEFAULT_STANDARDS,
} from '../models/standards';
import type { StandardsCode, StandardsProfile } from '../models/standards';
import {
  computeContainmentFill,
  computeVoltageDrop,
  computeDeratingFactors,
  polylineLength,
  type InstallationMethod,
} from '../calc';

export const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;
export const fmtMm = (v: number | undefined): string => (v == null ? '—' : `${v.toFixed(0)}`);
export const fmtNum = (v: number | undefined, digits = 1): string => (v == null ? '—' : v.toFixed(digits));

// Resolve the active standards profile for a project (defaults to BS 7671).
export const projectStandardsCode = (p: Project): StandardsCode =>
  p.standardsProfile?.code ?? 'BS7671';

const projectStandardsProfile = (p: Project): StandardsProfile =>
  p.standardsProfile ?? DEFAULT_STANDARDS.BS7671;

// Compute fill ratio for a single containment given list of cables routed
// through it. Returns 0..1. Delegates to `computeContainmentFill` and adapts
// the result to the legacy {fill, limit, ok} shape the UI expects.
export const computeFill = (
  cont: ContainmentEntity,
  cables: Cable[],
  project?: Project,
): { fill: number; limit: number; ok: boolean } => {
  const standards = project ? projectStandardsProfile(project) : DEFAULT_STANDARDS.BS7671;
  const r = computeContainmentFill(cont, cables, standards);
  return {
    fill: r.fillPct / 100,
    limit: r.limit,
    ok: r.fillStatus !== 'over',
  };
};

const installationMethodFor = (cable: Cable): InstallationMethod => {
  // Approximate installation method from the cable's first containment.
  // The UI doesn't have a richer hint; fall back to a tray/clipped default.
  return 'tray';
};

// Voltage-drop estimate. Adapts `computeVoltageDrop` to the legacy
// {vdropV, vdropPct (fraction), ok, limit (fraction)} shape.
export const estimateVdrop = (
  cable: Cable,
  lengthM: number,
  project?: Project,
): { vdropV: number; vdropPct: number; ok: boolean; limit: number } => {
  const ib = cable.designCurrent ?? 0;
  const standardsCode = project ? projectStandardsCode(project) : 'BS7671';
  const loadCategory = cable.circuitType === 'fire-alarm' || cable.circuitType === 'emergency'
    ? 'other'
    : 'other';
  const r = computeVoltageDrop({
    construction: cable.construction,
    csa: cable.csa,
    lengthM,
    designCurrentA: ib,
    systemVoltageV: cable.voltage || 230,
    phasing: cable.cores >= 3 ? 'three' : 'single',
    loadCategory,
    standardsCode,
  });
  return {
    vdropV: r.vdropV,
    vdropPct: r.vdropPct / 100,
    ok: r.withinLimits,
    limit: r.limitPct / 100,
  };
};

// Quick ampacity check using BS 7671 Reference Method C base ampacity table
// combined with the derating factors engine (grouping based on cables on the
// same containment when a project is supplied).
export const estimateAmpacity = (
  cable: Cable,
  project?: Project,
): { iz: number; ib: number; ok: boolean } => {
  const ib = cable.designCurrent ?? 0;
  const isXlpe = cable.construction.startsWith('XLPE');
  const baseTable = isXlpe ? AMPACITY_REF_C_XLPE_COPPER : AMPACITY_REF_C_PVC_COPPER;
  const baseIz = baseTable[cable.csa] ?? 0;
  // Estimate group size: the largest count of cables sharing any containment
  // segment on this cable's route. Falls back to 1 when no project provided.
  let numCircuits = 1;
  if (project && cable.route.length > 0) {
    const cables = project.cableSchedule?.cables ?? {};
    const cableList = Object.values(cables);
    let maxShared = 1;
    for (const cid of cable.route) {
      const shared = cableList.filter((c) => c.route.includes(cid)).length;
      if (shared > maxShared) maxShared = shared;
    }
    numCircuits = maxShared;
  }
  const factors = computeDeratingFactors({
    numCircuits,
    ambientC: 30,
    installationMethod: installationMethodFor(cable),
    insulation: isXlpe ? 'XLPE' : 'PVC',
  });
  const iz = baseIz * factors.totalFactor;
  return { iz, ib, ok: iz >= ib };
};

// Estimate cable run length from route entities (sum polyline lengths in m).
// Uses `polylineLength` from the supports calc module so this stays
// consistent with what the compliance engine measures.
export const estimateCableLength = (cable: Cable, project: Project): number => {
  let mm = 0;
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of cable.route) {
      const e = sheet.entities[id];
      if (!e) continue;
      if (e.kind === 'containment' || e.kind === 'wire') {
        const pts = (e as ContainmentEntity).points;
        if (!pts) continue;
        mm += polylineLength(pts);
      }
    }
  }
  return mm / 1000 + (cable.lengthAllowance ?? 0);
};

// Find the sheet that contains a given entity ID — used by drill-down
// navigation in the compliance dashboard.
export const findSheetForEntity = (
  project: Project,
  entityId: string,
): Sheet | null => {
  for (const sid of project.sheetOrder) {
    const s = project.sheets[sid];
    if (s && s.entities[entityId]) return s;
  }
  return null;
};

// Filter helpers for the panels.
export const allContainmentEntities = (
  project: Project,
): { entity: ContainmentEntity; sheetId: string }[] => {
  const out: { entity: ContainmentEntity; sheetId: string }[] = [];
  for (const sid of project.sheetOrder) {
    const s = project.sheets[sid];
    if (!s) continue;
    for (const eid of s.entityOrder) {
      const e = s.entities[eid] as Entity;
      if (e && e.kind === 'containment') {
        out.push({ entity: e as ContainmentEntity, sheetId: sid });
      }
    }
  }
  return out;
};

export const cablesOnContainment = (project: Project, containmentId: string): Cable[] => {
  const cables = project.cableSchedule?.cables ?? {};
  const order = project.cableSchedule?.cableOrder ?? [];
  const out: Cable[] = [];
  for (const cid of order) {
    const c = cables[cid];
    if (!c) continue;
    if (c.route.includes(containmentId)) out.push(c);
  }
  return out;
};

// Convenience writer for editor flags that aren't yet first-class store
// actions. Uses zustand's setState through useStore.setState.
import { useStore } from '../state/store';

export const setEditorPatch = (patch: Partial<{
  phaseFilter: import('../models/revision').ConstructionPhase | 'all';
  systemFilter: string | 'all';
  complianceOverlay: 'off' | 'fill' | 'segregation' | 'support-spacing';
}>): void => {
  useStore.setState((s) => ({
    editor: { ...s.editor, ...patch },
  }));
};
