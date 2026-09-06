import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  componentPreviewOffset, intersectComponentWorkplane, isPlacementClick,
  trackPlacementPointer, type ComponentWorkplane,
} from '../ComponentPlacement';

describe('3D component workplane', () => {
  const plane: ComponentWorkplane = {
    floorElevation: 3400, componentElevation: 2100, originX: 20000, originY: -8000,
  };

  it('removes building origin and intersects at FFL plus component elevation', () => {
    const ray = new THREE.Ray(new THREE.Vector3(22500, -7100, 9500), new THREE.Vector3(0.1, 0.2, -1).normalize());
    const point = intersectComponentWorkplane(ray, plane);
    expect(point).toEqual({ x: 2900, y: 1700 });
    expect(componentPreviewOffset(point!, plane)).toEqual(new THREE.Vector3(22900, -6300, 3400));
    // The preview renderer supplies its own 2100 mm elevation above this FFL.
    expect(componentPreviewOffset(point!, plane).z + plane.componentElevation).toBe(5500);
  });

  it('round-trips flipped CAD Y coordinates without flipping the building origin', () => {
    const flipped = { ...plane, flipY: 12000 };
    const ray = new THREE.Ray(new THREE.Vector3(22500, -7100, 9500), new THREE.Vector3(0, 0, -1));
    const point = intersectComponentWorkplane(ray, flipped);
    expect(point).toEqual({ x: 2500, y: 11100 });
    expect(componentPreviewOffset(point!, flipped)).toEqual(new THREE.Vector3(22500, -7100, 3400));
  });

  it('has no placement target for a parallel ray or a plane behind the camera', () => {
    expect(intersectComponentWorkplane(new THREE.Ray(new THREE.Vector3(0, 0, 6000), new THREE.Vector3(1, 0, 0)), plane)).toBeNull();
    expect(intersectComponentWorkplane(new THREE.Ray(new THREE.Vector3(0, 0, 6000), new THREE.Vector3(0, 0, 1)), plane)).toBeNull();
  });

  it('does not turn a drag back to its starting point into a placement click', () => {
    const pointer = { x: 300, y: 400, pointerId: 1, dragged: false };
    trackPlacementPointer(pointer, 320, 400);
    expect(isPlacementClick(pointer, 300, 400, 1)).toBe(false);
    expect(isPlacementClick({ x: 300, y: 400, pointerId: 1, dragged: false }, 302, 402, 1)).toBe(true);
    expect(isPlacementClick({ x: 300, y: 400, pointerId: 1, dragged: false }, 300, 400, 2)).toBe(false);
  });
});
