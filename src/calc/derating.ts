// Grouping / ambient / installation derating per BS 7671 Appendix 4.

import {
  AMBIENT_FACTORS_PVC,
  AMBIENT_FACTORS_XLPE,
  GROUPING_FACTORS_ENCLOSED,
  GROUPING_FACTORS_TRAY,
} from '../models/standards';

export type InsulationType = 'PVC' | 'XLPE';
export type InstallationMethod = 'enclosed' | 'tray' | 'ladder' | 'clipped' | 'buried';

export interface DeratingOptions {
  numCircuits: number;
  ambientC: number;
  installationMethod: InstallationMethod;
  insulation: InsulationType;
  // Optional thermal insulation correction (Ci) — 1.0 if not surrounded.
  insulationFactor?: number;
  // Optional installation method factor (Cc) — 0.9 for buried Method D, 1.0 otherwise.
  installationFactor?: number;
}

export interface DeratingResult {
  Cg: number;
  Ca: number;
  Ci: number;
  Cc: number;
  totalFactor: number;
  deratedCurrent: number;
}

const lookupNearest = (
  table: Record<number, number>,
  key: number,
  mode: 'floor' | 'ceil' = 'ceil',
): number => {
  const keys = Object.keys(table)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  if (keys.length === 0) return 1;
  if (key <= keys[0]) return table[keys[0]];
  if (key >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (key === keys[i]) return table[keys[i]];
    if (key > keys[i] && key < keys[i + 1]) {
      return mode === 'floor' ? table[keys[i]] : table[keys[i + 1]];
    }
  }
  return table[keys[keys.length - 1]];
};

const groupingFactor = (numCircuits: number, method: InstallationMethod): number => {
  const n = Math.max(1, Math.floor(numCircuits));
  const table = method === 'tray' || method === 'ladder'
    ? GROUPING_FACTORS_TRAY
    : GROUPING_FACTORS_ENCLOSED;
  if (table[n] !== undefined) return table[n];
  return lookupNearest(table, n, 'ceil');
};

const ambientFactor = (ambientC: number, insulation: InsulationType): number => {
  const table = insulation === 'XLPE' ? AMBIENT_FACTORS_XLPE : AMBIENT_FACTORS_PVC;
  return lookupNearest(table, ambientC, 'ceil');
};

const installationFactor = (method: InstallationMethod): number => {
  return method === 'buried' ? 0.9 : 1.0;
};

export const computeDeratingFactors = (opts: DeratingOptions): DeratingResult => {
  const Cg = groupingFactor(opts.numCircuits, opts.installationMethod);
  const Ca = ambientFactor(opts.ambientC, opts.insulation);
  const Ci = opts.insulationFactor ?? 1.0;
  const Cc = opts.installationFactor ?? installationFactor(opts.installationMethod);
  const totalFactor = Cg * Ca * Ci * Cc;
  return { Cg, Ca, Ci, Cc, totalFactor, deratedCurrent: 0 };
};

export const deratedAmpacity = (
  baseAmpacity: number,
  factors: Pick<DeratingResult, 'totalFactor'> | DeratingResult,
): number => baseAmpacity * factors.totalFactor;

export const computeDeratedCurrent = (
  baseAmpacity: number,
  opts: DeratingOptions,
): DeratingResult => {
  const r = computeDeratingFactors(opts);
  return { ...r, deratedCurrent: deratedAmpacity(baseAmpacity, r) };
};
