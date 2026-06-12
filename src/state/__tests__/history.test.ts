import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_HISTORY, useStore } from '../store';
import { addMarkup } from '../markup-actions';
import { addSite } from '../site-actions';
import type { Cable } from '../../models/cable';
import type { LineEntity } from '../../types';

// Undo history shares structure with the live project: pushPast/undo/redo
// move project *references* between the stacks, and every action builds new
// objects along the changed path only. These tests pin down that contract:
// round-trips restore exact references, untouched slices stay shared across
// history entries, the stack is capped, and the DEV deep-freeze guard both
// catches in-place mutation and stays out of the way of the normal
// clone-on-write action flow.

beforeEach(() => {
  // resetProject() goes through the store, so the fresh project passes the
  // same DEV freeze chokepoint as any committed state.
  useStore.getState().resetProject();
});

const state = () => useStore.getState();

const makeLine = (id: string): LineEntity => ({
  id,
  kind: 'line',
  layerId: state().project.layerOrder[0],
  visible: true,
  locked: false,
  a: { x: 0, y: 0 },
  b: { x: 10, y: 10 },
});

const makeCable = (id: string): Cable => ({
  id,
  reference: `C-${id}`,
  from: 'DB1',
  to: 'MCC1',
  circuitType: 'power',
  construction: 'XLPE/SWA/LSOH',
  cores: 3,
  csa: 2.5,
  hasEarth: true,
  outerDiameter: 12,
  voltage: 400,
  route: [],
});

const activeSheet = () => {
  const p = state().project;
  return p.sheets[p.activeSheetId];
};

describe('undo/redo round-trips', () => {
  it('undo restores the exact previous project reference', () => {
    const before = state().project;
    state().addEntity(makeLine('e1'));
    expect(state().project).not.toBe(before);
    state().undo();
    expect(state().project).toBe(before);
  });

  it('redo restores the exact undone project reference', () => {
    state().addEntity(makeLine('e1'));
    const after = state().project;
    state().undo();
    state().redo();
    expect(state().project).toBe(after);
  });

  it('addEntity / updateEntity / removeEntities round-trip', () => {
    state().addEntity(makeLine('e1'));
    expect(activeSheet().entities['e1']).toBeDefined();

    state().updateEntity('e1', { a: { x: 5, y: 5 } });
    expect((activeSheet().entities['e1'] as LineEntity).a).toEqual({ x: 5, y: 5 });

    state().removeEntities(['e1']);
    expect(activeSheet().entities['e1']).toBeUndefined();

    state().undo(); // un-remove
    expect((activeSheet().entities['e1'] as LineEntity).a).toEqual({ x: 5, y: 5 });
    state().undo(); // un-update
    expect((activeSheet().entities['e1'] as LineEntity).a).toEqual({ x: 0, y: 0 });
    state().undo(); // un-add
    expect(activeSheet().entities['e1']).toBeUndefined();

    state().redo();
    state().redo();
    state().redo();
    expect(activeSheet().entities['e1']).toBeUndefined();
    expect(activeSheet().entityOrder).toEqual([]);
  });

  it('cable schedule actions round-trip', () => {
    state().addCable(makeCable('c1'));
    state().updateCable('c1', { csa: 4 });
    expect(state().project.cableSchedule?.cables['c1'].csa).toBe(4);

    state().undo();
    expect(state().project.cableSchedule?.cables['c1'].csa).toBe(2.5);
    state().undo();
    expect(state().project.cableSchedule?.cables['c1']).toBeUndefined();

    state().redo();
    state().redo();
    expect(state().project.cableSchedule?.cables['c1'].csa).toBe(4);
    expect(state().project.cableSchedule?.cableOrder).toEqual(['c1']);
  });

  it('addSheet / removeSheet round-trip', () => {
    const sheetCount = state().project.sheetOrder.length;
    state().addSheet({ name: 'Extra' });
    const addedId = state().project.activeSheetId;
    expect(state().project.sheetOrder).toHaveLength(sheetCount + 1);

    state().removeSheet(addedId);
    expect(state().project.sheetOrder).toHaveLength(sheetCount);

    state().undo();
    expect(state().project.sheets[addedId].name).toBe('Extra');
    state().undo();
    expect(state().project.sheetOrder).toHaveLength(sheetCount);

    state().redo();
    state().redo();
    expect(state().project.sheetOrder).toHaveLength(sheetCount);
    expect(state().project.sheets[addedId]).toBeUndefined();
  });

  it('setProjectPatch (companion action modules) round-trips', () => {
    const before = state().project;
    const next = addMarkup(before, {
      sheetId: before.activeSheetId,
      anchorPoint: { x: 1, y: 2 },
      kind: 'comment',
      text: 'Check this',
      author: 'QA',
    });
    state().setProjectPatch({ markups: next.markups });
    expect(Object.keys(state().project.markups ?? {})).toHaveLength(1);

    state().undo();
    expect(state().project).toBe(before);
    state().redo();
    expect(Object.keys(state().project.markups ?? {})).toHaveLength(1);
  });

  it('a new action clears the redo stack', () => {
    state().addEntity(makeLine('e1'));
    state().undo();
    expect(state().future).toHaveLength(1);
    state().addEntity(makeLine('e2'));
    expect(state().future).toHaveLength(0);
  });

  it('undo/redo are no-ops on empty stacks', () => {
    const before = state().project;
    state().undo();
    expect(state().project).toBe(before);
    state().redo();
    expect(state().project).toBe(before);
  });
});

