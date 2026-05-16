import { describe, expect, it } from 'vitest';
import { placeSupportsForContainment } from '../support-placer';
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
