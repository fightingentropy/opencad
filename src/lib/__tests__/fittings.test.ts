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
  const atOrigin = (routes: ContainmentEntity[]) => routes.flatMap(route => detectFittings(route, routes.filter(other => other !== route)))
    .filter(fitting => Math.hypot(fitting.position.x, fitting.position.y) < 1);

  it('saves one coupler for two straight sections, independent of route order', () => {
    const routes = [tray('a', [{ x: -3000, y: 0 }, { x: 0, y: 0 }]), tray('b', [{ x: 0, y: 0 }, { x: 3000, y: 0 }])];
    for (const order of [routes, [...routes].reverse()]) expect(atOrigin(order)).toMatchObject([{ fittingKind: 'coupler', containmentId: 'a' }]);
  });

  it('creates a single bend where separate sections turn a corner', () => {
    const routes = [tray('a', [{ x: -3000, y: 0 }, { x: 0, y: 0 }]), tray('b', [{ x: 0, y: 0 }, { x: 0, y: 3000 }])];
    expect(atOrigin(routes)).toMatchObject([{ fittingKind: 'flat-bend', angleDeg: 90 }]);
  });

  it('counts actual branch directions for tees and crosses, including a continuous spine', () => {
    const spine = tray('a', [{ x: -3000, y: 0 }, { x: 3000, y: 0 }]);
    const north = tray('b', [{ x: 0, y: 0 }, { x: 0, y: 3000 }]);
    const south = tray('c', [{ x: 0, y: 0 }, { x: 0, y: -3000 }]);
    expect(atOrigin([spine, north])).toMatchObject([{ fittingKind: 'tee', containmentId: 'a' }]);
    expect(atOrigin([spine, north, south])).toMatchObject([{ fittingKind: 'cross', containmentId: 'a' }]);
  });

  it('assigns the joint to the editable section when its reference is locked', () => {
    const locked = { ...tray('a', [{ x: -3000, y: 0 }, { x: 0, y: 0 }]), locked: true };
    const added = tray('z', [{ x: 0, y: 0 }, { x: 3000, y: 0 }]);
    expect(detectFittings(added, [locked], { canOwnJunction: route => !route.locked }).filter(f => f.position.x === 0))
      .toMatchObject([{ fittingKind: 'coupler', containmentId: 'z' }]);
  });

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
