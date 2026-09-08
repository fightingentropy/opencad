import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, Project } from '../../types';
import { discoverRouteConnections, keepRouteConnections, routeEndStates } from '../route-connections';
import { routePath, withRoutePath } from '../route-path';
import { snapProjectedConnection, transformPhysicalEntity } from '../scene-edit';
import { boardFixture, routeFixture, routeProject } from './route-fixtures';

const entities = (project: Project) => project.sheets[project.activeSheetId].entities;
const put = (project: Project, route: ContainmentEntity) => ({ ...project, sheets: { ...project.sheets,
  [project.activeSheetId]: { ...project.sheets[project.activeSheetId], entities: { ...entities(project), [route.id]: route } } } });

describe('physical route connections', () => {
  it('discovers a board port at a different height, without connecting the plan crossing above it', () => {
    const board = boardFixture();
    const route = routeFixture('drop', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    const project = routeProject(route, board);
    expect(discoverRouteConnections(route, project)).toEqual([{ end: 'end', targetId: 'board', target: { kind: 'equipment', port: 'Top' } }]);
    expect(discoverRouteConnections({ ...route, points: route.points.slice(0, 2) }, project)).toEqual([]);
  });

  it('snaps the screen cursor to a board port regardless of the current route workplane', () => {
    const route = routeFixture(), project = routeProject(boardFixture());
    const hit = snapProjectedConnection(route, { x: 30, y: 18 }, project, p => ({ x: p.x / 100, y: p.z / 100 }), { tolerancePx: 2 });
    expect(hit).toMatchObject({ label: 'Equipment', target: { x: 3000, y: 0, z: 1800 }, position: { x: 3000, y: 0, z: 1800 } });
  });

  it('respects hidden geometry, excluded sources and incompatible sections during screen snapping', () => {
    const target = routeFixture('other'), route = routeFixture('source');
    const project = routeProject(target);
    const projectPoint = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
    expect(snapProjectedConnection(route, { x: 0, y: 0 }, project, projectPoint, { excludeId: 'other' })).toBeNull();
    target.width = 600;
    expect(snapProjectedConnection(route, { x: 0, y: 0 }, project, projectPoint)).toBeNull();
    target.width = 300; project.layers['test-layer'].visible = false;
    expect(snapProjectedConnection(route, { x: 0, y: 0 }, project, projectPoint)).toBeNull();
  });

  it('moves a board and its drop together while retaining the vertical terminal leg', () => {
    const board = boardFixture();
    const route = routeFixture('drop', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    const project = routeProject(route, board);
    route.connections = discoverRouteConnections(route, project); route.connectionsLocked = true;
    const moved = transformPhysicalEntity(board, { x: 4000, y: 500 });
    const next = { ...project, sheets: { ...project.sheets, [project.activeSheetId]: { ...project.sheets[project.activeSheetId], entities: { ...entities(project), board: moved } } } };
    const result = keepRouteConnections(project, next, ['board']);
    expect((entities(result.project).drop as ContainmentEntity).points).toEqual([
      { x: 0, y: 0, z: 2400 }, { x: 4000, y: 500, z: 2400 }, { x: 4000, y: 500, z: 1800 },
    ]);
    expect(result.changedIds).toEqual(['drop']);
    expect(route.points[1]).toEqual({ x: 3000, y: 0, z: 2400 });
  });

  it('propagates an endpoint move through a locked shared joint', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 3000, y: 0, z: 2400 }, { x: 5000, y: 0, z: 2400 }]);
    const project = routeProject(a, b);
    a.connectionsLocked = true; a.connections = discoverRouteConnections(a, project);
    const path = routePath(a); path[1].y = 1000;
    const result = keepRouteConnections(project, put(project, withRoutePath(a, path)), ['a']);
    expect((entities(result.project).b as ContainmentEntity).points[0]).toEqual({ x: 3000, y: 1000, z: 2400 });
    expect(routeEndStates(entities(result.project).a as ContainmentEntity, result.project).find(end => end.end === 'end')).toMatchObject({ connected: true, locked: true, broken: false });
  });

  it('follows a branch at its stored fractional position when the spine length changes', () => {
    const a = routeFixture('spine'), b = routeFixture('branch', [{ x: 1500, y: 0, z: 2400 }, { x: 1500, y: 2000, z: 2400 }]);
    const project = routeProject(a, b); b.connectionsLocked = true; b.connections = discoverRouteConnections(b, project);
    const path = routePath(a); path[1].x = 6000;
    const result = keepRouteConnections(project, put(project, withRoutePath(a, path)), ['spine']);
    expect((entities(result.project).branch as ContainmentEntity).points[0].x).toBe(3000);
  });

  it('rejects an edit that would pull a locked neighbouring route or collapse a leg', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 3000, y: 0, z: 2400 }, { x: 5000, y: 0, z: 2400 }]);
    const project = routeProject(a, b); a.connectionsLocked = true; a.connections = discoverRouteConnections(a, project);
    b.locked = true;
    const changed = withRoutePath(a, [{ x: 0, y: 0, z: 2400 }, { x: 4000, y: 0, z: 2400 }]);
    expect(() => keepRouteConnections(project, put(project, changed), ['a'])).toThrow('locked or hidden');
    b.locked = false; changed.points[1].x = 5000;
    expect(() => keepRouteConnections(project, put(project, changed), ['a'])).toThrow('collapse');
  });

  it('leaves unrelated broken joints untouched and highlights a deleted connection target', () => {
    const board = boardFixture();
    const broken = routeFixture('broken', [{ x: 0, y: 500, z: 1000 }, { x: 3000, y: 500, z: 1000 }]);
    broken.connectionsLocked = true; broken.connections = [{ end: 'end', targetId: 'board', target: { kind: 'equipment', port: 'Top' } }];
    const unrelated = routeFixture('unrelated', [{ x: 10000, y: 0, z: 2400 }, { x: 12000, y: 0, z: 2400 }]);
    const project = routeProject(broken, board, unrelated);
    const moved = transformPhysicalEntity(unrelated, { x: 11000, y: 1000 }) as ContainmentEntity;
    const result = keepRouteConnections(project, put(project, moved), ['unrelated']);
    expect(entities(result.project).broken).toBe(broken);
    delete entities(project).board;
    expect(routeEndStates(broken, project)[1]).toMatchObject({ broken: true, connected: false });
  });
});
