import {
  createStandardsTrace,
  type StandardsCode,
  type StandardsTrace,
} from '../models/standards';

export interface ProtectiveDeviceCoordinationOptions {
  designCurrentA: number;
  deviceRatingA: number;
  cableAmpacityA: number;
  conventionalOperatingCurrentA?: number;
  standardsCode?: StandardsCode;
}

export interface ProtectiveDeviceCoordinationResult {
  loadProtected: boolean;
  cableProtected: boolean;
  thermalProtected: boolean | null;
  ok: boolean;
  inequalities: {
    Ib: number;
    In: number;
    Iz: number;
    I2?: number;
    thermalLimit: number;
  };
  standards: StandardsTrace;
}

/**
 * Basic overload coordination from BS 7671 Regulation 433.1.1:
 * Ib <= In <= Iz and, when I2 is known, I2 <= 1.45 Iz.
 *
 * This does not model disconnection time, prospective fault current,
 * breaking capacity, selectivity, or a manufacturer's time/current curve.
 */
export const checkProtectiveDeviceCoordination = (
  opts: ProtectiveDeviceCoordinationOptions,
): ProtectiveDeviceCoordinationResult => {
  const loadProtected = opts.designCurrentA <= opts.deviceRatingA;
  const cableProtected = opts.deviceRatingA <= opts.cableAmpacityA;
  const thermalLimit = 1.45 * opts.cableAmpacityA;
  const thermalProtected = opts.conventionalOperatingCurrentA === undefined
    ? null
    : opts.conventionalOperatingCurrentA <= thermalLimit;
  return {
    loadProtected,
    cableProtected,
    thermalProtected,
    ok: loadProtected && cableProtected && thermalProtected !== false,
    inequalities: {
      Ib: opts.designCurrentA,
      In: opts.deviceRatingA,
      Iz: opts.cableAmpacityA,
      I2: opts.conventionalOperatingCurrentA,
      thermalLimit,
    },
    standards: createStandardsTrace(opts.standardsCode, ['overload-coordination-bs7671']),
  };
};
