import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContainmentSampleProject } from '../../sample-containment';
import { runCommand } from '../../lib/commands';
import { buildWorkspaceSearchIndex, searchWorkspace } from '../../lib/workspace-search';
import { useStore } from '../store';
import { activateTool } from '../tool-actions';
import { setCollaborationReadOnly } from '../collaboration-guard';
import { beginComponentPlacement, cancelComponentPlacement, commitComponentPlacement, useComponentPlacement } from '../component-placement';

beforeEach(() => {
  setCollaborationReadOnly(false);
  cancelComponentPlacement();
  useStore.getState().setProject(createContainmentSampleProject());
  useStore.getState().setViewMode('3d');
});
afterEach(() => {
  setCollaborationReadOnly(false);
  cancelComponentPlacement();
});

describe('containment tool entry points', () => {
  it.each(['tray', 'trunking', 'basket'] as const)('keeps the %s command on the existing 3D workplane', (tool) => {
    const before = useStore.getState().project;
    runCommand(`tool.${tool}`);
    expect(useStore.getState().editor.viewMode).toBe('3d');
    expect(useStore.getState().project).toBe(before);
    expect(useComponentPlacement.getState().pending?.surface).toBe('3d');
    const entity = commitComponentPlacement({ x: 1200, y: 2400 });
    expect(entity?.kind).toBe('containment');
    expect(entity && 'containmentType' in entity && entity.containmentType).toBe(tool);
    expect(useStore.getState().project.activeSheetId).toBe(before.activeSheetId);
    expect(useStore.getState().project.sheets[before.activeSheetId].entities[entity!.id]).toBe(entity);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('turns the exact reported search result into an Add action in 3D', () => {
    const before = useStore.getState().project;
    const results = searchWorkspace(buildWorkspaceSearchIndex(before, undefined, undefined, '3d'), 'cable tray tool');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('component');
    if (results[0].kind !== 'component') throw new Error('Expected a placement result');
    expect(results[0].component.definition).toMatchObject({ containmentType: 'tray', width: 300, height: 50 });
    beginComponentPlacement(results[0].component);
    expect(useStore.getState().editor.viewMode).toBe('3d');
    expect(useStore.getState().project).toBe(before);
    expect(useComponentPlacement.getState().pending?.surface).toBe('3d');
  });

  it('retains freeform tray drawing when the user is in 2D', () => {
    useStore.getState().setViewMode('2d');
    const results = searchWorkspace(buildWorkspaceSearchIndex(useStore.getState().project), 'cable tray tool');
    expect(results[0].kind).toBe('command');
    runCommand('tool.tray');
    expect(useStore.getState().editor.viewMode).toBe('2d');
    expect(useStore.getState().editor.tool).toBe('tray');
    expect(useComponentPlacement.getState().pending).toBeNull();
  });

  it('uses the same placement path for the library and preserves 3D for Select and Pan', () => {
    activateTool('tray');
    expect(useComponentPlacement.getState().pending?.surface).toBe('3d');
    runCommand('tool.select');
    expect(useComponentPlacement.getState().pending).toBeNull();
    expect(useStore.getState().editor.viewMode).toBe('3d');
    runCommand('tool.pan');
    expect(useStore.getState().editor.viewMode).toBe('3d');
  });

  it('does not fall into a drawing view when placement is blocked', () => {
    const layerId = useStore.getState().project.activeLayerId;
    useStore.getState().toggleLayerLocked(layerId);
    runCommand('tool.tray');
    expect(useStore.getState().editor.viewMode).toBe('3d');
    expect(useComponentPlacement.getState().pending).toBeNull();
    useStore.getState().toggleLayerLocked(layerId);
    setCollaborationReadOnly(true);
    runCommand('tool.basket');
    expect(useStore.getState().editor.viewMode).toBe('3d');
    expect(useComponentPlacement.getState().pending).toBeNull();
  });
});
