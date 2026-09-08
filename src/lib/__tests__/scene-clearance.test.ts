import { describe, expect, it } from 'vitest';
import type { WallEntity } from '../../types';
import { analyzeSceneClearance, boxSeparation, entityClearanceBoxes } from '../scene-clearance';
import { boardFixture, routeFixture, routeProject } from './route-fixtures';

describe('3D coordination envelopes', () => {
  it('measures side clearance and vertical clearance from the actual section faces', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 0, y: 400, z: 2400 }, { x: 3000, y: 400, z: 2400 }]);
    let project = routeProject(a, b);
    expect(analyzeSceneClearance(project, a)).toMatchObject([{ targetId: 'b', kind: 'clearance', gap: 100 }]);
    b.points = [{ x: 0, y: 0, z: 2550 }, { x: 3000, y: 0, z: 2550 }];
    project = routeProject(a, b);
    expect(analyzeSceneClearance(project, a)).toMatchObject([{ targetId: 'b', kind: 'clearance', gap: 100 }]);
  });

  it('does not report a plan crossing when the routes have sufficient vertical separation', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 1500, y: -1000, z: 2800 }, { x: 1500, y: 1000, z: 2800 }]);
    expect(analyzeSceneClearance(routeProject(a, b), a)).toEqual([]);
  });

  it('flags a vertical drop through another run and a non-adjacent self crossing', () => {
    const a = routeFixture('a'), b = routeFixture('drop', [{ x: 1500, y: 0, z: 3000 }, { x: 1500, y: 0, z: 1800 }]);
    expect(analyzeSceneClearance(routeProject(a, b), b)).toContainEqual(expect.objectContaining({ kind: 'overlap', targetId: 'a' }));
    const self = routeFixture('self', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 },
      { x: 3000, y: 2000, z: 2400 }, { x: 1500, y: 2000, z: 2400 }, { x: 1500, y: -1000, z: 2400 }]);
    expect(analyzeSceneClearance(routeProject(self), self)).toContainEqual(expect.objectContaining({ kind: 'overlap', targetId: 'self' }));
  });

  it('does not classify an intentional elbow or tee connection as a clash', () => {
    const a = routeFixture('a'), b = routeFixture('branch', [{ x: 1500, y: 0, z: 2400 }, { x: 1500, y: 2000, z: 2400 }]);
    expect(analyzeSceneClearance(routeProject(a, b), b)).toEqual([]);
    const elbow = routeFixture('elbow', [{ x: 3000, y: 0, z: 2400 }, { x: 3000, y: 2000, z: 2400 }]);
    expect(analyzeSceneClearance(routeProject(a, elbow), a)).toEqual([]);
    const duplicate = routeFixture('duplicate', [{ x: 1500, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }]);
    expect(analyzeSceneClearance(routeProject(a, duplicate), a)).toContainEqual(expect.objectContaining({ kind: 'overlap' }));
  });

  it('uses measured wall and beam elevations, without treating space below a beam as solid', () => {
    const route = routeFixture();
    const beam: WallEntity = { id: 'beam', kind: 'wall', layerId: route.layerId, locked: false, visible: true,
      points: [{ x: 1500, y: -1000 }, { x: 1500, y: 1000 }], thickness: 300, height: 400, elevation: 2400, structuralRole: 'beam' };
    const project = routeProject(route, beam);
    expect(analyzeSceneClearance(project, route)).toContainEqual(expect.objectContaining({ targetId: 'beam', targetLabel: 'Beam', kind: 'overlap' }));
    beam.elevation = 2800;
    expect(analyzeSceneClearance(project, route)).toEqual([]);
    beam.elevation = 0; beam.height = 3000; beam.structuralRole = 'wall';
    expect(analyzeSceneClearance(project, route)[0]).toMatchObject({ kind: 'overlap', targetLabel: 'Wall' });
  });

  it('checks equipment door space in its rotated local direction', () => {
    const board = boardFixture(); board.rotation = Math.PI / 2;
    const route = routeFixture('access', [{ x: 3500, y: -400, z: 800 }, { x: 3500, y: 400, z: 800 }]);
    const project = routeProject(board, route);
    expect(analyzeSceneClearance(project, route)).toContainEqual(expect.objectContaining({ kind: 'access', targetId: 'board' }));
    board.accessDepth = 0;
    expect(analyzeSceneClearance(project, route)).toEqual([]);
  });

  it('allows a terminal drop into its board port', () => {
    const board = boardFixture(), route = routeFixture('drop', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    expect(analyzeSceneClearance(routeProject(board, route), route)).toEqual([]);
  });

  it('finds diagonal distances between rotated boxes and is symmetric', () => {
    const a = boardFixture(), b = { ...boardFixture(), id: 'b', a: { x: 4300, y: 900 }, b: { x: 4900, y: 1300 }, rotation: Math.PI / 4 };
    const project = routeProject(a, b);
    const aa = entityClearanceBoxes(a, project, false)[0], bb = entityClearanceBoxes(b, project, false)[0];
    const ab = boxSeparation(aa, bb)!;
    expect(ab.gap).toBeGreaterThan(800);
    expect(ab.gap).toBeCloseTo(boxSeparation(bb, aa)!.gap, 6);
    expect(boxSeparation(aa, bb, 100)).toBeNull();
  });

  it('uses a configurable guide and excludes hidden reference layers', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 0, y: 400, z: 2400 }, { x: 3000, y: 400, z: 2400 }]);
    const project = routeProject(a, b); project.coordination = { clearanceMm: 90 };
    expect(analyzeSceneClearance(project, a)).toEqual([]);
    project.coordination.clearanceMm = 150; b.visible = false;
    expect(analyzeSceneClearance(project, a)).toEqual([]);
  });
});
