import { describe, it, expect } from 'vitest';
import { computeVoltageDrop } from '../voltage-drop';

describe('computeVoltageDrop', () => {
  it('single-phase PVC 2.5mm² 16A 30m 230V matches the BS 7671 Table 4D2B value', () => {
    // mV/A/m for 2.5mm² PVC SP = 18 (per the standards table)
    // vdropV = 18 × 16 × 30 / 1000 = 8.64V
    // vdropPct = 8.64 / 230 = 3.757%
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 2.5,
      lengthM: 30,
      designCurrentA: 16,
      systemVoltageV: 230,
      phasing: 'single',
      loadCategory: 'other',
    });
    expect(r.mvAm).toBe(18);
    expect(r.vdropV).toBeCloseTo(8.64, 2);
    expect(r.vdropPct).toBeCloseTo(3.757, 2);
  });

  it('three-phase XLPE 16mm² 80A 50m 400V is well within limits', () => {
    // mV/A/m for 16mm² XLPE 3P = 2.4
    // vdropV = 2.4 × 80 × 50 / 1000 = 9.6V
    // vdropPct = 9.6 / 400 = 2.4%
    const r = computeVoltageDrop({
      construction: 'XLPE/SWA/PVC',
      csa: 16,
      lengthM: 50,
      designCurrentA: 80,
      systemVoltageV: 400,
      phasing: 'three',
      loadCategory: 'other',
    });
    expect(r.mvAm).toBe(2.4);
    expect(r.vdropV).toBeCloseTo(9.6, 2);
    expect(r.vdropPct).toBeCloseTo(2.4, 2);
    expect(r.withinLimits).toBe(true);
  });

  it('lighting circuit at 4% drop fails the 3% lighting limit', () => {
    // Construct conditions that yield ~4% drop on a lighting circuit:
    // 1.5mm² PVC (29 mV/A/m), 6A, 53m, 230V → 9.22V → 4.01%
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 1.5,
      lengthM: 53,
      designCurrentA: 6,
      systemVoltageV: 230,
      phasing: 'single',
      loadCategory: 'lighting',
    });
    expect(r.vdropPct).toBeGreaterThan(3);
    expect(r.withinLimits).toBe(false);
    expect(r.limitPct).toBeCloseTo(3, 2);
  });

  it('non-lighting circuit at 4% drop passes the 5% other limit', () => {
    // Same conditions as above but classified as other (5% limit).
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 1.5,
      lengthM: 53,
      designCurrentA: 6,
      systemVoltageV: 230,
      phasing: 'single',
      loadCategory: 'other',
    });
    expect(r.vdropPct).toBeGreaterThan(3);
    expect(r.vdropPct).toBeLessThan(5);
    expect(r.withinLimits).toBe(true);
    expect(r.limitPct).toBeCloseTo(5, 2);
  });

  it('honours mvAmOverride when provided', () => {
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 2.5,
      lengthM: 10,
      designCurrentA: 10,
      systemVoltageV: 230,
      phasing: 'single',
      mvAmOverride: 20,
    });
    // 20 × 10 × 10 / 1000 = 2V
    expect(r.mvAm).toBe(20);
    expect(r.vdropV).toBe(2);
  });

  it('returns 0 vdropPct when systemVoltageV is 0', () => {
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 2.5,
      lengthM: 10,
      designCurrentA: 10,
      systemVoltageV: 0,
      phasing: 'single',
    });
    expect(r.vdropPct).toBe(0);
  });

  it('uses the XLPE 3P table for three-phase circuits even with PVC construction', () => {
    // The current implementation routes any three-phase to the XLPE/3P table.
    const r = computeVoltageDrop({
      construction: 'PVC/PVC',
      csa: 16,
      lengthM: 10,
      designCurrentA: 100,
      systemVoltageV: 400,
      phasing: 'three',
    });
    expect(r.mvAm).toBe(2.4);
  });
});
