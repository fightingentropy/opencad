import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContainmentSampleProject } from '../../sample-containment';
import { getInsertableComponents } from '../../lib/component-library';
import { setCollaborationReadOnly } from '../collaboration-guard';
import { useStore } from '../store';
import { useNotifications } from '../notifications';
import {
  beginComponentPlacement, cancelComponentPlacement, commitComponentPlacement,
  componentPlacementPreview, useComponentPlacement,
} from '../component-placement';

const tray = () => getInsertableComponents(useStore.getState().project)
  .find((component) => component.kind === 'containment' && component.containmentType === 'tray')!;
const activeSheet = () => {
  const project = useStore.getState().project;
  return project.sheets[project.activeSheetId];
};

beforeEach(() => {
  setCollaborationReadOnly(false);
  cancelComponentPlacement();
  useNotifications.getState().clear();
  useStore.getState().setProject(createContainmentSampleProject());
  useStore.getState().setViewMode('3d');
});
afterEach(() => {
  setCollaborationReadOnly(false);
  cancelComponentPlacement();
});

describe('component placement', () => {
  it('previews without changing the project, then places once with normal selection and undo', () => {
    const before = useStore.getState().project;
    const count = activeSheet().entityOrder.length;
    expect(beginComponentPlacement(tray())).toBe(true);
    expect(useComponentPlacement.getState().pending?.surface).toBe('3d');
    const preview = componentPlacementPreview({ x: 1700, y: 2200 });
    expect(preview?.kind).toBe('containment');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().past).toHaveLength(0);

    const inserted = commitComponentPlacement({ x: 1700, y: 2200 });
    expect(inserted?.kind).toBe('containment');
    expect(activeSheet().entityOrder).toHaveLength(count + 1);
    expect(useStore.getState().editor.selection).toEqual(new Set([inserted!.id]));
    expect(useStore.getState().past).toHaveLength(1);
    expect(useComponentPlacement.getState().pending).toBeNull();
    expect(commitComponentPlacement({ x: 3000, y: 3000 })).toBeNull();
    expect(activeSheet().entityOrder).toHaveLength(count + 1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(activeSheet().entities[inserted!.id]).toEqual(inserted);
  });

  it('opens a visible 2D placement session for a symbol selected from 3D', () => {
    const symbol = getInsertableComponents(useStore.getState().project).find((component) => component.kind === 'symbol')!;
    expect(beginComponentPlacement(symbol)).toBe(true);
    expect(useStore.getState().editor.viewMode).toBe('2d');
    expect(useComponentPlacement.getState().pending?.surface).toBe('2d');
    expect(useComponentPlacement.getState().pending?.hint).toContain('in 2D');
    expect(componentPlacementPreview({ x: 1500, y: 1500 })?.kind).toBe('symbol');
    const inserted = commitComponentPlacement({ x: 1500, y: 1500 });
    expect(inserted?.kind).toBe('symbol');
    expect(inserted?.visible).toBe(true);
  });

  it('cancels a pending preview on explicit cancel, view changes and project edits', () => {
    const before = useStore.getState().project;
    beginComponentPlacement(tray());
    cancelComponentPlacement();
    expect(useComponentPlacement.getState().pending).toBeNull();
    expect(useStore.getState().project).toBe(before);
    beginComponentPlacement(tray());
    useStore.getState().setViewMode('2d');
    expect(useComponentPlacement.getState().pending).toBeNull();
    beginComponentPlacement(tray());
    useStore.getState().setProjectPatch({ name: 'Another edit' });
    expect(useComponentPlacement.getState().pending).toBeNull();
    expect(commitComponentPlacement({ x: 0, y: 0 })).toBeNull();
  });

  it('rejects a locked active layer and cancels if that layer becomes locked', () => {
    const layerId = useStore.getState().project.activeLayerId;
    useStore.getState().toggleLayerLocked(layerId);
    expect(beginComponentPlacement(tray())).toBe(false);
    expect(useStore.getState().editor.statusMessage).toMatch(/unlock/i);
    expect(useNotifications.getState().toasts.at(-1)?.message).toMatch(/unlock/i);
    useStore.getState().toggleLayerLocked(layerId);
    beginComponentPlacement(tray());
    useStore.getState().toggleLayerLocked(layerId);
    expect(useComponentPlacement.getState().pending).toBeNull();
    const before = useStore.getState().project;
    expect(commitComponentPlacement({ x: 0, y: 0 })).toBeNull();
    expect(useStore.getState().project).toBe(before);
  });

  it('rechecks collaboration permissions at commit time', () => {
    const before = useStore.getState().project;
    beginComponentPlacement(tray());
    setCollaborationReadOnly(true);
    expect(commitComponentPlacement({ x: 2000, y: 2200 })).toBeNull();
    expect(useComponentPlacement.getState().pending).toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().past).toHaveLength(0);
    expect(useStore.getState().editor.statusMessage).toMatch(/read-only/i);
    expect(useNotifications.getState().toasts.at(-1)?.message).toMatch(/read-only/i);
  });
});
