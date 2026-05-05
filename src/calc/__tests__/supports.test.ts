import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeSupportSpacing,
  polylineLength,
  placeSupportPositions,
  cableLoadKgPerMetre,
  verifySupportLoad,
} from '../supports';
import { resetIds, makeContainment, makeCable, makeSupport } from './helpers';

describe('computeSupportSpacing', () => {
  beforeEach(resetIds);

  it('200mm tray maps to 1800mm spacing', () => {
    const c = makeContainment({ containmentType: 'tray', width: 200 });
    expect(computeSupportSpacing(c)).toBe(1800);
  });

  it('25mm rigid steel conduit maps to 2000mm spacing', () => {
    const c = makeContainment({
      containmentType: 'conduit',
      width: 25,
      subType: 'rigid-steel',
    });
    expect(computeSupportSpacing(c)).toBe(2000);
  });

  it('25mm rigid PVC conduit maps to 900mm (smaller PVC spans)', () => {
    const c = makeContainment({
      containmentType: 'conduit',
      width: 25,
      subType: 'rigid-pvc',
    });
    expect(computeSupportSpacing(c)).toBe(900);
  });

  it('150mm ladder maps to 3000mm spacing', () => {
    const c = makeContainment({ containmentType: 'ladder', width: 150 });
    expect(computeSupportSpacing(c)).toBe(3000);
  });

  it('falls back to 1500mm for unknown containment type', () => {
    const c = makeContainment({ containmentType: 'duct', width: 110 });
    expect(computeSupportSpacing(c)).toBe(1500);
  });
});

describe('polylineLength', () => {
  it('returns 0 for empty or single-point polylines', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 0, y: 0 }])).toBe(0);
  });

  it('sums an L-shaped run: (0,0)->(1000,0)->(1000,1000) = 2000mm', () => {
    const len = polylineLength([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ]);
    expect(len).toBeCloseTo(2000, 4);
  });

  it('handles diagonals via Pythagoras', () => {
    const len = polylineLength([
      { x: 0, y: 0 },
      { x: 3000, y: 4000 },
    ]);
    expect(len).toBeCloseTo(5000, 4);
  });
});

describe('placeSupportPositions', () => {
  beforeEach(resetIds);

  it('places supports at start, span intervals, and end on a 6m straight run', () => {
    // 6000mm straight run, with computed maxSpan 1500mm (basket width 60)
    const c = makeContainment({
      containmentType: 'basket',
      width: 60,
      points: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
      ],
    });
    const placements = placeSupportPositions(c);
    // Expect 5 placements: 0, 1500, 3000, 4500, 6000
    const distances = placements
      .filter((p) => p.reason !== 'bend')
      .map((p) => p.distanceAlong)
      .sort((a, b) => a - b);
    expect(distances).toEqual([0, 1500, 3000, 4500, 6000]);
  });

  it('adds supports near direction changes (within 300mm of a bend)', () => {
    // L-shaped 2000 + 2000 mm route, bend at (2000, 0)
    const c = makeContainment({
      containmentType: 'basket',
      width: 60,
      points: [
        { x: 0, y: 0 },
        { x: 2000, y: 0 },
        { x: 2000, y: 2000 },
      ],
    });
    const placements = placeSupportPositions(c);
    // Bend supports are flagged with reason='bend' near the corner
    const bend = placements.filter((p) => p.reason === 'bend');
    expect(bend.length).toBeGreaterThanOrEqual(2);
    for (const b of bend) {
      // Each bend support should be within 300mm of cumulative length 2000
      expect(Math.abs(b.distanceAlong - 2000)).toBeLessThanOrEqual(300);
    }
  });

  it('returns empty placements for invalid or missing points', () => {
    const c = makeContainment({
      containmentType: 'tray',
      width: 200,
      points: [],
    });
    expect(placeSupportPositions(c)).toEqual([]);
  });
});

describe('cableLoadKgPerMetre', () => {
  beforeEach(resetIds);

  it('sums explicit massPerMetre values across a bundle', () => {
    const cables = [
      makeCable({ massPerMetre: 0.4 }),
      makeCable({ massPerMetre: 0.6 }),
      makeCable({ massPerMetre: 1.2 }),
    ];
    expect(cableLoadKgPerMetre(cables)).toBeCloseTo(2.2, 3);
  });

  it('falls back to a CSA-based estimate when massPerMetre is absent', () => {
    const cable = makeCable({ csa: 2.5, cores: 2, massPerMetre: undefined });
    const m = cableLoadKgPerMetre([cable]);
    // 2.5 * 0.0089 * 2 * 1.6 = 0.07120 kg/m
    expect(m).toBeCloseTo(0.0712, 3);
  });
});

describe('verifySupportLoad', () => {
  beforeEach(resetIds);

  it('passes when bundled cable + containment self-weight is below SWL', () => {
    const c = makeContainment({ containmentType: 'tray', width: 200 });
    const support = makeSupport(c.id, 200);
    const cables = [makeCable({ massPerMetre: 0.5 })];
    const v = verifySupportLoad(c, support, cables);
    expect(v.ok).toBe(true);
    expect(v.capacityKg).toBe(200);
    expect(v.totalLoadKg).toBeGreaterThan(0);
  });

  it('flags overload when cable bundle exceeds support SWL', () => {
    const c = makeContainment({ containmentType: 'tray', width: 200 });
    const support = makeSupport(c.id, 5); // very small SWL
    const cables = Array.from({ length: 30 }, () =>
      makeCable({ massPerMetre: 1.5 }),
    );
    const v = verifySupportLoad(c, support, cables);
    expect(v.ok).toBe(false);
    expect(v.totalLoadKg).toBeGreaterThan(v.capacityKg);
  });
});
