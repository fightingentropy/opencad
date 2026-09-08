import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { routeFixture } from '../../lib/__tests__/route-fixtures';
import { renderContainment3D } from '../ContainmentRender3D';
import { offsetSpatialCurve, spatialContainmentCurve, spatialRouteFrames } from '../SpatialContainmentGeometry';
import { disposePreview } from '../ScenePlacement';

describe('spatial containment sections', () => {
  it.each(['tray', 'trunking', 'basket', 'ladder', 'conduit', 'duct', 'busbar'] as const)('renders a purely vertical %s with finite bounds and pickable geometry', type => {
    const route = { ...routeFixture('vertical', [{ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 3500 }]), containmentType: type };
    const object = renderContainment3D(route);
    const bounds = new THREE.Box3().setFromObject(object);
    expect(bounds.isEmpty()).toBe(false);
    expect(bounds.min.z).toBeGreaterThanOrEqual(990);
    expect(bounds.max.z).toBeLessThanOrEqual(3700);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(2450);
    object.traverse(part => { if (part instanceof THREE.Mesh) expect(part.userData.entityId).toBe('vertical'); });
    disposePreview(object);
  });

  it('transports the section orientation continuously through rises and offsets', () => {
    const route = routeFixture('offset', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 },
      { x: 3000, y: 0, z: 4000 }, { x: 3000, y: 3000, z: 4000 }]);
    const curve = spatialContainmentCurve(route, 2400)!;
    const frames = spatialRouteFrames(curve, 240);
    frames.forEach((frame, index) => {
      expect(frame.side.length()).toBeCloseTo(1, 6);
      expect(frame.side.dot(frame.tangent)).toBeCloseTo(0, 5);
      expect(frame.up.dot(frame.tangent)).toBeCloseTo(0, 5);
      if (Math.abs(frame.tangent.z) < 1e-5) expect(frame.up.z).toBeCloseTo(1, 5);
      if (index) expect(frame.side.dot(frames[index - 1].side)).toBeGreaterThan(.8);
    });
    const cable = offsetSpatialCurve(curve, 100, -10);
    for (let i = 0; i <= 100; i++) expect(cable.getPoint(i / 100).distanceTo(curve.getPointAt(i / 100))).toBeCloseTo(Math.hypot(100, 10), 1);
  });
});
