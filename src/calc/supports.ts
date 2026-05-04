// Support span and load calculation per BS EN 61537 / manufacturer data.

import type { ContainmentEntity, SupportEntity, Vec2 } from '../types';
import type { Cable } from '../models/cable';
import { SUPPORT_SPANS_HORIZONTAL_MM } from '../models/standards';

const dist = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

export const polylineLength = (points: Vec2[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
};

const lookupSpan = (table: Record<number, number>, size: number): number => {
  if (table[size] !== undefined) return table[size];
  const keys = Object.keys(table)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  if (keys.length === 0) return 1500;
  if (size <= keys[0]) return table[keys[0]];
  if (size >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  // Pick the next-larger size's span (more conservative)
  for (let i = 0; i < keys.length - 1; i++) {
    if (size > keys[i] && size < keys[i + 1]) return table[keys[i + 1]];
  }
  return table[keys[keys.length - 1]];
};

export const computeSupportSpacing = (containment: ContainmentEntity): number => {
  const t = containment.containmentType;
  const w = containment.width ?? 100;
  if (t === 'ladder') return lookupSpan(SUPPORT_SPANS_HORIZONTAL_MM.ladder, w);
  if (t === 'tray') return lookupSpan(SUPPORT_SPANS_HORIZONTAL_MM.tray, w);
  if (t === 'basket') return lookupSpan(SUPPORT_SPANS_HORIZONTAL_MM.basket, w);
  if (t === 'trunking') return lookupSpan(SUPPORT_SPANS_HORIZONTAL_MM.trunking, w);
  if (t === 'conduit') {
    const sub = containment.subType;
    const isPvc = sub === 'rigid-pvc' || sub === 'flexible-plastic' || sub === 'lsoh-conduit';
    const tbl = isPvc
      ? SUPPORT_SPANS_HORIZONTAL_MM.conduit_pvc
      : SUPPORT_SPANS_HORIZONTAL_MM.conduit_steel;
    return lookupSpan(tbl, w);
  }
  return 1500;
};

// Place support points along a polyline at intervals ≤ maxSpan, with
// extra supports within 300 mm of every direction change and endpoint.
export interface SupportPlacement {
  position: Vec2;
  // Cumulative distance along the route (mm) — useful for ordering.
  distanceAlong: number;
  reason: 'span' | 'bend' | 'end';
}

const NEAR_BEND_MM = 300;
const ANGLE_TOL = 0.087; // ~5 degrees

export const placeSupportPositions = (containment: ContainmentEntity): SupportPlacement[] => {
  const pts = containment.points;
  if (!pts || pts.length < 2) return [];
  const maxSpan = computeSupportSpacing(containment);

  // Pre-compute cumulative distance for each vertex
  const cumLen: number[] = [0];
  for (let i = 1; i < pts.length; i++) cumLen.push(cumLen[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cumLen[pts.length - 1];

  const placements: SupportPlacement[] = [];
  const seen = new Set<number>();
  const add = (d: number, reason: SupportPlacement['reason']) => {
    if (d < 0 || d > total) return;
    const key = Math.round(d / 5) * 5;
    if (seen.has(key)) return;
    seen.add(key);
    placements.push({ position: pointAt(pts, cumLen, d), distanceAlong: d, reason });
  };

  // Endpoints
  add(0, 'end');
  add(total, 'end');

  // Bends — vertex angle > tolerance counts as a direction change
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    if (m1 < 1e-3 || m2 < 1e-3) continue;
    const cosA = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
    if (angle > ANGLE_TOL) {
      add(Math.max(0, cumLen[i] - NEAR_BEND_MM), 'bend');
      add(Math.min(total, cumLen[i] + NEAR_BEND_MM), 'bend');
    }
  }

  // Span supports
  let d = maxSpan;
  while (d < total) {
    add(d, 'span');
    d += maxSpan;
  }

  return placements.sort((a, b) => a.distanceAlong - b.distanceAlong);
};

const pointAt = (pts: Vec2[], cumLen: number[], d: number): Vec2 => {
  for (let i = 1; i < pts.length; i++) {
    if (d <= cumLen[i]) {
      const segLen = cumLen[i] - cumLen[i - 1];
      const t = segLen > 0 ? (d - cumLen[i - 1]) / segLen : 0;
      const a = pts[i - 1];
      const b = pts[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return pts[pts.length - 1];
};

// Mass per metre is taken from cable.massPerMetre when set, else estimated
// from CSA and cores as a rough fallback (copper ~9 g/mm² per metre with
// insulation overhead).
const fallbackCableMassPerMetre = (cable: Cable): number => {
  const copperPerCorePerMetre = cable.csa * 0.0089; // kg/m per core, rough
  const insulationOverhead = 1.6;
  return copperPerCorePerMetre * cable.cores * insulationOverhead;
};

export const cableLoadKgPerMetre = (cables: Cable[]): number => {
  let total = 0;
  for (const c of cables) total += c.massPerMetre ?? fallbackCableMassPerMetre(c);
  return total;
};

const containmentSelfMassKgPerMetre = (containment: ContainmentEntity): number => {
  // Rough tabulated steel containment self-weight estimates (kg/m)
  switch (containment.containmentType) {
    case 'ladder':
      return 6 + (containment.width ?? 300) * 0.012;
    case 'tray':
      return 3 + (containment.width ?? 200) * 0.008;
    case 'basket':
      return 1.5 + (containment.width ?? 100) * 0.004;
    case 'trunking':
      return 2 + (containment.width ?? 100) * 0.005;
    case 'conduit':
      return 0.5 + (containment.width ?? 25) * 0.02;
    default:
      return 2;
  }
};

export interface SupportLoadVerdict {
  ok: boolean;
  totalLoadKg: number;
  capacityKg: number;
  spanM: number;
}

export const verifySupportLoad = (
  containment: ContainmentEntity,
  support: SupportEntity,
  cables: Cable[],
): SupportLoadVerdict => {
  const spanMm = computeSupportSpacing(containment);
  const spanM = spanMm / 1000;
  const linealKg =
    cableLoadKgPerMetre(cables) + containmentSelfMassKgPerMetre(containment);
  const totalLoadKg = linealKg * spanM;
  const capacityKg = support.safeWorkingLoadKg ?? defaultSwl(support.supportKind);
  return { ok: totalLoadKg <= capacityKg, totalLoadKg, capacityKg, spanM };
};

const defaultSwl = (kind: SupportEntity['supportKind']): number => {
  switch (kind) {
    case 'trapeze-hanger':
      return 100;
    case 'wall-bracket':
    case 'cantilever-arm':
      return 60;
    case 'a-frame':
    case 'floor-stand':
      return 200;
    case 'beam-clamp':
      return 50;
    case 'saddle-clip':
    case 'multi-saddle':
      return 10;
    case 'channel-bracket':
    case 'unistrut-frame':
      return 80;
    case 'ceiling-bracket':
      return 40;
    default:
      return 50;
  }
};
