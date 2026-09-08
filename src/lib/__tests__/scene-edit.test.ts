import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, EquipmentEntity, Project } from '../../types';
import { createEmptyProject } from '../../state/store';
import { alignRoutePoint, physicalAnchor, resizeRoute, snapPhysicalConnection, transformPhysicalEntity } from '../scene-edit';
import { polylineLength } from '../fittings';

const route = (project: Project, id: string, points = [{ x: 0, y: 0 }, { x: 3000, y: 0 }]): ContainmentEntity => ({
  id, kind: 'containment', layerId: project.activeLayerId, visible: true, locked: false,
  containmentType: 'tray', width: 300, height: 50, elevation: 0, points,
});
const fixture = () => {
  const project = createEmptyProject();
  const target = route(project, 'target');
  project.sheets[project.activeSheetId].entities = { target };
  project.sheets[project.activeSheetId].entityOrder = ['target'];
  return { project, target };
};

describe('physical editing geometry', () => {
  it('rotates around the part centre, preserving length and the original points', () => {
    const { project } = fixture();
    const source = route(project, 'source', [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1500 }]);
    const before = structuredClone(source);
    const moved = transformPhysicalEntity(source, { x: 5000, y: 5000 }, Math.PI / 2) as ContainmentEntity;
    expect(physicalAnchor(moved)).toEqual({ x: 5000, y: 5000 });
    expect(polylineLength(moved.points)).toBeCloseTo(4500);
    expect(source).toEqual(before);
  });

  it('sets total length while preserving the first endpoint and bend angles', () => {
    const { project } = fixture();
    const source = route(project, 'source', [{ x: 1000, y: 1000 }, { x: 4000, y: 1000 }, { x: 4000, y: 2500 }]);
    expect(resizeRoute(source, 9000).points).toEqual([{ x: 1000, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 4000 }]);
    expect(() => resizeRoute(source, 0)).toThrow();
    expect(() => resizeRoute(source, Number.NaN)).toThrow();
  });

  it('moves equipment terminals with the same translation and rotation as the enclosure', () => {
    const { project } = fixture();
    const board: EquipmentEntity = {
      id: 'board', kind: 'equipment', equipmentKind: 'distribution-board', tag: 'DB01',
      layerId: project.activeLayerId, visible: true, locked: false, a: { x: -500, y: -250 }, b: { x: 500, y: 250 },
      rotation: 0, connections: [{ name: 'Feeder', position: { x: 500, y: 0 } }],
    };
    const moved = transformPhysicalEntity(board, { x: 1000, y: 2000 }, Math.PI / 2) as EquipmentEntity;
    expect(moved.connections![0].position.x).toBeCloseTo(1000);
    expect(moved.connections![0].position.y).toBeCloseTo(2500);
    expect(moved.b.x - moved.a.x).toBe(1000);
    expect(moved.rotation).toBe(Math.PI / 2);
  });
});

describe('physical connection snapping', () => {
  it('snaps the nearest section end and returns the corrected part centre', () => {
    const { project, target } = fixture();
    const next = route(project, 'next', [{ x: 3010, y: 5 }, { x: 6010, y: 5 }]);
    expect(snapPhysicalConnection(next, physicalAnchor(next), project, 20)).toEqual({
      position: { x: 4500, y: 0 }, target: { ...target.points[1], z: target.elevation }, entityId: 'target', label: 'Endpoint',
      sourceEnd: 'start', attachment: { kind: 'route', anchor: 'end' },
    });
  });

  it('snaps a branch endpoint onto a spine without moving the other endpoint', () => {
    const { project } = fixture();
    const branch = route(project, 'branch', [{ x: 1500, y: 10 }, { x: 1500, y: 1000 }]);
    const hit = snapPhysicalConnection(branch, branch.points[0], project, 20, { pointOnly: true });
    expect(hit).toMatchObject({ position: { x: 1500, y: 0 }, label: 'Route' });
    expect(branch.points[1]).toEqual({ x: 1500, y: 1000 });
  });

  it('prefers the exact endpoint over a closer segment projection near a joint', () => {
    const { project } = fixture();
    const next = route(project, 'next', [{ x: 2995, y: 4 }, { x: 5995, y: 4 }]);
    expect(snapPhysicalConnection(next, physicalAnchor(next), project, 20)).toMatchObject({
      position: { x: 4500, y: 0 }, target: { x: 3000, y: 0 }, label: 'Endpoint',
    });
  });

  it.each(['height', 'section', 'hidden', 'hidden-layer', 'self'] as const)('does not snap an incompatible %s target', reason => {
    const { project, target } = fixture();
    if (reason === 'height') target.elevation = 1000;
    if (reason === 'section') target.width = 150;
    if (reason === 'hidden') target.visible = false;
    if (reason === 'hidden-layer') project.layers[target.layerId].visible = false;
    const next = route(project, 'next', [{ x: 3010, y: 0 }, { x: 6010, y: 0 }]);
    expect(snapPhysicalConnection(next, physicalAnchor(next), project, 20, { excludeId: reason === 'self' ? target.id : undefined })).toBeNull();
  });

  it('allows snapping to a locked reference without changing it', () => {
    const { project, target } = fixture();
    target.locked = true;
    const before = structuredClone(project);
    const next = route(project, 'next', [{ x: 3010, y: 0 }, { x: 6010, y: 0 }]);
    expect(snapPhysicalConnection(next, physicalAnchor(next), project, 20)?.entityId).toBe(target.id);
    expect(project).toEqual(before);
  });

  it('uses Shift to constrain a route to the nearest 45 degree axis', () => {
    expect(alignRoutePoint({ x: 1000, y: 200 }, { x: 0, y: 0 })).toEqual({ x: 1000, y: 200 });
    const constrained = alignRoutePoint({ x: 1000, y: 600 }, { x: 0, y: 0 }, true);
    expect(constrained.x).toBeCloseTo(constrained.y);
  });
});
