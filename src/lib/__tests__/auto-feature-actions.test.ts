import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainmentEntity, Entity, PenetrationEntity, Project, SupportEntity, WallEntity } from '../../types';
import type { InstallationRecord } from '../../models/installation';
import { installationActivities } from '../../models/installation';
import { setCollaborationReadOnly } from '../../state/collaboration-guard';
import { createEmptyProject, useStore } from '../../state/store';
import * as generators from '../auto-features';
import { regenerateAutoFeaturesForContainments } from '../auto-feature-actions';

const history: InstallationRecord = {
  status: 'completed', updatedAt: 2000, completedAt: 2000, activities: [
    { id: 'note', kind: 'comment', text: 'Fixings inspected on site', createdAt: 1000, author: 'Installer' },
    { id: 'complete', kind: 'status', status: 'completed', previousStatus: 'planned', createdAt: 2000 },
  ],
};

function makeProject(): Project {
  const project = createEmptyProject();
  const base = { layerId: project.activeLayerId, visible: true, locked: false };
  const route: ContainmentEntity = {
    ...base, id: 'route', kind: 'containment', containmentType: 'tray', width: 300, height: 100, elevation: 2400,
    points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }],
  };
  const wall: WallEntity = {
    ...base, id: 'wall', kind: 'wall', points: [{ x: 1500, y: -1000 }, { x: 1500, y: 1000 }],
    thickness: 150, height: 3000, fireRating: 60,
  };
  const sheet = project.sheets[project.activeSheetId];
  return { ...project, sheets: { [sheet.id]: { ...sheet, entities: { route, wall }, entityOrder: ['route', 'wall'] } } };
}

const sheet = () => useStore.getState().project.sheets[useStore.getState().project.activeSheetId];
const accessories = () => Object.values(sheet().entities).filter(entity =>
  ['support', 'fitting', 'penetration'].includes(entity.kind));
const cloneCurrent = () => structuredClone(useStore.getState().project);
const editProject = (change: (project: Project, entities: Record<string, Entity>) => void) => {
  const project = cloneCurrent();
  change(project, project.sheets[project.activeSheetId].entities);
  useStore.getState().setProject(project);
};

beforeEach(() => {
  setCollaborationReadOnly(false);
  useStore.getState().setProject(makeProject());
  regenerateAutoFeaturesForContainments(['route']);
});
afterEach(() => {
  vi.restoreAllMocks();
  setCollaborationReadOnly(false);
});

