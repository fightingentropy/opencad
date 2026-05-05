import { describe, it, expect } from 'vitest';
import { suggestCableSize } from '../cable-sizing';

describe('suggestCableSize', () => {
  it('picks the smallest CSA whose ampacity meets a 16A design current at 30°C', () => {
    // PVC 1.5mm² has base ampacity 17.5A which meets 16A at factor 1.0.
    // 2.5mm² (24A) would also work but the smallest passing CSA wins.
    const r = suggestCableSize({
      designCurrentA: 16,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'enclosed',
      construction: 'PVC/PVC',
    });
    expect(r.ok).toBe(true);
    expect(r.csa).toBe(1.5);
    expect(r.baseAmpacity).toBeGreaterThanOrEqual(16);
  });

  it('picks 2.5mm² PVC for a 20A design current at 30°C (1.5mm² no longer covers it)', () => {
    const r = suggestCableSize({
      designCurrentA: 20,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'enclosed',
      construction: 'PVC/PVC',
    });
    expect(r.ok).toBe(true);
    expect(r.csa).toBe(2.5);
  });

  it('upsizes to a larger CSA after derating with multiple circuits and higher ambient', () => {
    // Design 100A, 4 circuits enclosed (Cg=0.65), 35°C PVC (Ca=0.94)
    // total factor = 0.65 × 0.94 = 0.611. Need base ampacity ≥ 100/0.611 = 163.6A.
    // Closest PVC base ampacity ≥ 163.6A: 50mm² (151) fails, 70mm² (192) passes.
    const r = suggestCableSize({
      designCurrentA: 100,
      ambientC: 35,
      numCircuits: 4,
      installationMethod: 'enclosed',
      construction: 'PVC/PVC',
    });
    expect(r.ok).toBe(true);
    expect(r.csa).toBeGreaterThanOrEqual(70);
  });

  it('returns ok: false for currents that exceed the largest standard CSA', () => {
    const r = suggestCableSize({
      designCurrentA: 5000,
      ambientC: 40,
      numCircuits: 8,
      installationMethod: 'enclosed',
      construction: 'PVC/PVC',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it('respects minimumCsa override', () => {
    const r = suggestCableSize({
      designCurrentA: 6,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'enclosed',
      construction: 'PVC/PVC',
      minimumCsa: 4.0,
    });
    expect(r.ok).toBe(true);
    expect(r.csa).toBeGreaterThanOrEqual(4);
  });

  it('XLPE produces higher ampacities than PVC for the same CSA', () => {
    // 32A on tray, single circuit, 30°C
    const pvc = suggestCableSize({
      designCurrentA: 32,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'tray',
      construction: 'PVC/PVC',
    });
    const xlpe = suggestCableSize({
      designCurrentA: 32,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'tray',
      construction: 'XLPE/SWA/PVC',
    });
    // For 32A: PVC needs 4mm² (32 base), XLPE only needs 2.5mm² (30 base)
    // So PVC csa >= XLPE csa here.
    expect(pvc.csa).toBeGreaterThanOrEqual(xlpe.csa);
  });
});
