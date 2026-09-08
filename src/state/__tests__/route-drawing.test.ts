import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContainmentEntity, EquipmentEntity } from '../../types';
import { getInsertableComponents } from '../../lib/component-library';
import { routeLength } from '../../lib/route-path';
import { discoverRouteConnections, routeEndStates } from '../../lib/route-connections';
import { boardFixture, routeFixture, routeProject } from '../../lib/__tests__/route-fixtures';
import { exportProjectJSON, importProjectJSON } from '../../io/project';
import { useStore } from '../store';
import { setCollaborationReadOnly } from '../collaboration-guard';
import { beginRouteDrawing, addRouteDrawingPoint, finishRouteDrawing, undoRouteDrawingPoint, cancelComponentPlacement,
  updatePlacementOptions, resolvePlacementPosition, useComponentPlacement } from '../component-placement';
import { updatePhysicalProperty } from '../scene-actions';

const state = () => useStore.getState();
const entities = () => state().project.sheets[state().project.activeSheetId].entities;
const component = () => getInsertableComponents(state().project).find(c => c.id === 'containment:tray:300:50')!;
const load = (project = routeProject()) => { state().setProject(project); state().setViewMode('3d'); };
beforeEach(() => { setCollaborationReadOnly(false); cancelComponentPlacement(); load(); });
afterEach(() => { setCollaborationReadOnly(false); cancelComponentPlacement(); });

