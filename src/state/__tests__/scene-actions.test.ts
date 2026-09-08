import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainmentEntity, Entity, FittingEntity, Project } from '../../types';
import { getInsertableComponents } from '../../lib/component-library';
import { polylineLength } from '../../lib/fittings';
import { physicalAnchor } from '../../lib/scene-edit';
import { projectWithAutoFeatures } from '../../lib/auto-feature-actions';
import * as generators from '../../lib/auto-features';
import { createEmptyProject, useStore } from '../store';
import { setCollaborationReadOnly } from '../collaboration-guard';
import { commitPhysicalEntity, updatePhysicalProperty } from '../scene-actions';
import {
  beginComponentPlacement, beginEntityPlacement, cancelComponentPlacement, commitComponentPlacement,
  componentPlacementPreview, resolvePlacementPosition, setComponentPlacementPosition, updatePlacementOptions, useComponentPlacement,
} from '../component-placement';

function fixture(): Project {
  const project = createEmptyProject();
  const sheet = project.sheets[project.activeSheetId];
  const route: ContainmentEntity = {
    id: 'route', kind: 'containment', layerId: project.activeLayerId, visible: true, locked: false,
    containmentType: 'tray', width: 300, height: 50, elevation: 0,
    points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
  };
  sheet.sceneStyle = 'containment';
  sheet.entities = { route };
  sheet.entityOrder = ['route'];
  return project;
}
const state = () => useStore.getState();
const entities = () => state().project.sheets[state().project.activeSheetId].entities;
const route = () => entities().route as ContainmentEntity;
const partsFor = (id: string) => Object.values(entities()).filter(e => e.kind === 'fitting' && e.containmentId === id);
const component = (id: string) => getInsertableComponents(state().project).find(c => c.id === id)!;
const load = (project: Project) => { state().setProject(project); state().setViewMode('3d'); };
const prepare = (change: (project: Project, source: ContainmentEntity) => void) => {
  const project = structuredClone(state().project);
  change(project, project.sheets[project.activeSheetId].entities.route as ContainmentEntity);
  load(project);
};

beforeEach(() => { setCollaborationReadOnly(false); cancelComponentPlacement(); load(fixture()); });
afterEach(() => { setCollaborationReadOnly(false); cancelComponentPlacement(); vi.restoreAllMocks(); });

