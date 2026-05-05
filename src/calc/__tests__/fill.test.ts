import { describe, it, expect, beforeEach } from 'vitest';
import { containmentInnerArea, computeContainmentFill } from '../fill';
import { resetIds, makeContainment, makeCable, bs7671, nec } from './helpers';

describe('containmentInnerArea', () => {
  beforeEach(resetIds);

  it('uses innerCsaMm2 override when present', () => {
    const c = makeContainment({ innerCsaMm2: 1234 });
    expect(containmentInnerArea(c)).toBe(1234);
  });

  it('computes rectangular trunking inner area minus 1.5mm wall on each side', () => {
    // 100×50 trunking with 1.5mm walls -> inner is 97 × 47 = 4559 mm²
    const c = makeContainment({
      containmentType: 'trunking',
      width: 100,
      height: 50,
      innerCsaMm2: undefined,
    });
    expect(containmentInnerArea(c)).toBeCloseTo(97 * 47, 2);
  });

  it('computes circular conduit inner area from outside diameter', () => {
    // 25mm conduit -> π/4 * 25² = 490.87 mm²
    const c = makeContainment({
      containmentType: 'conduit',
      width: 25,
      height: 25,
      innerCsaMm2: undefined,
    });
    expect(containmentInnerArea(c)).toBeCloseTo((Math.PI / 4) * 25 * 25, 2);
  });

  it('treats tray as rectangle with wall deduction (legacy behaviour)', () => {
    // Tray 200x50 -> (200-3)*(50-3) = 197 * 47 = 9259
    const c = makeContainment({
      containmentType: 'tray',
      width: 200,
      height: 50,
      innerCsaMm2: undefined,
    });
    expect(containmentInnerArea(c)).toBeCloseTo(197 * 47, 2);
  });
});

describe('computeContainmentFill', () => {
  beforeEach(resetIds);

  it('returns 0% fill when there are no cables', () => {
    const c = makeContainment({ containmentType: 'trunking' });
    const r = computeContainmentFill(c, [], bs7671);
    expect(r.fillPct).toBe(0);
    expect(r.fillStatus).toBe('ok');
    expect(r.cableCount).toBe(0);
  });

  it('uses BS 7671 space factor table for trunking when standards = BS7671', () => {
    // 100×50 trunking, 1× 2.5mm² 2-core -> space factor 11.4 * 2 = 22.8 mm²
    // Inner area 97 × 47 = 4559 mm² -> ~0.5% fill
    const c = makeContainment({
      containmentType: 'trunking',
      width: 100,
      height: 50,
    });
    const cable = makeCable({ csa: 2.5, cores: 2, outerDiameter: 12 });
    const r = computeContainmentFill(c, [cable], bs7671);
    expect(r.fillPct).toBeGreaterThan(0);
    expect(r.fillPct).toBeLessThan(1.0);
    expect(r.occupiedAreaMm2).toBeCloseTo(11.4 * 2, 2);
    expect(r.fillStatus).toBe('ok');
  });

  it('uses circular OD area for trunking under non-BS7671 standards', () => {
    // 100×50 trunking with NEC -> uses π/4*OD² (per cable)
    const c = makeContainment({
      containmentType: 'trunking',
      width: 100,
      height: 50,
    });
    const cable = makeCable({ csa: 2.5, cores: 2, outerDiameter: 12 });
    const r = computeContainmentFill(c, [cable], nec);
    expect(r.occupiedAreaMm2).toBeCloseTo((Math.PI / 4) * 144, 2);
  });

  it('flags fill > 45% as over for trunking under BS 7671', () => {
    // 25×25 trunking inner ~22*22 = 484 mm². Stuff in cables that
    // exceed 45% via BS 7671 space factors.
    const c = makeContainment({
      containmentType: 'trunking',
      width: 25,
      height: 25,
    });
    // Use 5× 16mm² 2-core: 50.3 × 2 × 5 = 503 mm² which is > 484 mm² inner.
    const cables = Array.from({ length: 5 }, () =>
      makeCable({ csa: 16, cores: 2, outerDiameter: 18 }),
    );
    const r = computeContainmentFill(c, cables, bs7671);
    expect(r.fillPct).toBeGreaterThan(45);
    expect(r.fillStatus).toBe('over');
  });

  it('reports between 35-45% as warning for trunking under BS 7671', () => {
    // Inner 97×47 = 4559. 35% = ~1596 mm²
    const c = makeContainment({
      containmentType: 'trunking',
      width: 100,
      height: 50,
    });
    // Pack ~38% via 16 cables of 1.5mm² 2-core (8.1 mm² each per core)
    // 16 cables × 2 cores × 8.1 = 259.2 — too few. Use 25mm² 2-core: 75.4*2=150.8 ea
    // 12 cables × 150.8 = 1810 mm² => 39.7%
    const cables = Array.from({ length: 12 }, () =>
      makeCable({ csa: 25, cores: 2, outerDiameter: 22 }),
    );
    const r = computeContainmentFill(c, cables, bs7671);
    expect(r.fillPct).toBeGreaterThanOrEqual(35);
    expect(r.fillPct).toBeLessThanOrEqual(45);
    expect(r.fillStatus).toBe('warning');
  });

  it('NEC conduit with 1 conductor uses 53% limit', () => {
    const c = makeContainment({ containmentType: 'conduit', width: 25 });
    const cable = makeCable({ csa: 2.5, outerDiameter: 5 });
    const r = computeContainmentFill(c, [cable], nec);
    expect(r.limit).toBeCloseTo(0.53, 2);
  });

  it('NEC conduit with 2 conductors uses 31% limit', () => {
    const c = makeContainment({ containmentType: 'conduit', width: 25 });
    const cables = [
      makeCable({ csa: 2.5, outerDiameter: 5 }),
      makeCable({ csa: 2.5, outerDiameter: 5 }),
    ];
    const r = computeContainmentFill(c, cables, nec);
    expect(r.limit).toBeCloseTo(0.31, 2);
  });

  it('NEC conduit with 3+ conductors uses 40% limit', () => {
    const c = makeContainment({ containmentType: 'conduit', width: 25 });
    const cables = Array.from({ length: 4 }, () =>
      makeCable({ csa: 2.5, outerDiameter: 5 }),
    );
    const r = computeContainmentFill(c, cables, nec);
    expect(r.limit).toBeCloseTo(0.4, 2);
  });

  it('returns ok for tray fill under 90% capacity', () => {
    const c = makeContainment({
      containmentType: 'tray',
      width: 300,
      height: 75,
    });
    const cables = Array.from({ length: 3 }, () =>
      makeCable({ csa: 2.5, outerDiameter: 12 }),
    );
    const r = computeContainmentFill(c, cables, bs7671);
    expect(r.fillStatus).toBe('ok');
  });
});