describe('continuous route drawing', () => {
  it('stages corners and a rise, commits their 3D length and bends, then undoes everything once', () => {
    const before = state().project;
    expect(beginRouteDrawing(component())).toBe(true);
    addRouteDrawingPoint({ x: 0, y: 0, z: 2400 });
    addRouteDrawingPoint({ x: 3000, y: 0, z: 2400 });
    updatePlacementOptions({ elevation: 3000 });
    addRouteDrawingPoint({ x: 3000, y: 2000, z: 3000 });
    expect(state().project).toBe(before); expect(state().past).toHaveLength(0);
    const route = finishRouteDrawing() as ContainmentEntity;
    expect(route.points).toEqual([{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 },
      { x: 3000, y: 0, z: 3000 }, { x: 3000, y: 2000, z: 3000 }]);
    expect(routeLength(route)).toBe(5600);
    const bends = Object.values(entities()).filter(e => e.kind === 'fitting' && e.fittingKind.includes('riser'));
    expect(bends).toHaveLength(2);
    expect(state().past).toHaveLength(1); state().undo(); expect(state().project).toBe(before);
  });

  it('keeps a typed 45-degree leg exactly 1000 mm with grid and endpoint snaps enabled', () => {
    beginRouteDrawing(component()); addRouteDrawingPoint({ x: 0, y: 0, z: 2400 });
    state().setSnap({ grid: true, gridSize: 500 });
    updatePlacementOptions({ length: 1000, legAngle: Math.PI / 4 });
    const resolved = resolvePlacementPosition({ x: 3000, y: 2500 }, 50);
    expect(Math.hypot(resolved.position.x, resolved.position.y)).toBeCloseTo(1000, 6);
    expect(resolved.position.x).toBeCloseTo(resolved.position.y, 6);
    addRouteDrawingPoint(resolved.position);
    expect(routeLength(finishRouteDrawing() as ContainmentEntity)).toBeCloseTo(1000, 6);
  });

  it('draws across to a board first and then drops vertically into its port', () => {
    load(routeProject(boardFixture())); beginRouteDrawing(component());
    addRouteDrawingPoint({ x: 0, y: 0, z: 2400 });
    addRouteDrawingPoint({ x: 3000, y: 0, z: 1800 });
    const route = finishRouteDrawing() as ContainmentEntity;
    expect(route.points).toEqual([{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    expect(route.connectionsLocked).toBe(true);
    expect(route.connections).toEqual([{ end: 'end', targetId: 'board', target: { kind: 'equipment', port: 'Top' } }]);
    const caps = Object.values(entities()).filter(e => e.kind === 'fitting' && e.fittingKind === 'end-cap');
    expect(caps).toHaveLength(1);
  });

  it('undoes only the last draft click and cancels without saving any route', () => {
    const before = state().project;
    beginRouteDrawing(component()); addRouteDrawingPoint({ x: 0, y: 0, z: 2400 });
    addRouteDrawingPoint({ x: 2000, y: 0, z: 3000 });
    undoRouteDrawingPoint();
    expect(useComponentPlacement.getState().pending?.routePoints).toEqual([{ x: 0, y: 0, z: 2400 }]);
    expect(finishRouteDrawing()).toBeNull();
    cancelComponentPlacement(); expect(state().project).toBe(before); expect(state().past).toHaveLength(0);
  });

  it('extends the start while retaining the saved route direction and existing identity', () => {
    load(routeProject(routeFixture()));
    expect(beginRouteDrawing(component(), 'route', true)).toBe(true);
    addRouteDrawingPoint({ x: -1000, y: 0, z: 2400 });
    const updated = finishRouteDrawing() as ContainmentEntity;
    expect(updated.id).toBe('route');
    expect(updated.points.map(p => p.x)).toEqual([-1000, 0, 3000]);
    expect(state().past).toHaveLength(1);
  });

  it('rejects stale or read-only drafts without creating history', () => {
    setCollaborationReadOnly(true); expect(beginRouteDrawing(component())).toBe(false);
    setCollaborationReadOnly(false); beginRouteDrawing(component());
    addRouteDrawingPoint({ x: 0, y: 0, z: 2400 }); addRouteDrawingPoint({ x: 1000, y: 0, z: 2400 });
    state().setProjectPatch({ name: 'Changed elsewhere' });
    expect(finishRouteDrawing()).toBeNull(); expect(Object.values(entities())).toHaveLength(0);
  });
});

describe('joined route transactions and persistence', () => {
  const connectedProject = () => {
    const board = boardFixture(), route = routeFixture('drop', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    const project = routeProject(route, board); route.connections = discoverRouteConnections(route, project); route.connectionsLocked = true; return project;
  };
  it('moves a board and its connected legs in one undo step with both 3D and legacy property actions', () => {
    load(connectedProject()); const before = state().project;
    expect(updatePhysicalProperty('board', 'x', 4000)).toBe(true);
    expect((entities().drop as ContainmentEntity).points[2].x).toBe(4000);
    expect(state().past).toHaveLength(1); state().undo(); expect(state().project).toBe(before);
    const board = entities().board as EquipmentEntity;
    state().updateEntity('board', { a: { ...board.a, x: board.a.x + 600 }, b: { ...board.b, x: board.b.x + 600 } });
    expect((entities().drop as ContainmentEntity).points[2].x).toBe(3600);
    expect(state().past).toHaveLength(1); state().undo(); expect(state().project).toBe(before);
  });
  it('rolls back the whole move when a connected leg is locked', () => {
    const project = connectedProject(); (project.sheets[project.activeSheetId].entities.drop as ContainmentEntity).locked = true;
    load(project); const before = state().project;
    expect(updatePhysicalProperty('board', 'x', 4000)).toBe(false);
    expect(state().project).toBe(before); expect(state().past).toHaveLength(0);
  });
  it('preserves vertex elevations, constraints and guides through export and reload', () => {
    const project = connectedProject(); project.coordination = { clearanceMm: 200, equipmentAccessMm: 900 };
    const restored = importProjectJSON(exportProjectJSON(project));
    const route = restored.sheets[restored.activeSheetId].entities.drop as ContainmentEntity;
    expect(route.points).toEqual(project.sheets[project.activeSheetId].entities.drop.kind === 'containment' && (project.sheets[project.activeSheetId].entities.drop as ContainmentEntity).points);
    expect(routeEndStates(route, restored)[1]).toMatchObject({ connected: true, locked: true });
    expect(restored.coordination).toEqual(project.coordination);
  });
});