describe('structural sharing across history entries', () => {
  it('pushes the live project reference into past (no clone)', () => {
    const before = state().project;
    state().addEntity(makeLine('e1'));
    expect(state().past[state().past.length - 1]).toBe(before);
  });

  it('undo pushes the live project reference into future (no clone)', () => {
    state().addEntity(makeLine('e1'));
    const after = state().project;
    state().undo();
    expect(state().future[0]).toBe(after);
  });

  it('a sheet untouched by an action is reference-equal across entries', () => {
    state().addEntity(makeLine('e1')); // lands on the active (first) sheet
    const snapshot = state().past[state().past.length - 1];
    const current = state().project;
    const inactiveId = current.sheetOrder[1];
    expect(current.sheets[inactiveId]).toBe(snapshot.sheets[inactiveId]);
    // Other untouched slices share too.
    expect(current.layers).toBe(snapshot.layers);
    expect(current.layerOrder).toBe(snapshot.layerOrder);
  });

  it('cable edits share every sheet with the snapshot', () => {
    state().addCable(makeCable('c1'));
    const snapshot = state().past[state().past.length - 1];
    expect(state().project.sheets).toBe(snapshot.sheets);
  });

  it('site actions via setProjectPatch share untouched slices', () => {
    const before = state().project;
    state().setProjectPatch(addSite(before, { id: 'site-1', name: 'Main' }));
    const current = state().project;
    expect(current.sites?.['site-1']).toBeDefined();
    expect(current.sheets).toBe(before.sheets);
    expect(current.layers).toBe(before.layers);
  });
});

describe('MAX_HISTORY trim', () => {
  it('caps past at MAX_HISTORY, dropping the oldest entries', () => {
    const layerId = state().project.layerOrder[0];
    const extra = 5;
    for (let i = 0; i < MAX_HISTORY + extra; i++) {
      state().updateLayer(layerId, { name: `L${i}` });
    }
    expect(state().past).toHaveLength(MAX_HISTORY);
    // The oldest surviving snapshot is the state just before update #extra.
    expect(state().past[0].layers[layerId].name).toBe(`L${extra - 1}`);

    for (let i = 0; i < MAX_HISTORY; i++) state().undo();
    expect(state().past).toHaveLength(0);
    expect(state().project.layers[layerId].name).toBe(`L${extra - 1}`);

    // Bottomed out: further undo is a no-op.
    const floor = state().project;
    state().undo();
    expect(state().project).toBe(floor);

    // And the full redo walk returns to the final state.
    for (let i = 0; i < MAX_HISTORY; i++) state().redo();
    expect(state().project.layers[layerId].name).toBe(`L${MAX_HISTORY + extra - 1}`);
  });
});

describe('DEV deep-freeze guard', () => {
  it('is active under vitest (import.meta.env.DEV)', () => {
    expect(import.meta.env.DEV).toBe(true);
  });

  it('freezes committed projects deeply', () => {
    state().addEntity(makeLine('e1'));
    const p = state().project;
    expect(Object.isFrozen(p)).toBe(true);
    const sheet = p.sheets[p.activeSheetId];
    expect(Object.isFrozen(sheet)).toBe(true);
    expect(Object.isFrozen(sheet.entities['e1'])).toBe(true);
    expect(Object.isFrozen((sheet.entities['e1'] as LineEntity).a)).toBe(true);
    expect(Object.isFrozen(sheet.entityOrder)).toBe(true);
  });

  it('in-place mutation of committed state throws', () => {
    state().addEntity(makeLine('e1'));
    const line = activeSheet().entities['e1'] as LineEntity;
    expect(() => {
      (line.a as { x: number }).x = 99;
    }).toThrow(TypeError);
    expect(() => {
      (activeSheet().entityOrder as string[]).push('rogue');
    }).toThrow(TypeError);
  });

  it('normal clone-on-write actions keep working on frozen state', () => {
    state().addEntity(makeLine('e1'));
    state().addEntity({ ...makeLine('e2'), a: { x: 20, y: 20 }, b: { x: 40, y: 40 } });
    state().setSelection(['e1', 'e2']);

    // These all structuredClone / spread frozen entities — none may throw.
    expect(() => state().alignEntities('left')).not.toThrow();
    expect(() => state().flipEntities('horizontal')).not.toThrow();
    expect(() => state().copySelection()).not.toThrow();
    expect(() => state().pasteFromClipboard({ x: 100, y: 100 })).not.toThrow();
    expect(() => state().duplicateSelection()).not.toThrow();
    expect(activeSheet().entityOrder.length).toBe(6); // 2 + 2 pasted + 2 duplicated

    // Walking the whole history back and forth stays safe too.
    while (state().past.length > 0) state().undo();
    while (state().future.length > 0) state().redo();
    expect(activeSheet().entityOrder.length).toBe(6);
  });
});
