import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import {
  applyAuthenticatedCollaborationUpdate,
  setCollaborationReadOnly,
} from '../collaboration-guard';

afterEach(() => {
  setCollaborationReadOnly(false);
  useStore.getState().setProject(createEmptyProject());
});
describe('authenticated collaboration viewer guard', () => {
  it('reverts local drawing mutations while preserving the session project', () => {
    const before = useStore.getState().project;
    setCollaborationReadOnly(true);
    useStore.getState().setProjectPatch({ name: 'forbidden local edit' });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().editor.statusMessage).toMatch(/viewer/i);
  });

  it('allows verified remote room updates to replace a viewer project', () => {
    setCollaborationReadOnly(true);
    const remote = { ...createEmptyProject(), name: 'Remote project' };
    applyAuthenticatedCollaborationUpdate(() => useStore.getState().setProject(remote));
    expect(useStore.getState().project).toBe(remote);
  });
});
