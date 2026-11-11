// Ending OrbitControls damping for render on demand (audit finding opencad-10).
//
// With enableDamping, OrbitControls.update() applies a fraction of the
// remaining rotation and pan each frame and keeps the rest. In three 0.160.1
// update() keeps returning true while the target moves at all
// (distanceToSquared > 0), and the pan remainder decays geometrically, so it
// can report motion for many seconds, or far longer for a target near the
// origin, long after anything visible happens. A frame loop that waits for
// update() to return false would therefore keep rendering.
//
// settleOrbitStep runs one damped update and measures how far the view moved
// in screen pixels. While the step is visible it asks for another frame. Once
// a step falls below the threshold it turns damping off for one update(),
// which applies the whole remainder at once. That lands exactly where the
// glide would have ended (the damped steps sum to the remainder), clears the
// controls' internal deltas, and so the next update() reports no motion. The
// view is never left short of its resting pose.

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Per-frame motion below this many pixels ends the glide. The snap that
 * follows is about 1 / dampingFactor times this, so a quarter pixel here. */
export const SETTLE_THRESHOLD_PX = 0.02;

const before = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), target: new THREE.Vector3() };

/** Approximate on-screen motion, in pixels, between two camera poses. */
export function cameraMotionPx(
  from: { position: THREE.Vector3; quaternion: THREE.Quaternion; target: THREE.Vector3 },
  to: { position: THREE.Vector3; quaternion: THREE.Quaternion; target: THREE.Vector3 },
  fovDeg: number,
  heightPx: number,
): number {
  const distance = Math.max(1e-9, to.position.distanceTo(to.target));
  const dot = Math.min(1, Math.abs(from.quaternion.dot(to.quaternion)));
  const rotation = 2 * Math.acos(dot);
  // Angles in radians as seen from the camera; a sum is an upper bound.
  const angle = rotation
    + from.position.distanceTo(to.position) / distance
    + from.target.distanceTo(to.target) / distance;
  const fovRad = THREE.MathUtils.degToRad(fovDeg) || 1;
  return angle / fovRad * Math.max(1, heightPx);
}

/**
 * One damped OrbitControls step for a RenderTarget.beforeRender. Returns true
 * while the glide is still visibly moving.
 */
export function settleOrbitStep(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  heightPx: number,
  thresholdPx = SETTLE_THRESHOLD_PX,
): boolean {
  before.position.copy(camera.position);
  before.quaternion.copy(camera.quaternion);
  before.target.copy(controls.target);
  controls.update();
  const moved = cameraMotionPx(before, { position: camera.position, quaternion: camera.quaternion, target: controls.target }, camera.fov, heightPx);
  if (moved >= thresholdPx) return true;
  if (controls.enableDamping) {
    controls.enableDamping = false;
    try {
      controls.update();
    } finally {
      controls.enableDamping = true;
    }
  }
  return false;
}