describe('atomic physical edits', () => {
  it('changes a section and its fittings in one undo step, preserving recorded work', () => {
    const staged = projectWithAutoFeatures(state().project, ['route'], { supports: false }).project;
    const cap = Object.values(staged.sheets[staged.activeSheetId].entities).find(e => e.kind === 'fitting')!;
    cap.installation = { status: 'completed', updatedAt: 1000, activities: [] };
    (cap as FittingEntity).catalogPartNumber = 'TRAY-END-300';
    load(staged);
    const before = state().project;
    expect(updatePhysicalProperty('route', 'width', 450)).toBe(true);
    expect(route().width).toBe(450);
    expect((entities()[cap.id] as FittingEntity).width).toBe(450);
    expect((entities()[cap.id] as FittingEntity).catalogPartNumber).toBeUndefined();
    expect(entities()[cap.id].installation).toEqual(cap.installation);
    expect(state().past).toHaveLength(1);
    const after = state().project;
    state().undo(); expect(state().project).toBe(before);
    state().redo(); expect(state().project).toBe(after);
  });

  it('removes stale stock identity when a catalogue section becomes a custom size', () => {
    prepare((_project, source) => Object.assign(source, { catalogProductId: 'product', catalogPartNumber: 'TRAY-300', manufacturer: 'Manufacturer', innerCsaMm2: 12000 }));
    const before = state().project;
    updatePhysicalProperty('route', 'depth', 100);
    expect(route()).toMatchObject({ width: 300, height: 100, catalogProductId: undefined, catalogPartNumber: undefined, innerCsaMm2: undefined });
    state().undo(); expect(state().project).toBe(before);
    expect(route().catalogPartNumber).toBe('TRAY-300');
  });

  it.each(['width', 'length', 'elevation'] as const)('rejects invalid %s without adding history', property => {
    const before = state().project;
    expect(updatePhysicalProperty('route', property, Number.NaN)).toBe(false);
    expect(updatePhysicalProperty('route', property, 2_000_000)).toBe(false);
    expect(state().project).toBe(before);
    expect(state().past).toHaveLength(0);
  });

  it.each(['entity', 'layer', 'read-only'] as const)('respects a locked %s during property edits', reason => {
    prepare((project, source) => {
      if (reason === 'entity') source.locked = true;
      if (reason === 'layer') project.layers[source.layerId].locked = true;
    });
    if (reason === 'read-only') setCollaborationReadOnly(true);
    const before = state().project;
    expect(updatePhysicalProperty('route', 'length', 6000)).toBe(false);
    expect(state().project).toBe(before);
    expect(state().past).toHaveLength(0);
  });

  it('rejects a stale edit and keeps the model intact if an accessory generator fails', () => {
    const before = state().project;
    state().setProjectPatch({ name: 'Concurrent edit' });
    expect(commitPhysicalEntity({ ...route(), width: 450 }, before)).toBeNull();
    const current = state().project;
    vi.spyOn(generators, 'autoPlaceFittingsForContainment').mockImplementation(() => { throw new Error('Generator unavailable'); });
    expect(updatePhysicalProperty('route', 'width', 450)).toBe(false);
    expect(state().project).toBe(current);
    expect(state().past).toHaveLength(1);
  });

  it('connects to a locked reference without editing that route or its accessories', () => {
    prepare((project, source) => {
      source.id = 'a'; source.locked = true;
      const sheet = project.sheets[project.activeSheetId];
      sheet.entities = { a: source }; sheet.entityOrder = ['a'];
    });
    const reference = entities().a as ContainmentEntity;
    const next = { ...reference, id: 'z', locked: false, points: [{ x: 3000, y: 0 }, { x: 6000, y: 0 }] };
    expect(commitPhysicalEntity(next, state().project, true)).not.toBeNull();
    expect(entities().a).toBe(reference);
    expect(partsFor('z')).toContainEqual(expect.objectContaining({ fittingKind: 'coupler', position: { x: 3000, y: 0 } }));
    expect(partsFor('a')).toHaveLength(0);
  });
});

