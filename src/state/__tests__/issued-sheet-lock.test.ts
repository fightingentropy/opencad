// A sheet issued for review or construction (S3, S4) is locked from entity
// edits; the revision record can still move it on.

import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import type { Entity, SheetId } from '../../types';
import type { RevisionStatus } from '../../models/revision';

const line = (id: string): Entity => ({
  id, kind: 'line', layerId: useStore.getState().project.layerOrder[0],
  visible: true, locked: false, a: { x: 0, y: 0 }, b: { x: 10, y: 10 },
});
const state = () => useStore.getState();
const sheetId = (): SheetId => state().project.activeSheetId;
const entities = () => state().project.sheets[sheetId()].entities;
const setStatus = (status: RevisionStatus) => {
  const project = state().project;
  const sheet = project.sheets[sheetId()];
  state().setProjectPatch({ sheets: { ...project.sheets, [sheet.id]: { ...sheet, meta: { ...sheet.meta, status } } } });
};

beforeEach(() => {
  state().resetProject();
  state().addEntity(line('a'));
  state().addEntity(line('b'));
});

describe('issued sheets', () => {
  it.each(['S3', 'S4'] as const)('refuse entity edits at %s', (status) => {
    setStatus(status);
    state().setSelection(['a', 'b']);
    const before = state().project;

    state().addEntity(line('c'));
    state().addEntities([line('d')]);
    state().updateEntity('a', { a: { x: 5, y: 5 } } as Partial<Entity>);
    state().removeEntities(['a']);
    state().alignEntities('left');
    state().flipEntities('horizontal');
    state().copySelection();
    state().pasteFromClipboard();
    state().duplicateSelection();

    expect(state().project).toBe(before);
    expect(state().editor.statusMessage).toContain('locked from editing');
  });

  it('allows edits again once the sheet is back to a working status or as-built', () => {
    setStatus('S4');
    state().addEntity(line('c'));
    expect(entities().c).toBeUndefined();
    for (const status of ['S2', 'S5'] as const) {
      setStatus(status);
      state().addEntity(line(`ok-${status}`));
      expect(entities()[`ok-${status}`]).toBeDefined();
    }
  });

  it('still accepts revision records on a locked sheet', () => {
    setStatus('S4');
    setStatus('S2');
    expect(state().project.sheets[sheetId()].meta?.status).toBe('S2');
  });
});
