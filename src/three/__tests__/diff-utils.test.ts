import { describe, expect, it } from 'vitest';
import {
  COORD_EPSILON,
  diffPointsSig,
  nearlyEqual,
  pointsMatchSnapshot,
  runSnapshotsEqual,
  snapshotPoints,
  snapshotsMatch,
  type RunSnapshot,
} from '../diff-utils';

const NOISE = 1e-12; // far below epsilon — must be ignored
const ONE_MM = 1; // sheet units are mm — a real drag must trigger updates

describe('nearlyEqual', () => {
  it('treats float noise as equal', () => {
    expect(nearlyEqual(100, 100 + NOISE)).toBe(true);
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('does not swallow genuine changes', () => {
    expect(nearlyEqual(100, 100 + ONE_MM)).toBe(false);
    expect(nearlyEqual(100, 100 + 1e-6)).toBe(false);
  });

  it('uses the epsilon as an inclusive bound', () => {
    expect(nearlyEqual(0, COORD_EPSILON)).toBe(true);
    expect(nearlyEqual(0, COORD_EPSILON * 2)).toBe(false);
  });
});

describe('snapshotPoints / pointsMatchSnapshot', () => {
  const pts = [
    { x: 10, y: 20 },
    { x: 30.5, y: -4.25 },
  ];

  it('round-trips a point list', () => {
    const snap = snapshotPoints(pts);
    expect(Array.from(snap)).toEqual([10, 20, 30.5, -4.25]);
    expect(pointsMatchSnapshot(snap, pts)).toBe(true);
  });

  it('handles undefined / empty input', () => {
    expect(snapshotPoints(undefined).length).toBe(0);
    expect(pointsMatchSnapshot(new Float64Array(0), undefined)).toBe(true);
    expect(pointsMatchSnapshot(new Float64Array(0), [])).toBe(true);
    expect(pointsMatchSnapshot(snapshotPoints(pts), undefined)).toBe(false);
  });

  it('ignores float noise but catches a 1 mm drag', () => {
    const snap = snapshotPoints(pts);
    const noisy = [
      { x: 10 + NOISE, y: 20 - NOISE },
      { x: 30.5, y: -4.25 },
    ];
    expect(pointsMatchSnapshot(snap, noisy)).toBe(true);

    const dragged = [
      { x: 10 + ONE_MM, y: 20 },
      { x: 30.5, y: -4.25 },
    ];
    expect(pointsMatchSnapshot(snap, dragged)).toBe(false);
  });

  it('fails on point-count changes', () => {
    const snap = snapshotPoints(pts);
    expect(pointsMatchSnapshot(snap, [...pts, { x: 0, y: 0 }])).toBe(false);
    expect(pointsMatchSnapshot(snap, pts.slice(0, 1))).toBe(false);
  });
});

describe('snapshotsMatch', () => {
  it('compares two snapshots with epsilon', () => {
    const a = snapshotPoints([{ x: 1, y: 2 }]);
    const b = snapshotPoints([{ x: 1 + NOISE, y: 2 }]);
    const c = snapshotPoints([{ x: 1 + ONE_MM, y: 2 }]);
    expect(snapshotsMatch(a, b)).toBe(true);
    expect(snapshotsMatch(a, c)).toBe(false);
    expect(snapshotsMatch(a, new Float64Array(0))).toBe(false);
  });
});

describe('diffPointsSig', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ];
  const snap = snapshotPoints(pts);

  it("returns 'same' when nothing changed (within noise)", () => {
    expect(diffPointsSig(true, snap, pts)).toBe('same');
    const noisy = pts.map((p) => ({ x: p.x + NOISE, y: p.y - NOISE }));
    expect(diffPointsSig(true, snap, noisy)).toBe('same');
  });

  it("returns 'points-only' for a genuine position-only move", () => {
    const dragged = [pts[0], { x: 100 + ONE_MM, y: 0 }, pts[2]];
    expect(diffPointsSig(true, snap, dragged)).toBe('points-only');
  });

  it("returns 'rebuild' when scalar fields changed", () => {
    expect(diffPointsSig(false, snap, pts)).toBe('rebuild');
    // even if points also moved, fields win
    const dragged = [pts[0], { x: 200, y: 0 }, pts[2]];
    expect(diffPointsSig(false, snap, dragged)).toBe('rebuild');
  });

  it("returns 'rebuild' when the point count changed (topology)", () => {
    expect(diffPointsSig(true, snap, pts.slice(0, 2))).toBe('rebuild');
    expect(diffPointsSig(true, snap, [...pts, { x: 0, y: 50 }])).toBe(
      'rebuild'
    );
    expect(diffPointsSig(true, snap, undefined)).toBe('rebuild');
  });
});

describe('runSnapshotsEqual', () => {
  const run = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
    containmentType: 'tray',
    width: 300,
    height: 50,
    baseZ: 2100,
    points: snapshotPoints([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]),
    ...over,
  });

  it('matches identical run lists and ignores float noise', () => {
    expect(runSnapshotsEqual([run()], [run()])).toBe(true);
    const noisy = run({
      points: snapshotPoints([
        { x: NOISE, y: 0 },
        { x: 1000, y: -NOISE },
      ]),
    });
    expect(runSnapshotsEqual([run()], [noisy])).toBe(true);
    expect(runSnapshotsEqual([], [])).toBe(true);
  });

  it('detects scalar, point, and count changes', () => {
    expect(runSnapshotsEqual([run()], [run({ width: 301 })])).toBe(false);
    expect(runSnapshotsEqual([run()], [run({ baseZ: 2400 })])).toBe(false);
    expect(
      runSnapshotsEqual([run()], [run({ containmentType: 'basket' })])
    ).toBe(false);
    const moved = run({
      points: snapshotPoints([
        { x: 0, y: 0 },
        { x: 1000, y: ONE_MM },
      ]),
    });
    expect(runSnapshotsEqual([run()], [moved])).toBe(false);
    expect(runSnapshotsEqual([run()], [run(), run()])).toBe(false);
  });
});
