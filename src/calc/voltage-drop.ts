// Voltage drop calculation. Vd = (mV/A/m) * Ib * L / 1000 for single-phase
// loop; three-phase line-to-line uses sqrt(3) coefficient instead of 2.

import {
  VDROP_LIMITS,
  VDROP_MV_A_M_PVC_SP,
  VDROP_MV_A_M_XLPE_3P,
  createStandardsTrace,
  type StandardsCode,
  type StandardsTrace,
} from '../models/standards';
import type { Cable, CableConstruction } from '../models/cable';
import type { ElectricalSystem, SystemId } from '../models/site';

export type Phasing = 'single' | 'three';
export type LoadCategory = 'lighting' | 'other';

export interface VoltageDropOptions {
  construction: CableConstruction;
  csa: number;
  lengthM: number;
  designCurrentA: number;
  systemVoltageV: number;
  phasing: Phasing;
  loadCategory?: LoadCategory;
  standardsCode?: StandardsCode;
  // Optional override mV/A/m if the caller has site-specific data.
  mvAmOverride?: number;
}

export interface VoltageDropResult {
  vdropV: number;
  vdropPct: number;
  withinLimits: boolean;
  mvAm: number;
  limitPct: number;
  standards: StandardsTrace;
}

const isXlpe = (c: CableConstruction): boolean => c.includes('XLPE');

const lookupVdropTable = (csa: number, table: Record<number, number>): number => {
  if (table[csa] !== undefined) return table[csa];
  const keys = Object.keys(table)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  if (keys.length === 0) return 0;
  if (csa <= keys[0]) return table[keys[0]];
  if (csa >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (csa > keys[i] && csa < keys[i + 1]) return table[keys[i + 1]];
  }
  return table[keys[keys.length - 1]];
};

// Per metre, a single-phase loop drops 2·I·Z and a three-phase line √3·I·Z,
// so a three-phase mV/A/m figure scales to single phase by 2/√3.
const THREE_TO_SINGLE_PHASE = 2 / Math.sqrt(3);

const mvAmFor = (construction: CableConstruction, csa: number, phasing: Phasing): number => {
  if (isXlpe(construction)) {
    // Only a three-phase XLPE table is held, so convert it for single-phase
    // circuits instead of understating their drop.
    const threePhase = lookupVdropTable(csa, VDROP_MV_A_M_XLPE_3P);
    return phasing === 'three' ? threePhase : threePhase * THREE_TO_SINGLE_PHASE;
  }
  // Three-phase PVC uses the XLPE table, whose 90 °C conductor values sit
  // above PVC's 70 °C ones, so the result errs high until a PVC table is held.
  if (phasing === 'three') return lookupVdropTable(csa, VDROP_MV_A_M_XLPE_3P);
  return lookupVdropTable(csa, VDROP_MV_A_M_PVC_SP);
};

// Lighting circuits take the tighter limit. A cable records no load type of
// its own, so it comes from the kind of system the cable is assigned to.
export const loadCategoryForCable = (
  cable: Cable,
  systems?: Record<SystemId, ElectricalSystem>,
): LoadCategory => {
  const kind = cable.systemId ? systems?.[cable.systemId]?.kind : undefined;
  return kind === 'lighting' || kind === 'emergency-lighting' ? 'lighting' : 'other';
};

export const computeVoltageDrop = (opts: VoltageDropOptions): VoltageDropResult => {
  const code = opts.standardsCode ?? 'BS7671';
  const limits = VDROP_LIMITS[code];
  const limitFraction = (opts.loadCategory ?? 'other') === 'lighting'
    ? limits.lighting
    : limits.other;
  const mvAm = opts.mvAmOverride ?? mvAmFor(opts.construction, opts.csa, opts.phasing);
  // Single-phase tabulated mV/A/m already accounts for go-and-return.
  // Three-phase tables use the sqrt(3) line-to-line convention.
  const vdropV = (mvAm * opts.designCurrentA * opts.lengthM) / 1000;
  const vdropPct = opts.systemVoltageV > 0 ? (vdropV / opts.systemVoltageV) * 100 : 0;
  const sourceTables = ['voltage-drop-limits'] as const;
  const standards = opts.mvAmOverride === undefined
    ? createStandardsTrace(code, [
        ...sourceTables,
        isXlpe(opts.construction) || opts.phasing === 'three'
          ? 'voltage-drop-xlpe-three-phase-bs7671'
          : 'voltage-drop-pvc-single-phase-bs7671',
      ])
    : createStandardsTrace(code, sourceTables);
  return {
    vdropV,
    vdropPct,
    withinLimits: vdropPct / 100 <= limitFraction,
    mvAm,
    limitPct: limitFraction * 100,
    standards,
  };
};
