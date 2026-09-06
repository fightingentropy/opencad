import * as THREE from 'three';
import type { Vec2 } from '../types';

export interface ComponentWorkplane {
  floorElevation: number;
  componentElevation: number;
  originX: number;
  originY: number;
  flipY?: number;
}

/** Scene coordinates include building origin and FFL; saved entities do not. */
export function intersectComponentWorkplane(ray: THREE.Ray, plane: ComponentWorkplane): Vec2 | null {
  const hit = ray.intersectPlane(new THREE.Plane(
    new THREE.Vector3(0, 0, 1), -(plane.floorElevation + plane.componentElevation),
  ), new THREE.Vector3());
  if (!hit) return null;
  const localY = hit.y - plane.originY;
  return {
    x: hit.x - plane.originX,
    y: plane.flipY == null ? localY : plane.flipY - localY,
  };
}

export function componentPreviewOffset(position: Vec2, plane: ComponentWorkplane): THREE.Vector3 {
  return new THREE.Vector3(
    plane.originX + position.x,
    plane.originY + (plane.flipY == null ? position.y : plane.flipY - position.y),
    plane.floorElevation,
  );
}

export interface PlacementPointer {
  x: number;
  y: number;
  pointerId: number;
  dragged: boolean;
}

export function trackPlacementPointer(pointer: PlacementPointer, x: number, y: number): void {
  if (Math.hypot(x - pointer.x, y - pointer.y) > 5) pointer.dragged = true;
}

export function isPlacementClick(pointer: PlacementPointer, x: number, y: number, pointerId: number): boolean {
  trackPlacementPointer(pointer, x, y);
  return pointer.pointerId === pointerId && !pointer.dragged;
}
