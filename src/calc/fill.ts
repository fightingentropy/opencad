// Cable fill calculations: occupied cross-section vs containment internal CSA.

import type { ContainmentEntity, ContainmentType } from '../types';
import type { Cable } from '../models/cable';
import {
  FILL_LIMITS,
  SPACE_FACTOR_TRUNKING_BS7671,
  type StandardsCode,
  type StandardsProfile,
} from '../models/standards';

export type FillStatus = 'ok' | 'warning' | 'over';

export interface FillResult {
  fillPct: number;
  fillStatus: FillStatus;
  innerAreaMm2: number;
  occupiedAreaMm2: number;
  cableCount: number;
  limit: number;
}

const DEFAULT_WALL_THICKNESS_MM = 1.5;

export const containmentInnerArea = (containment: ContainmentEntity): number => {
  if (typeof containment.innerCsaMm2 === 'number' && containment.innerCsaMm2 > 0) {
    return containment.innerCsaMm2;
  }
  const w = containment.width ?? 0;
  const h = containment.height ?? 0;
  if (w <= 0) return 0;
  if (containment.containmentType === 'conduit') {
    const id = w;
    return (Math.PI / 4) * id * id;
  }
  const t = DEFAULT_WALL_THICKNESS_MM;
  const innerW = Math.max(0, w - 2 * t);
  const innerH = Math.max(0, (h > 0 ? h : w) - 2 * t);
  return innerW * innerH;
};

const cableCsaCircle = (cable: Cable): number => {
  const od = cable.outerDiameter;
  if (od <= 0) return 0;
  return (Math.PI / 4) * od * od;
};

const cableCsaBs7671Trunking = (cable: Cable): number => {
  const factor = SPACE_FACTOR_TRUNKING_BS7671[cable.csa];
  if (typeof factor === 'number') return factor * cable.cores;
  return cableCsaCircle(cable) * cable.cores;
};

const necTierLimit = (count: number, limits: typeof FILL_LIMITS[StandardsCode]): number => {
  if (count <= 1) return limits.nec1Conductor ?? limits.conduit;
  if (count === 2) return limits.nec2Conductor ?? limits.conduit;
  return limits.nec3PlusConductor ?? limits.conduit;
};

const limitFor = (
  code: StandardsCode,
  containmentType: ContainmentType,
  cableCount: number,
): number => {
  const limits = FILL_LIMITS[code];
  if (code === 'NEC' && containmentType === 'conduit') {
    return necTierLimit(cableCount, limits);
  }
  switch (containmentType) {
    case 'trunking':
    case 'duct':
    case 'busbar':
      return limits.trunking;
    case 'conduit':
      return limits.conduit;
    case 'tray':
      return limits.cableTray;
    case 'ladder':
      return limits.cableLadder;
    case 'basket':
      return limits.cableBasket;
  }
};

export const fillStatus = (
  pct: number,
  standards: StandardsProfile,
  containmentKind: ContainmentType,
): FillStatus => {
  const limit = limitFor(standards.code, containmentKind, 1);
  const overPct = limit * 100;
  if (containmentKind === 'trunking' || containmentKind === 'duct' || containmentKind === 'busbar') {
    if (pct > 45) return 'over';
    if (pct >= 35) return 'warning';
    return 'ok';
  }
  if (pct > overPct) return 'over';
  if (pct >= overPct - 10) return 'warning';
  return 'ok';
};

export const computeContainmentFill = (
  containment: ContainmentEntity,
  cables: Cable[],
  standards: StandardsProfile,
): FillResult => {
  const innerAreaMm2 = containmentInnerArea(containment);
  const useBs7671Trunking =
    standards.code === 'BS7671' && containment.containmentType === 'trunking';
  let occupiedAreaMm2 = 0;
  for (const c of cables) {
    occupiedAreaMm2 += useBs7671Trunking ? cableCsaBs7671Trunking(c) : cableCsaCircle(c);
  }
  const limit = limitFor(standards.code, containment.containmentType, cables.length);
  const fillPct = innerAreaMm2 > 0 ? (occupiedAreaMm2 / innerAreaMm2) * 100 : 0;
  return {
    fillPct,
    fillStatus: fillStatus(fillPct, standards, containment.containmentType),
    innerAreaMm2,
    occupiedAreaMm2,
    cableCount: cables.length,
    limit,
  };
};
