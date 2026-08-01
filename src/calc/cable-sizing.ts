// Cable sizing: pick the smallest standard CSA whose derated ampacity
// meets the design current at the given installation method / ambient.

import {
  AMPACITY_REF_B_PVC_COPPER,
  AMPACITY_REF_B_XLPE_COPPER,
  createStandardsTrace,
  type StandardsCode,
  type StandardsTrace,
} from '../models/standards';
import { STANDARD_CSA, type CableConstruction } from '../models/cable';
import { computeDeratingFactors, type InstallationMethod } from './derating';

export interface CableSizingOptions {
  designCurrentA: number;
  ambientC: number;
  numCircuits: number;
  installationMethod: InstallationMethod;
  construction: CableConstruction;
  // Optional minimum size (mm²), e.g. 1.5 for lighting circuits
  minimumCsa?: number;
  standardsCode?: StandardsCode;
}

export interface CableSizingResult {
  csa: number;
  baseAmpacity: number;
  ampacity: number;
  ok: boolean;
  reason?: string;
  standards: StandardsTrace;
}

const isXlpe = (c: CableConstruction): boolean => c.includes('XLPE');

const ampacityFor = (csa: number, construction: CableConstruction): number => {
  const tbl = isXlpe(construction)
    ? AMPACITY_REF_B_XLPE_COPPER
    : AMPACITY_REF_B_PVC_COPPER;
  return tbl[csa] ?? 0;
};

export const suggestCableSize = (opts: CableSizingOptions): CableSizingResult => {
  const factors = computeDeratingFactors({
    numCircuits: opts.numCircuits,
    ambientC: opts.ambientC,
    installationMethod: opts.installationMethod,
    insulation: isXlpe(opts.construction) ? 'XLPE' : 'PVC',
    standardsCode: opts.standardsCode,
  });
  const standards = createStandardsTrace(opts.standardsCode, [
    isXlpe(opts.construction)
      ? 'ampacity-ref-b-xlpe-bs7671'
      : 'ampacity-ref-b-pvc-bs7671',
    opts.installationMethod === 'tray' || opts.installationMethod === 'ladder'
      ? 'grouping-tray-bs7671'
      : 'grouping-enclosed-bs7671',
    isXlpe(opts.construction) ? 'ambient-xlpe-bs7671' : 'ambient-pvc-bs7671',
  ]);
  const minCsa = opts.minimumCsa ?? STANDARD_CSA[0];
  for (const csa of STANDARD_CSA) {
    if (csa < minCsa) continue;
    const base = ampacityFor(csa, opts.construction);
    if (base <= 0) continue;
    const derated = base * factors.totalFactor;
    if (derated >= opts.designCurrentA) {
      return { csa, baseAmpacity: base, ampacity: derated, ok: true, standards };
    }
  }
  // Largest size still fails
  const largest = STANDARD_CSA[STANDARD_CSA.length - 1];
  const base = ampacityFor(largest, opts.construction);
  return {
    csa: largest,
    baseAmpacity: base,
    ampacity: base * factors.totalFactor,
    ok: false,
    reason: 'No standard size meets design current after derating — review installation conditions or split circuit.',
    standards,
  };
};
