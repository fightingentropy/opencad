import { describe, expect, it } from 'vitest';
import { placeSupportsForContainment } from '../support-placer';
import { computeSupportSpacing } from '../../calc/supports';
import type { ContainmentEntity } from '../../types';

const makeContainment = (patch: Partial<ContainmentEntity>): ContainmentEntity => ({
  id: 'containment-1',
  kind: 'containment',
  layerId: 'containment-layer',
  visible: true,
  locked: false,
  containmentType: 'trunking',
  points: [
    { x: 0, y: 0 },
    { x: 2000, y: 0 },
  ],
  width: 150,
  height: 100,
  ...patch,
});

describe('placeSupportsForContainment', () => {
  it('uses trapeze hangers for narrow non-conduit containment', () => {
    const supports = placeSupportsForContainment(makeContainment({ width: 150 }));

    expect(supports.length).toBeGreaterThan(0);
    expect(supports.every((support) => support.supportKind === 'trapeze-hanger')).toBe(true);
    expect(supports[0].channelLength).toBe(510);
  });

  it('keeps conduit on saddle clips', () => {
    const supports = placeSupportsForContainment(makeContainment({
      containmentType: 'conduit',
      width: 32,
      height: undefined,
    }));

    expect(supports.length).toBeGreaterThan(0);
    expect(supports.every((support) => support.supportKind === 'saddle-clip')).toBe(true);
  });
});

describe('placer span agrees with the support check', () => {
  // A run long enough that the spacing decides the support count.
  const longRun = [{ x: 0, y: 0 }, { x: 12000, y: 0 }];
  const spacingUsed = (c: ContainmentEntity): number => {
    const supports = placeSupportsForContainment(c);
    return 12000 / Math.max(1, supports.length - 1);
  };

  it('takes the next-larger width for a basket between table sizes', () => {
    const c = makeContainment({ containmentType: 'basket', width: 450, points: longRun });
    expect(computeSupportSpacing(c)).toBe(1000);
    expect(spacingUsed(c)).toBeLessThanOrEqual(1000);
  });

  it('treats plastic conduit by sub-type as plastic', () => {
    const c = makeContainment({ containmentType: 'conduit', subType: 'rigid-pvc', width: 25, points: longRun, height: undefined });
    expect(computeSupportSpacing(c)).toBe(900);
    expect(spacingUsed(c)).toBeLessThanOrEqual(900);
  });
});
