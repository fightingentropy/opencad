// Segregation rule check — BS 7671 Reg 528 / NEC Article 725 / IET GN1.
// Power and data must be separated by partition or distance; fire alarm
// generally requires dedicated containment unless cables are fire-rated.

import type { ContainmentEntity } from '../types';
import type { Cable, CableCircuitType } from '../models/cable';
import { SEGREGATION_MIN_MM } from '../models/standards';

export type Severity = 'warning' | 'error';

export interface SegregationViolation {
  kind:
    | 'mixed-bands'
    | 'fire-alarm-shared'
    | 'emergency-shared'
    | 'data-power-mixed'
    | 'partition-required'
    | 'separation-too-small';
  message: string;
  severity: Severity;
  containmentId?: string;
  cableIds?: string[];
}

export interface SegregationResult {
  ok: boolean;
  containmentId: string;
  // The unique circuit categories present in this containment
  categoriesPresent: CableCircuitType[];
  // Whether multi-compartment trunking can satisfy the segregation
  hasPartition: boolean;
  violations: SegregationViolation[];
}

const isPower = (t: CableCircuitType): boolean => t === 'power' || t === 'control';
const isLowEnergy = (t: CableCircuitType): boolean =>
  t === 'data' || t === 'comms' || t === 'av' || t === 'instrumentation';

export const checkSegregation = (
  containment: ContainmentEntity,
  assignedCables: Cable[],
): SegregationResult => {
  const cats = Array.from(new Set(assignedCables.map((c) => c.circuitType)));
  const hasPartition = (containment.compartments ?? 1) > 1;
  const violations: SegregationViolation[] = [];

  const hasPower = cats.some(isPower);
  const hasLowEnergy = cats.some(isLowEnergy);
  const hasFire = cats.includes('fire-alarm');
  const hasEmergency = cats.includes('emergency');

  if (hasPower && hasLowEnergy && !hasPartition) {
    violations.push({
      kind: 'data-power-mixed',
      severity: 'error',
      message:
        'Power and data circuits share this containment without a partition (BS 7671 528.1).',
      containmentId: containment.id,
      cableIds: assignedCables
        .filter((c) => isPower(c.circuitType) || isLowEnergy(c.circuitType))
        .map((c) => c.id),
    });
  }

  if (hasFire && cats.length > 1 && !hasPartition) {
    violations.push({
      kind: 'fire-alarm-shared',
      severity: 'error',
      message:
        'Fire alarm cables share containment with other circuits — dedicated or fire-rated containment required (BS 5839).',
      containmentId: containment.id,
      cableIds: assignedCables.filter((c) => c.circuitType === 'fire-alarm').map((c) => c.id),
    });
  }

  if (hasEmergency && cats.length > 1 && !hasPartition) {
    violations.push({
      kind: 'emergency-shared',
      severity: 'warning',
      message:
        'Emergency lighting cables share containment with other circuits — segregation recommended.',
      containmentId: containment.id,
      cableIds: assignedCables.filter((c) => c.circuitType === 'emergency').map((c) => c.id),
    });
  }

  // Containment-declared cable category mismatch
  const declared = containment.cableCategory;
  if (declared && declared !== 'mixed') {
    for (const c of assignedCables) {
      if (categoryMatch(declared, c.circuitType)) continue;
      violations.push({
        kind: 'partition-required',
        severity: 'warning',
        message: `Cable ${c.reference} (${c.circuitType}) routed through ${declared}-only containment.`,
        containmentId: containment.id,
        cableIds: [c.id],
      });
    }
  }

  return {
    ok: violations.filter((v) => v.severity === 'error').length === 0,
    containmentId: containment.id,
    categoriesPresent: cats,
    hasPartition,
    violations,
  };
};

const categoryMatch = (
  declared: NonNullable<ContainmentEntity['cableCategory']>,
  cat: CableCircuitType,
): boolean => {
  switch (declared) {
    case 'power':
      return cat === 'power' || cat === 'control';
    case 'data':
      return cat === 'data' || cat === 'comms';
    case 'fire-alarm':
      return cat === 'fire-alarm';
    case 'emergency':
      return cat === 'emergency';
    case 'comms':
      return cat === 'comms' || cat === 'data';
    case 'instrumentation':
      return cat === 'instrumentation' || cat === 'control';
    case 'mixed':
      return true;
  }
};

// Pairwise containment separation — given two parallel runs carrying
// different categories, check that the centerlines (or band edges) are
// at least the minimum required distance apart.
export interface PairSeparationResult {
  ok: boolean;
  distance: number;
  required: number;
  category1: string;
  category2: string;
}

export const checkContainmentPairSeparation = (
  c1: ContainmentEntity,
  c2: ContainmentEntity,
  measuredDistanceMm: number,
): PairSeparationResult => {
  const cat1 = c1.cableCategory ?? 'mixed';
  const cat2 = c2.cableCategory ?? 'mixed';
  const required =
    SEGREGATION_MIN_MM[cat1]?.[cat2] ?? SEGREGATION_MIN_MM[cat2]?.[cat1] ?? 0;
  return {
    ok: measuredDistanceMm >= required,
    distance: measuredDistanceMm,
    required,
    category1: cat1,
    category2: cat2,
  };
};
