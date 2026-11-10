// Route support and auto-feature layout write through setProjectPatch, so
// they must honour the issued-sheet lock themselves.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ContainmentEntity, Project } from '../../types';
import { regenerateAutoFeaturesForContainments } from '../../lib/auto-feature-actions';
import { createEmptyProject, useStore } from '../store';
import { addRouteSupports } from '../scene-actions';

const state = () => useStore.getState();

function lockedProject(status: 'S4' | 'S2'): Project {
  const project = createEmptyProject();
  const sheet = project.sheets[project.activeSheetId];
  const route: ContainmentEntity = {
    id: 'route', kind: 'containment', layerId: project.activeLayerId, visible: true, locked: false,
    containmentType: 'tray', width: 300, height: 50, elevation: 0,
    points: [{ x: 0, y: 0 }, { x: 6000, y: 0 }],
  };
  return { ...project, sheets: { [sheet.id]: {
    ...sheet, sceneStyle: 'containment', meta: { ...sheet.meta, status },
    entities: { route }, entityOrder: ['route'],
  } } };
}

describe('issued sheet route edits', () => {
  beforeEach(() => state().setProject(lockedProject('S4')));

  it('refuses addRouteSupports on a locked sheet', () => {
    const before = state().project;
    addRouteSupports('route');
    expect(state().project).toBe(before);
    expect(state().editor.statusMessage).toContain('locked from editing');
  });

  it('refuses auto-feature regeneration on a locked sheet', () => {
    const before = state().project;
    const result = regenerateAutoFeaturesForContainments(['route']);
    expect(state().project).toBe(before);
    expect(result.containmentCount).toBe(0);
    expect(state().editor.statusMessage).toContain('locked from editing');
  });

  it('still lays out supports on an unlocked sheet', () => {
    state().setProject(lockedProject('S2'));
    const before = state().project;
    addRouteSupports('route');
    expect(state().project).not.toBe(before);
  });
});
