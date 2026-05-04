import type { Vec2 } from '../types';

export interface RouteOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  preferHorizontalFirst?: boolean;
}

/**
 * Compute an orthogonal (right-angle) path between two points.
 *
 * Strategy:
 * 1. If start and end are on the same horizontal or vertical line,
 *    return a direct 2-point path.
 * 2. Otherwise, create an L-shaped route (2 segments):
 *    - Go horizontal first, then vertical (if preferHorizontalFirst)
 *    - Or vertical first, then horizontal
 *    The default direction preference is based on which axis has
 *    the greater distance (go along the longer axis first).
 */
export function computeOrthogonalRoute(opts: RouteOptions): Vec2[] {
  const { startX, startY, endX, endY } = opts;
  const start: Vec2 = { x: startX, y: startY };
  const end: Vec2 = { x: endX, y: endY };

  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);

  // Tolerance for "same line" check (sub-pixel in mm space)
  const EPS = 0.01;

  // Case 1: points are essentially the same
  if (dx < EPS && dy < EPS) {
    return [start, end];
  }

  // Case 2: already on the same vertical line
  if (dx < EPS) {
    return [start, end];
  }

  // Case 3: already on the same horizontal line
  if (dy < EPS) {
    return [start, end];
  }

  // Case 4: L-shaped route. Decide whether to go horizontal-first or
  // vertical-first. If the caller specified a preference, use it;
  // otherwise default to going along the longer axis first.
  const horizontalFirst =
    opts.preferHorizontalFirst !== undefined
      ? opts.preferHorizontalFirst
      : dx >= dy;

  if (horizontalFirst) {
    // Horizontal then vertical: start -> (endX, startY) -> end
    const corner: Vec2 = { x: endX, y: startY };
    return [start, corner, end];
  } else {
    // Vertical then horizontal: start -> (startX, endY) -> end
    const corner: Vec2 = { x: startX, y: endY };
    return [start, corner, end];
  }
}
