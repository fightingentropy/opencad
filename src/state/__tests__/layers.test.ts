import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import { generateCrossSection } from '../../views';
import type { Entity } from '../../types';

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

describe('addEntitiesByLayerName', () => {
  const layerNamed = (name: string) => {
    const { layers, layerOrder } = useStore.getState().project;
    return layerOrder.map((id) => layers[id]).find((l) => l.name === name);
  };
  const sheetEntities = (): Entity[] => {
    const { sheets, activeSheetId } = useStore.getState().project;
    return Object.values(sheets[activeSheetId].entities);
  };
  const crossSection = (): Entity[] => {
    const { project } = useStore.getState();
    return generateCrossSection({
      project,
      sheetId: project.activeSheetId,
      cutA: { x: 0, y: 0 },
      cutB: { x: 1000, y: 0 },
      viewName: 'A-A',
    });
  };

  it('puts generated view entities on the real layers with those names', () => {
    const generated = crossSection();
    const layerCount = useStore.getState().project.layerOrder.length;
    // The generators name layers; no layer is keyed by its name.
    expect(generated.map((e) => e.layerId)).toContain('Annotation');
    expect(generated.map((e) => e.layerId)).toContain('Dimensions');

    useStore.getState().addEntitiesByLayerName(generated);

    const { layers, layerOrder } = useStore.getState().project;
    const added = sheetEntities();
    expect(added).toHaveLength(generated.length);
    for (const e of added) expect(layers[e.layerId]).toBeDefined();
    const title = added.find((e) => e.kind === 'text' && e.text === 'SECTION A-A');
    expect(title?.layerId).toBe(layerNamed('Annotation')?.id);
    expect(added.find((e) => e.kind === 'dimension')?.layerId).toBe(layerNamed('Dimensions')?.id);
    expect(layerOrder).toHaveLength(layerCount);
  });

  it('recreates a missing layer and undoes it together with the entities', () => {
    const dimensions = layerNamed('Dimensions')!;
    useStore.getState().removeLayer(dimensions.id);
    const before = useStore.getState().project;

    useStore.getState().addEntitiesByLayerName(crossSection());

    const recreated = layerNamed('Dimensions');
    expect(recreated).toMatchObject({ color: dimensions.color, lineWidth: dimensions.lineWidth, visible: true });
    expect(recreated?.id).not.toBe(dimensions.id);
    expect(sheetEntities().find((e) => e.kind === 'dimension')?.layerId).toBe(recreated?.id);

    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('matches names case-insensitively and creates layers for unknown names once', () => {
    const line = (id: string, layerId: string): Entity => ({
      id, kind: 'line', layerId, visible: true, locked: false, a: { x: 0, y: 0 }, b: { x: 1, y: 1 },
    });
    const realId = firstLayerId();
    useStore.getState().addEntitiesByLayerName([
      line('a', 'annotation'),
      line('b', 'Site Survey'),
      line('c', 'site survey'),
      line('d', realId),
    ]);

    const { entities } = useStore.getState().project.sheets[useStore.getState().project.activeSheetId];
    expect(entities.a.layerId).toBe(layerNamed('Annotation')?.id);
    expect(entities.b.layerId).toBe(layerNamed('Site Survey')?.id);
    expect(entities.c.layerId).toBe(entities.b.layerId);
    expect(entities.d.layerId).toBe(realId);
  });
});
