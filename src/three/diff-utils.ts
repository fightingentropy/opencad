// Cheap structural-comparison helpers for the Panel3D diff/update loop.
//
// The 3D viewer diffs entities against the last-built scene each render
// pass. These helpers replace JSON.stringify-based signatures with typed
// comparisons: exact equality for ids/colors/flags/counts, and an epsilon
// (1e-9) coordinate comparison that exists ONLY to swallow float noise —
// any genuine geometry change (e.g. a 1 mm drag) is far above the epsilon
// and still triggers an update.

export const COORD_EPSILON = 1e-9;

/** Minimal 2D point shape — structurally compatible with the app's Vec2. */
export interface XY {
  x: number;
  y: number;
}

/** True when two coordinates differ only by float noise. */
export function nearlyEqual(
  a: number,
  b: number,
  eps: number = COORD_EPSILON
): boolean {
  return Math.abs(a - b) <= eps;
}

/**
 * Flatten a point list into a compact Float64Array snapshot
 * ([x0, y0, x1, y1, ...]). Snapshots are stored in diff signatures so a
 * later in-place mutation of the source array can't alias the signature.
 */
export function snapshotPoints(points: readonly XY[] | undefined): Float64Array {
  if (!points || points.length === 0) return new Float64Array(0);
  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i].x;
    out[i * 2 + 1] = points[i].y;
  }
  return out;
}

/**
 * Compare a stored snapshot against a live point list. Point count must
 * match exactly; coordinates may differ by at most `eps`.
 */
export function pointsMatchSnapshot(
  snap: Float64Array,
  points: readonly XY[] | undefined,
  eps: number = COORD_EPSILON
): boolean {
  const n = points ? points.length : 0;
  if (snap.length !== n * 2) return false;
  if (!points) return true;
  for (let i = 0; i < n; i++) {
    if (Math.abs(snap[i * 2] - points[i].x) > eps) return false;
    if (Math.abs(snap[i * 2 + 1] - points[i].y) > eps) return false;
  }
  return true;
}

/** Compare two coordinate snapshots (length exact, values within eps). */
export function snapshotsMatch(
  a: Float64Array,
  b: Float64Array,
  eps: number = COORD_EPSILON
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

/**
 * Snapshot of one containment run as consumed by the wall-cutout logic.
 * Walls must rebuild when any run they might intersect changes shape.
 */
export interface RunSnapshot {
  containmentType: string;
  width: number;
  height: number;
  baseZ: number;
  points: Float64Array;
}

/** Compare two run-snapshot lists (order-sensitive, like the old string sig). */
export function runSnapshotsEqual(
  a: readonly RunSnapshot[],
  b: readonly RunSnapshot[],
  eps: number = COORD_EPSILON
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (
      ra.containmentType !== rb.containmentType ||
      ra.width !== rb.width ||
      ra.height !== rb.height ||
      ra.baseZ !== rb.baseZ ||
      !snapshotsMatch(ra.points, rb.points, eps)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Three-way outcome of comparing a stored signature against the current
 * entity state:
 *  - 'same'        — nothing changed (within float noise); skip entirely.
 *  - 'points-only' — only point positions moved; geometry can be updated
 *                    in place (same topology / point count / style).
 *  - 'rebuild'     — topology, style, or count changed; dispose + rebuild.
 */
export type SigDiff = 'same' | 'points-only' | 'rebuild';

/**
 * Classify a points + scalar-fields signature. `fieldsEqual` covers all
 * non-coordinate fields (type/color/dims/counts) with exact equality.
 */
export function diffPointsSig(
  fieldsEqual: boolean,
  snap: Float64Array,
  points: readonly XY[] | undefined,
  eps: number = COORD_EPSILON
): SigDiff {
  if (!fieldsEqual) return 'rebuild';
  const n = points ? points.length : 0;
  if (snap.length !== n * 2) return 'rebuild';
  return pointsMatchSnapshot(snap, points, eps) ? 'same' : 'points-only';
}