describe('3D placement and editing sessions', () => {
  it('changes preview length and rotation without history, then saves that exact geometry', () => {
    const before = state().project;
    beginComponentPlacement(component('containment:tray:300:50'));
    updatePlacementOptions({ length: 6000, rotation: Math.PI / 2, elevation: 1000 });
    const preview = componentPlacementPreview({ x: 7000, y: 0 }) as ContainmentEntity;
    expect(polylineLength(preview.points)).toBeCloseTo(6000);
    expect(preview.points[0].x).toBeCloseTo(preview.points[1].x);
    expect(state().project).toBe(before);
    expect(state().past).toHaveLength(0);
    const placed = commitComponentPlacement({ x: 7000, y: 0 })!;
    expect(placed).toEqual({ ...preview, id: placed.id });
    expect(state().past).toHaveLength(1);
    state().undo(); expect(state().project).toBe(before);
  });

  it('repeats with fresh identities, one undo per placement, and cancels only the pending copy', () => {
    const before = state().project;
    beginComponentPlacement(component('equipment:distribution-board'));
    updatePlacementOptions({ repeat: true });
    const first = commitComponentPlacement({ x: 6000, y: 1000 })!;
    const once = state().project;
    const second = commitComponentPlacement({ x: 8000, y: 1000 })!;
    expect(second.id).not.toBe(first.id);
    expect(first.kind === 'equipment' && second.kind === 'equipment' && first.tag !== second.tag).toBe(true);
    expect(useComponentPlacement.getState().pending).not.toBeNull();
    cancelComponentPlacement();
    expect(entities()[first.id]).toBe(first);
    expect(entities()[second.id]).toBe(second);
    expect(state().past).toHaveLength(2);
    state().undo(); expect(state().project).toBe(once);
    state().undo(); expect(state().project).toBe(before);
  });

  it('duplicates a physical route without copying installation or cable assignments', () => {
    prepare((_project, source) => {
      source.installation = { status: 'completed', updatedAt: 1000, activities: [] };
      source.assignedCableIds = ['cable-1'];
    });
    const original = route();
    beginEntityPlacement('route', 'duplicate');
    const copied = commitComponentPlacement({ x: 1500, y: 1000 }) as ContainmentEntity;
    expect(copied.id).not.toBe(original.id);
    expect(copied.installation).toBeUndefined();
    expect(copied.assignedCableIds).toBeUndefined();
    expect(polylineLength(copied.points)).toBe(3000);
    expect(entities().route).toBe(original);
  });

  it('moves the existing identity, and cancels a reshape without changing geometry', () => {
    const before = state().project;
    beginEntityPlacement('route', 'endpoint', 1);
    expect((componentPlacementPreview({ x: 5000, y: 1000 }) as ContainmentEntity).points[1]).toEqual({ x: 5000, y: 1000, z: 0 });
    cancelComponentPlacement(); expect(state().project).toBe(before);
    beginEntityPlacement('route', 'move');
    const moved = commitComponentPlacement({ x: 4000, y: 2000 }) as ContainmentEntity;
    expect(moved.id).toBe('route');
    expect(physicalAnchor(moved)).toEqual({ x: 4000, y: 2000 });
    expect(Object.values(entities()).filter(e => e.kind === 'containment')).toHaveLength(1);
    state().undo(); expect(state().project).toBe(before);
  });

  it('edits the selected part on its own layer when a different drawing layer is locked', () => {
    prepare((project, source) => {
      const layerId = project.layerOrder.find(id => id !== source.layerId)!;
      project.activeLayerId = layerId;
      project.layers[layerId].locked = true;
    });
    const originalLayer = route().layerId;
    expect(beginEntityPlacement('route', 'move')).toBe(true);
    const moved = commitComponentPlacement({ x: 4500, y: 1000 })!;
    expect(moved.layerId).toBe(originalLayer);
    expect(beginEntityPlacement('route', 'duplicate')).toBe(true);
    const copied = commitComponentPlacement({ x: 4500, y: 2000 })!;
    expect(copied.layerId).toBe(originalLayer);
    expect(copied.id).not.toBe(moved.id);
  });

  it('extends an existing endpoint and includes the new bend in the same undo transaction', () => {
    const before = state().project;
    beginEntityPlacement('route', 'extend', 1);
    const extended = commitComponentPlacement({ x: 3000, y: 2000 }) as ContainmentEntity;
    expect(extended.points).toEqual([{ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }, { x: 3000, y: 2000, z: 0 }]);
    expect(partsFor('route')).toContainEqual(expect.objectContaining({ fittingKind: 'flat-bend', angleDeg: 90 }));
    state().undo(); expect(state().project).toBe(before);
  });

  it('commits the snapped centre and generates one connector across joined sections', () => {
    beginComponentPlacement(component('containment:tray:300:50'));
    const resolved = resolvePlacementPosition({ x: 4510, y: 3 }, 30);
    expect(resolved.connection?.label).toBe('Endpoint');
    expect(resolved.position).toEqual({ x: 4500, y: 0, z: 0 });
    setComponentPlacementPosition(resolved.position, resolved.connection);
    const inserted = commitComponentPlacement(resolved.position) as ContainmentEntity;
    expect(inserted.points[0]).toEqual({ x: 3000, y: 0 });
    const joint = Object.values(entities()).filter(e => e.kind === 'fitting' && e.position.x === 3000 && e.position.y === 0);
    expect(joint).toMatchObject([{ fittingKind: 'coupler' }]);
  });

  it.each(['containment:conduit:25:round', 'equipment:distribution-board', 'support:trapeze-hanger'])('keeps %s on the existing 3D workspace', id => {
    const before = state().project;
    expect(beginComponentPlacement(component(id))).toBe(true);
    expect(useComponentPlacement.getState().pending?.surface).toBe('3d');
    const inserted = commitComponentPlacement({ x: 6000, y: 2000 }) as Entity;
    expect(entities()[inserted.id]).toBe(inserted);
    expect(state().editor.viewMode).toBe('3d');
    state().undo(); expect(state().project).toBe(before);
  });
});
