// Voltage drop calculation. Vd = (mV/A/m) * Ib * L / 1000 for single-phase
// loop; three-phase line-to-line uses sqrt(3) coefficient instead of 2.

import {
  VDROP_LIMITS,
  VDROP_MV_A_M_PVC_SP,
  VDROP_MV_A_M_XLPE_3P,
  type StandardsCode,
} from '../models/standards';
import type { CableConstruction } from '../models/cable';

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

const mvAmFor = (construction: CableConstruction, csa: number, phasing: Phasing): number => {
  if (isXlpe(construction) || phasing === 'three') {
    return lookupVdropTable(csa, VDROP_MV_A_M_XLPE_3P);
  }
  return lookupVdropTable(csa, VDROP_MV_A_M_PVC_SP);
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
  return {
    vdropV,
    vdropPct,
    withinLimits: vdropPct / 100 <= limitFraction,
    mvAm,
    limitPct: limitFraction * 100,
  };
};
