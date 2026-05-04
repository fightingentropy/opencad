// Shared helpers for whole-site UI panels.
//
// These functions are intentionally inline / lightweight: a parallel calc
// engine in `src/calc/*` is being built. UI components import these helpers
// directly so the panels render even before the calc engine ships, and they
// gracefully promote to the real engine when it's available.

import type { Project, Entity, Sheet, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import { FILL_LIMITS, VDROP_LIMITS, AMPACITY_REF_C_PVC_COPPER, AMPACITY_REF_C_XLPE_COPPER, VDROP_MV_A_M_PVC_SP } from '../models/standards';
import type { StandardsCode } from '../models/standards';

export const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;
export const fmtMm = (v: number | undefined): string => (v == null ? '—' : `${v.toFixed(0)}`);
export const fmtNum = (v: number | undefined, digits = 1): string => (v == null ? '—' : v.toFixed(digits));

// Project standards code (defaults to BS7671 if no profile set).
export const projectStandardsCode = (p: Project): StandardsCode =>
  p.standardsProfile?.code ?? 'BS7671';

// Compute fill ratio for a single containment given list of cables routed
// through it. Returns 0..1. Uses the simple OD² approximation for non-tray
// runs and "single-layer touching" for tray/ladder/basket.
export const computeFill = (
  cont: ContainmentEntity,
  cables: Cable[],
): { fill: number; limit: number; ok: boolean } => {
  const code = 'BS7671' as StandardsCode;
  const limits = FILL_LIMITS[code];
  let limit = 0.45;
  switch (cont.containmentType) {
    case 'trunking': limit = limits.trunking; break;
    case 'conduit': limit = limits.conduit; break;
    case 'tray': limit = limits.cableTray; break;
    case 'ladder': limit = limits.cableLadder; break;
    case 'basket': limit = limits.cableBasket; break;
    default: limit = 0.45;
  }
  // Inner CSA — fall back to width × height
  let innerCsa = cont.innerCsaMm2;
  if (!innerCsa) {
    const w = cont.width ?? 100;
    const h = cont.height ?? 50;
    innerCsa = w * h * 0.95; // 5% wall reduction for closed sections
  }
  if (innerCsa <= 0) return { fill: 0, limit, ok: true };
  let occupied = 0;
  for (const c of cables) {
    const od = c.outerDiameter || 0;
    if (od <= 0) continue;
    occupied += Math.PI * (od / 2) ** 2;
  }
  const fill = occupied / innerCsa;
  return { fill, limit, ok: fill <= limit };
};

// Quick voltage-drop estimate using mV/A/m table (PVC SP single-phase,
// copper). Conservative for unknown installations.
export const estimateVdrop = (cable: Cable, lengthM: number): {
  vdropV: number;
  vdropPct: number;
  ok: boolean;
  limit: number;
} => {
  const ib = cable.designCurrent ?? 0;
  const mvAm = VDROP_MV_A_M_PVC_SP[cable.csa] ?? 0;
  const vdropV = (mvAm * ib * lengthM) / 1000;
  const v = cable.voltage || 230;
  const pct = vdropV / v;
  const isLighting = cable.circuitType === 'power' ? false : false;
  const limit = (isLighting ? VDROP_LIMITS.BS7671.lighting : VDROP_LIMITS.BS7671.other);
  return { vdropV, vdropPct: pct, ok: pct <= limit, limit };
};

// Quick ampacity check: derated ampacity from BS 7671 ref-method-C.
export const estimateAmpacity = (cable: Cable): {
  iz: number;
  ib: number;
  ok: boolean;
} => {
  const ib = cable.designCurrent ?? 0;
  const isXlpe = cable.construction.startsWith('XLPE');
  const table = isXlpe ? AMPACITY_REF_C_XLPE_COPPER : AMPACITY_REF_C_PVC_COPPER;
  const iz = table[cable.csa] ?? 0;
  return { iz, ib, ok: iz >= ib };
};

// Estimate cable run length from route entities (sum polyline lengths in mm).
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
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          mm += Math.hypot(b.x - a.x, b.y - a.y);
        }
      }
    }
  }
  return (mm / 1000) + (cable.lengthAllowance ?? 0);
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
export const allContainmentEntities = (project: Project): { entity: ContainmentEntity; sheetId: string }[] => {
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