describe('safe auto-feature regeneration', () => {
  it('keeps accessory identities, installation histories and seal references on unchanged regeneration', () => {
    editProject((project, entities) => {
      for (const entity of Object.values(entities)) {
        if (entity.kind === 'containment' || entity.kind === 'wall') continue;
        entity.installation = structuredClone(history);
        entity.visible = false;
        entity.locked = true;
        if (entity.kind === 'penetration') Object.assign(project.penetrationSeals![entity.sealId], {
          status: 'inspected', certificateRef: 'CERT-17', notes: 'Inspected seal', inspectedBy: 'Engineer',
        });
      }
    });
    const before = useStore.getState();
    const ids = accessories().map(entity => entity.id);
    const timeline = installationActivities(before.project);
    const result = regenerateAutoFeaturesForContainments(['route', 'route']);
    expect(result).toMatchObject({ containmentCount: 1, addedCount: 0, removedCount: 0, retainedCount: 0, matchedCount: ids.length });
    expect(accessories().map(entity => entity.id)).toEqual(ids);
    expect(installationActivities(useStore.getState().project)).toEqual(timeline);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().past).toBe(before.past);
  });

  it('matches small geometric drift without losing metadata and commits one atomic undo step', () => {
    const id = accessories().find(entity => entity.kind === 'support')!.id;
    editProject((_project, entities) => {
      const support = entities[id] as SupportEntity;
      support.position.x += 0.5;
      support.installation = structuredClone(history);
      support.visible = false;
    });
    const before = useStore.getState().project;
    const beforePast = useStore.getState().past.length;
    const result = regenerateAutoFeaturesForContainments(['route']);
    const after = useStore.getState().project;
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect((sheet().entities[id] as SupportEntity).position.x).toBe(0);
    expect(sheet().entities[id].installation).toEqual(history);
    expect(sheet().entities[id].visible).toBe(false);
    expect(useStore.getState().past.length).toBe(beforePast + 1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
  });

  it('retains unmatched recorded parts as manual and preserves their exact geometry and visibility', () => {
    const recorded = accessories().filter(entity => entity.kind !== 'penetration').slice(0, 2);
    editProject((_project, entities) => {
      for (const part of recorded) {
        entities[part.id].installation = structuredClone(history);
        entities[part.id].visible = false;
      }
      const route = entities.route as ContainmentEntity;
      route.points = route.points.map(point => ({ x: point.x + 1000, y: point.y + 2000 }));
    });
    const before = recorded.map(part => sheet().entities[part.id]);
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.retainedCount).toBe(2);
    expect(result.removedCount).toBeGreaterThan(0);
    expect(result.addedCount).toBeGreaterThan(0);
    for (const previous of before) expect(sheet().entities[previous.id]).toEqual({ ...previous, autoGenerated: false });
    expect(useStore.getState().editor.statusMessage).toMatch(/2 recorded parts retained as manual/i);
    const retainedIds = before.map(part => part.id);
    regenerateAutoFeaturesForContainments(['route']);
    for (const id of retainedIds) expect(sheet().entities[id].installation).toEqual(history);
  });

  it('does not regenerate a duplicate over an existing matching manual accessory', () => {
    const support = accessories().find(entity => entity.kind === 'support') as SupportEntity;
    editProject((_project, entities) => {
      entities[support.id] = { ...support, autoGenerated: false, installation: structuredClone(history), visible: false };
    });
    const before = useStore.getState().project;
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.addedCount).toBe(0);
    expect(accessories().filter(entity => entity.kind === 'support'
      && entity.position.x === support.position.x && entity.position.y === support.position.y)).toHaveLength(1);
    expect(useStore.getState().project).toBe(before);
  });

  it('preserves unmatched inspection evidence even when the penetration has no installation record', () => {
    const penetration = accessories().find(entity => entity.kind === 'penetration') as PenetrationEntity;
    editProject((project, entities) => {
      Object.assign(project.penetrationSeals![penetration.sealId], {
        status: 'inspected', certificateRef: 'CERT-17', notes: 'Inspection evidence', photoUrls: ['https://example.com/seal.jpg'],
      });
      (entities.route as ContainmentEntity).points = [{ x: 0, y: 4000 }, { x: 3000, y: 4000 }];
    });
    const seal = useStore.getState().project.penetrationSeals![penetration.sealId];
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.retainedCount).toBe(1);
    expect(sheet().entities[penetration.id]).toMatchObject({ autoGenerated: false, sealId: penetration.sealId });
    expect(useStore.getState().project.penetrationSeals![penetration.sealId]).toEqual(seal);
  });

  it('does not mutate a frozen manual penetration or erase its seal when it matches', () => {
    const penetration = accessories().find(entity => entity.kind === 'penetration') as PenetrationEntity;
    editProject((_project, entities) => {
      entities[penetration.id] = { ...penetration, autoGenerated: false, installation: structuredClone(history) };
    });
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.addedCount).toBe(0);
    expect(sheet().entities[penetration.id].installation).toEqual(history);
    expect(useStore.getState().project.penetrationSeals![penetration.sealId]).toBeDefined();
  });

  it('removes obsolete unrecorded parts and seals together and restores them together on undo', () => {
    const penetration = accessories().find(entity => entity.kind === 'penetration') as PenetrationEntity;
    editProject((_project, entities) => {
      (entities.route as ContainmentEntity).points = [{ x: 0, y: 4000 }, { x: 3000, y: 4000 }];
    });
    const before = useStore.getState().project;
    const previousPast = useStore.getState().past.length;
    regenerateAutoFeaturesForContainments(['route']);
    expect(sheet().entities[penetration.id]).toBeUndefined();
    expect(useStore.getState().project.penetrationSeals![penetration.sealId]).toBeUndefined();
    expect(useStore.getState().past.length).toBe(previousPast + 1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    expect(sheet().entities[penetration.id]).toBeDefined();
    expect(useStore.getState().project.penetrationSeals![penetration.sealId]).toBeDefined();
  });

  it('allocates distinct fire-seal references while regenerating multiple routes', () => {
    editProject((_project, entities) => {
      entities.second = { ...entities.route, id: 'second',
        points: [{ x: 0, y: 500 }, { x: 3000, y: 500 }] } as ContainmentEntity;
    });
    // Generation reads route entities by ID; its sheet order is needed for the
    // other-route junction detector as it is in a regular drawing.
    editProject(project => project.sheets[project.activeSheetId].entityOrder.push('second'));
    regenerateAutoFeaturesForContainments(['route', 'second']);
    const references = Object.values(useStore.getState().project.penetrationSeals!).map(seal => seal.reference);
    expect(new Set(references).size).toBe(references.length);
    expect(references.length).toBe(2);
  });

  it('does not transfer an installed identity onto a different support elevation or type', () => {
    const support = accessories().find(entity => entity.kind === 'support') as SupportEntity;
    editProject((_project, entities) => {
      entities[support.id].installation = structuredClone(history);
      (entities.route as ContainmentEntity).elevation = 3500;
    });
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.retainedCount).toBe(1);
    expect(sheet().entities[support.id]).toMatchObject({ autoGenerated: false, elevation: support.elevation });
    const newlyGenerated = accessories().filter(entity => entity.kind === 'support' && entity.autoGenerated);
    expect(newlyGenerated.every(entity => !entity.installation)).toBe(true);
  });

  it('leaves the entire project untouched if generation fails before the atomic commit', () => {
    const before = useStore.getState();
    vi.spyOn(generators, 'autoPlaceSupportsForContainment').mockImplementation(() => { throw new Error('Generation failed'); });
    expect(() => regenerateAutoFeaturesForContainments(['route'])).toThrow('Generation failed');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().past).toBe(before.past);
  });

  it('rejects collaboration-viewer changes before generation, including seals and undo history', () => {
    const before = useStore.getState();
    const spy = vi.spyOn(generators, 'autoPlaceSupportsForContainment');
    setCollaborationReadOnly(true);
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(result.containmentCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().past).toBe(before.past);
    expect(useStore.getState().editor.statusMessage).toMatch(/viewer/i);
  });
});
