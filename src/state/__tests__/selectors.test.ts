import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import {
  selectActiveSheet,
  selectCableSchedule,
  selectLayers,
  selectProjectMeta,
  selectSelectedEntity,
  selectSheetList,
} from '../selectors';
import type { Cable } from '../../models/cable';
import type { LineEntity } from '../../types';

// The selectors' whole contract is reference stability: a slice must keep
// the same reference across mutations that don't touch it, so zustand's
// strict-equality subscription skips the re-render. These tests drive the
// real store and assert on references, no React required.

beforeEach(() => {
  useStore.setState({
    project: createEmptyProject(),
    past: [],
    future: [],
  });
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

describe('selectActiveSheet', () => {
  it('returns the sheet the project points at', () => {
    const s = state();
    expect(selectActiveSheet(s)).toBe(s.project.sheets[s.project.activeSheetId]);
  });

  it('keeps its reference across an unrelated cable-schedule mutation', () => {
    const before = selectActiveSheet(state());
    state().addCable(makeCable('c1'));
    expect(selectActiveSheet(state())).toBe(before);
  });

  it('changes reference when an entity lands on the active sheet', () => {
    const before = selectActiveSheet(state());
    state().addEntity(makeLine('e1'));
    const after = selectActiveSheet(state());
    expect(after).not.toBe(before);
    expect(after.entities['e1']).toBeDefined();
  });

  it('does not change when an inactive sheet is renamed', () => {
    const inactive = state().project.sheetOrder[1];
    const before = selectActiveSheet(state());
    state().renameSheet(inactive, 'Renamed');
    expect(selectActiveSheet(state())).toBe(before);
  });
});

describe('selectLayers', () => {
  it('keeps its reference across entity edits', () => {
    const before = selectLayers(state());
    state().addEntity(makeLine('e1'));
    expect(selectLayers(state())).toBe(before);
  });

  it('changes reference when a layer is added', () => {
    const before = selectLayers(state());
    state().addLayer({ name: 'New Layer' });
    expect(selectLayers(state())).not.toBe(before);
  });
});

describe('selectCableSchedule', () => {
  it('keeps its reference across entity edits', () => {
    state().addCable(makeCable('c1'));
    const before = selectCableSchedule(state());
    state().addEntity(makeLine('e1'));
    expect(selectCableSchedule(state())).toBe(before);
  });

  it('changes reference when a cable is updated', () => {
    state().addCable(makeCable('c1'));
    const before = selectCableSchedule(state());
    state().updateCable('c1', { csa: 4 });
    expect(selectCableSchedule(state())).not.toBe(before);
  });
});

describe('selectSheetList (shallow)', () => {
  it('returns sheets in tab order', () => {
    const s = state();
    expect(selectSheetList(s).map((sh) => sh.id)).toEqual(s.project.sheetOrder);
  });

  it('keeps every element reference across an unrelated mutation', () => {
    const before = selectSheetList(state());
    state().addCable(makeCable('c1'));
    const after = selectSheetList(state());
    // Fresh array (why the hook wraps it in useShallow) but identical members.
    expect(after).not.toBe(before);
    expect(after.length).toBe(before.length);
    after.forEach((sh, i) => expect(sh).toBe(before[i]));
  });

  it('only swaps the touched element when a sheet changes', () => {
    const before = selectSheetList(state());
    state().addEntity(makeLine('e1')); // lands on the active (first) sheet
    const after = selectSheetList(state());
    expect(after[0]).not.toBe(before[0]);
    for (let i = 1; i < after.length; i++) expect(after[i]).toBe(before[i]);
  });
});

describe('selectProjectMeta (shallow)', () => {
  it('picks the header fields', () => {
    const meta = selectProjectMeta(state());
    const p = state().project;
    expect(meta).toEqual({
      id: p.id,
      name: p.name,
      client: p.client,
      engineer: p.engineer,
      units: p.units,
      standard: p.standard,
    });
  });

  it('is field-stable across entity edits (shallow-equal)', () => {
    const before = selectProjectMeta(state());
    state().addEntity(makeLine('e1'));
    const after = selectProjectMeta(state());
    expect(after).not.toBe(before); // fresh object — hence useShallow
    expect(after).toEqual(before); // …but every field unchanged
  });
});

describe('selectSelectedEntity', () => {
  it('returns null when nothing is selected', () => {
    expect(selectSelectedEntity(state())).toBeNull();
  });

  it('returns the entity for a single selection', () => {
    state().addEntity(makeLine('e1'));
    state().setSelection(['e1']);
    const s = state();
    expect(selectSelectedEntity(s)).toBe(
      s.project.sheets[s.project.activeSheetId].entities['e1'],
    );
  });

  it('returns null for multi selections and unknown ids', () => {
    state().addEntity(makeLine('e1'));
    state().addEntity(makeLine('e2'));
    state().setSelection(['e1', 'e2']);
    expect(selectSelectedEntity(state())).toBeNull();
    state().setSelection(['missing']);
    expect(selectSelectedEntity(state())).toBeNull();
  });

  it('keeps the entity reference across unrelated mutations', () => {
    state().addEntity(makeLine('e1'));
    state().setSelection(['e1']);
    const before = selectSelectedEntity(state());
    state().addCable(makeCable('c1'));
    expect(selectSelectedEntity(state())).toBe(before);
  });
});
