import { describe, expect, it } from 'vitest';
import { detectFittings } from '../fittings';
import type { ContainmentEntity } from '../../types';

const tray = (
  id: string,
  points: ContainmentEntity['points'],
  width = 100,
  height = 50,
): ContainmentEntity => ({
  id,
  kind: 'containment',
  layerId: 'containment-layer',
  visible: true,
  locked: false,
  containmentType: 'tray',
  points,
  width,
  height,
});

describe('detectFittings', () => {
  it('treats a branch endpoint touching a spine vertex as a tee, not an end cap', () => {
    const spine = tray('spine', [
      { x: 100, y: 500 },
      { x: 500, y: 500 },
      { x: 900, y: 500 },
    ], 200, 80);
    const branch = tray('branch', [
      { x: 500, y: 500 },
      { x: 500, y: 900 },
    ]);

    const fittings = detectFittings(branch, [spine]);
    const join = fittings.find((f) => f.position.x === 500 && f.position.y === 500);

    expect(join?.fittingKind).toBe('tee');
  });

  it('treats a branch endpoint touching the middle of a spine segment as a tee', () => {
    const spine = tray('spine', [
      { x: 100, y: 500 },
      { x: 900, y: 500 },
    ], 200, 80);
    const branch = tray('branch', [
      { x: 500, y: 500 },
      { x: 500, y: 900 },
    ]);

    const fittings = detectFittings(branch, [spine]);
    const join = fittings.find((f) => f.position.x === 500 && f.position.y === 500);

    expect(join?.fittingKind).toBe('tee');
  });
});
