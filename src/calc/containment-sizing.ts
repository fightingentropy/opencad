// Suggest containment sizes based on assigned cables and a target fill.

import type { ContainmentEntity, ContainmentType } from '../types';
import type { Cable } from '../models/cable';
import { FILL_LIMITS, type StandardsProfile } from '../models/standards';
import { containmentInnerArea } from './fill';

// Common standard sizes for each containment type.
// Width / Height in mm for rectangular; width = diameter for round.
const STANDARD_SIZES: Record<ContainmentType, { width: number; height: number }[]> = {
  trunking: [
    { width: 16, height: 16 }, { width: 25, height: 25 },
    { width: 38, height: 25 }, { width: 50, height: 50 },
    { width: 75, height: 50 }, { width: 75, height: 75 },
    { width: 100, height: 50 }, { width: 100, height: 75 },
    { width: 100, height: 100 }, { width: 150, height: 100 },
    { width: 150, height: 150 },
  ],
  tray: [
    { width: 100, height: 50 }, { width: 150, height: 50 },
    { width: 200, height: 50 }, { width: 200, height: 75 },
    { width: 300, height: 75 }, { width: 300, height: 100 },
    { width: 450, height: 100 }, { width: 600, height: 100 },
    { width: 600, height: 150 },
  ],
  ladder: [
    { width: 150, height: 75 }, { width: 300, height: 100 },
    { width: 450, height: 100 }, { width: 600, height: 100 },
    { width: 600, height: 125 }, { width: 750, height: 125 },
    { width: 900, height: 150 },
  ],
  basket: [
    { width: 60, height: 60 }, { width: 100, height: 60 },
    { width: 150, height: 60 }, { width: 200, height: 60 },
    { width: 300, height: 60 }, { width: 400, height: 60 },
    { width: 500, height: 60 }, { width: 600, height: 60 },
  ],
  conduit: [
    { width: 16, height: 16 }, { width: 20, height: 20 },
    { width: 25, height: 25 }, { width: 32, height: 32 },
    { width: 40, height: 40 }, { width: 50, height: 50 },
    { width: 63, height: 63 },
  ],
  duct: [
    { width: 110, height: 110 }, { width: 160, height: 160 },
    { width: 200, height: 200 },
  ],
  busbar: [
    { width: 100, height: 50 }, { width: 100, height: 100 },
    { width: 150, height: 100 }, { width: 200, height: 100 },
  ],
};

const occupiedArea = (cables: Cable[]): number => {
  let total = 0;
  for (const c of cables) {
    const od = c.outerDiameter;
    if (od <= 0) continue;
    total += (Math.PI / 4) * od * od;
  }
  return total;
};

const limitFor = (type: ContainmentType, standards: StandardsProfile): number => {
  const limits = FILL_LIMITS[standards.code];
  if (type === 'trunking' || type === 'duct' || type === 'busbar') return limits.trunking;
  if (type === 'conduit') return limits.conduit;
  if (type === 'tray') return limits.cableTray;
  if (type === 'ladder') return limits.cableLadder;
  if (type === 'basket') return limits.cableBasket;
  return 0.45;
};

export interface ContainmentSizingResult {
  width: number;
  height: number;
  innerArea: number;
  occupied: number;
  fillPct: number;
  ok: boolean;
}

export const suggestContainmentSize = (
  cables: Cable[],
  type: ContainmentType,
  standards: StandardsProfile,
  fillTargetOverride?: number,
): ContainmentSizingResult => {
  const occupied = occupiedArea(cables);
  const target = Math.min(fillTargetOverride ?? 1, limitFor(type, standards));
  const candidates = STANDARD_SIZES[type] ?? STANDARD_SIZES.tray;
  for (const size of candidates) {
    const fakeCont = {
      kind: 'containment',
      containmentType: type,
      width: size.width,
      height: size.height,
      points: [],
    } as unknown as ContainmentEntity;
    const inner = containmentInnerArea(fakeCont);
    if (inner <= 0) continue;
    const fillPct = (occupied / inner) * 100;
    if (fillPct / 100 <= target) {
      return { width: size.width, height: size.height, innerArea: inner, occupied, fillPct, ok: true };
    }
  }
  // None met the target — return the largest as a best effort
  const largest = candidates[candidates.length - 1];
  const fakeCont = {
    kind: 'containment',
    containmentType: type,
    width: largest.width,
    height: largest.height,
    points: [],
  } as unknown as ContainmentEntity;
  const inner = containmentInnerArea(fakeCont);
  return {
    width: largest.width,
    height: largest.height,
    innerArea: inner,
    occupied,
    fillPct: inner > 0 ? (occupied / inner) * 100 : 0,
    ok: false,
  };
};

export const standardSizesFor = (type: ContainmentType): { width: number; height: number }[] =>
  STANDARD_SIZES[type] ?? [];
