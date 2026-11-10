// A cleared numeric field gives NaN from parseFloat; updateEntity must not
// write it into an entity, where it would be saved as null.

import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import type { Entity, SymbolEntity } from '../../types';

const state = () => useStore.getState();
const entity = (id: string) => state().project.sheets[state().project.activeSheetId].entities[id];

beforeEach(() => {
  state().resetProject();
  state().addEntity({
    id: 's', kind: 'symbol', layerId: state().project.layerOrder[0], visible: true, locked: false,
    symbolId: 'x', position: { x: 1, y: 2 }, rotation: 0, scale: 1,
  } as unknown as Entity);
});

describe('updateEntity', () => {
  it('ignores patches with NaN or infinite numbers, nested or not', () => {
    const before = state().project;
    state().updateEntity('s', { scale: NaN } as Partial<Entity>);
    state().updateEntity('s', { rotation: Infinity } as Partial<Entity>);
    state().updateEntity('s', { position: { x: NaN, y: 2 } } as Partial<Entity>);
    expect(state().project).toBe(before);
    expect((entity('s') as SymbolEntity).scale).toBe(1);
  });

  it('still applies finite patches', () => {
    state().updateEntity('s', { position: { x: 5, y: 6 }, scale: 2 } as Partial<Entity>);
    expect((entity('s') as SymbolEntity).position).toEqual({ x: 5, y: 6 });
  });
});
