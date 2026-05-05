import { describe, it, expect } from 'vitest';
import {
  computeDeratingFactors,
  computeDeratedCurrent,
  deratedAmpacity,
} from '../derating';

describe('grouping factor', () => {
  it('Cg = 1.0 for a single circuit enclosed', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.Cg).toBe(1.0);
  });

  it('Cg = 1.0 for a single circuit on tray', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'tray',
      insulation: 'XLPE',
    });
    expect(r.Cg).toBe(1.0);
  });

  it('Cg = 0.65 for 4 circuits enclosed (BS 7671 Table 4C1)', () => {
    const r = computeDeratingFactors({
      numCircuits: 4,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.Cg).toBeCloseTo(0.65, 2);
  });

  it('Cg = 0.75 for 4 circuits on tray (BS 7671 Table 4C3)', () => {
    const r = computeDeratingFactors({
      numCircuits: 4,
      ambientC: 30,
      installationMethod: 'tray',
      insulation: 'XLPE',
    });
    expect(r.Cg).toBeCloseTo(0.75, 2);
  });

  it('Cg falls between published values for non-tabulated counts', () => {
    // 11 circuits enclosed has no entry → next-up entry is 12 (0.45)
    const r = computeDeratingFactors({
      numCircuits: 11,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.Cg).toBeCloseTo(0.45, 2);
  });
});

describe('ambient correction Ca', () => {
  it('Ca = 1.0 at 30°C for both PVC and XLPE', () => {
    const pvc = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    const xlpe = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'XLPE',
    });
    expect(pvc.Ca).toBe(1.0);
    expect(xlpe.Ca).toBe(1.0);
  });

  it('Ca = 0.91 at 40°C for XLPE', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 40,
      installationMethod: 'enclosed',
      insulation: 'XLPE',
    });
    expect(r.Ca).toBeCloseTo(0.91, 2);
  });

  it('Ca = 0.87 at 40°C for PVC', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 40,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.Ca).toBeCloseTo(0.87, 2);
  });
});

describe('combined factors', () => {
  it('totalFactor = Cg × Ca × Ci × Cc', () => {
    const r = computeDeratingFactors({
      numCircuits: 4, // 0.65 enclosed
      ambientC: 40, // 0.87 PVC
      installationMethod: 'enclosed',
      insulation: 'PVC',
      insulationFactor: 0.5,
    });
    const expected = r.Cg * r.Ca * r.Ci * r.Cc;
    expect(r.totalFactor).toBeCloseTo(expected, 4);
    expect(r.totalFactor).toBeCloseTo(0.65 * 0.87 * 0.5 * 1.0, 3);
  });

  it('Cc = 0.9 for buried installations (Method D)', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'buried',
      insulation: 'XLPE',
    });
    expect(r.Cc).toBeCloseTo(0.9, 2);
  });

  it('Cc = 1.0 for non-buried installations by default', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.Cc).toBe(1.0);
  });

  it('explicit installationFactor override beats default', () => {
    const r = computeDeratingFactors({
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'buried',
      insulation: 'XLPE',
      installationFactor: 1.0,
    });
    expect(r.Cc).toBe(1.0);
  });
});

describe('deratedAmpacity / computeDeratedCurrent', () => {
  it('deratedAmpacity multiplies by totalFactor', () => {
    const r = computeDeratingFactors({
      numCircuits: 4,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(deratedAmpacity(100, r)).toBeCloseTo(65, 1);
  });

  it('computeDeratedCurrent populates deratedCurrent', () => {
    const r = computeDeratedCurrent(100, {
      numCircuits: 1,
      ambientC: 30,
      installationMethod: 'enclosed',
      insulation: 'PVC',
    });
    expect(r.deratedCurrent).toBeCloseTo(100, 1);
  });
});
