import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';

// The store is a module-level singleton, so every test starts from a fresh
// empty project with cleared undo/redo stacks.
beforeEach(() => {
  useStore.setState({
    project: createEmptyProject(),
    past: [],
    future: [],
  });
});

const firstLayerId = (): string => useStore.getState().project.layerOrder[0];

describe('layer defaults', () => {
  it('creates every default layer visible and unlocked', () => {
    const { layers, layerOrder } = useStore.getState().project;
    expect(layerOrder.length).toBeGreaterThan(0);
    for (const id of layerOrder) {
      expect(layers[id].visible).toBe(true);
      expect(layers[id].locked).toBe(false);
    }
  });

  it('addLayer defaults visible to true and locked to false', () => {
    useStore.getState().addLayer({ name: 'Test Layer' });
    const { layers, layerOrder } = useStore.getState().project;
    const added = layers[layerOrder[layerOrder.length - 1]];
    expect(added.name).toBe('Test Layer');
    expect(added.visible).toBe(true);
    expect(added.locked).toBe(false);
  });

  it('addLayer honors explicit visible/locked values', () => {
    useStore.getState().addLayer({ name: 'Frozen', visible: false, locked: true });
    const { layers, layerOrder } = useStore.getState().project;
    const added = layers[layerOrder[layerOrder.length - 1]];
    expect(added.visible).toBe(false);
    expect(added.locked).toBe(true);
  });
});

describe('toggleLayerVisible', () => {
  it('flips visibility and back', () => {
    const id = firstLayerId();
    useStore.getState().toggleLayerVisible(id);
    expect(useStore.getState().project.layers[id].visible).toBe(false);
    useStore.getState().toggleLayerVisible(id);
    expect(useStore.getState().project.layers[id].visible).toBe(true);
  });

  it('leaves other layer fields and other layers untouched', () => {
    const [a, b] = useStore.getState().project.layerOrder;
    const before = useStore.getState().project.layers;
    useStore.getState().toggleLayerVisible(a);
    const after = useStore.getState().project.layers;
    expect(after[a].name).toBe(before[a].name);
    expect(after[a].color).toBe(before[a].color);
    expect(after[a].locked).toBe(before[a].locked);
    // Structural sharing: untouched layers keep their identity.
    expect(after[b]).toBe(before[b]);
  });

  it('is a no-op for an unknown layer id', () => {
    const before = useStore.getState().project;
    useStore.getState().toggleLayerVisible('does-not-exist');
    expect(useStore.getState().project).toBe(before);
  });
});

describe('toggleLayerLocked', () => {
  it('flips locked and back', () => {
    const id = firstLayerId();
    useStore.getState().toggleLayerLocked(id);
    expect(useStore.getState().project.layers[id].locked).toBe(true);
    useStore.getState().toggleLayerLocked(id);
    expect(useStore.getState().project.layers[id].locked).toBe(false);
  });

  it('does not affect visibility', () => {
    const id = firstLayerId();
    useStore.getState().toggleLayerLocked(id);
    expect(useStore.getState().project.layers[id].visible).toBe(true);
  });

  it('is a no-op for an unknown layer id', () => {
    const before = useStore.getState().project;
    useStore.getState().toggleLayerLocked('does-not-exist');
    expect(useStore.getState().project).toBe(before);
  });
});

describe('undo participation', () => {
  // Codebase convention: visibility/lock toggles are transient view state
  // (like setActiveLayer / setActiveSheet) and stay out of the undo stack,
  // while structural layer edits (updateLayer, addLayer, removeLayer)
  // record history.
  it('visibility and lock toggles do not record undo history', () => {
    const id = firstLayerId();
    useStore.getState().toggleLayerVisible(id);
    useStore.getState().toggleLayerLocked(id);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('setActiveLayer does not record undo history either', () => {
    const id = useStore.getState().project.layerOrder[1];
    useStore.getState().setActiveLayer(id);
    expect(useStore.getState().project.activeLayerId).toBe(id);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('updateLayer records undo history (structural edit)', () => {
    const id = firstLayerId();
    useStore.getState().updateLayer(id, { name: 'Renamed' });
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.layers[id].name).not.toBe('Renamed');
  });
});
