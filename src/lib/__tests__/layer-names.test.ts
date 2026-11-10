import { describe, expect, it } from 'vitest';
import type { Entity, Layer, LayerId, Sheet } from '../../types';
import { createLayerNameResolver, repairLayerNames, withLayerRemoved } from '../layer-names';

const layer = (id: LayerId, name: string): Layer => ({
  id, name, color: '#ffffff', visible: true, locked: false, lineWidth: 0.5,
});

const layersOf = (...list: Layer[]): { layers: Record<LayerId, Layer>; layerOrder: LayerId[] } => ({
  layers: Object.fromEntries(list.map((l) => [l.id, l])),
  layerOrder: list.map((l) => l.id),
});

const sheetWith = (entities: Entity[]): Sheet => ({
  id: 'sheet-1',
  name: 'Schematic',
  number: '001',
  kind: 'schematic',
  width: 432,
  height: 279,
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
  entityOrder: entities.map((e) => e.id),
});

const line = (id: string, layerId: string): Entity => ({
  id, kind: 'line', layerId, visible: true, locked: false, a: { x: 0, y: 0 }, b: { x: 1, y: 1 },
});

describe('layers created for the app\'s own layer names', () => {
  it('get the same id from every resolver, so peers that create one at once create the same layer', () => {
    const one = createLayerNameResolver(layersOf(layer('k3J9xQ0aZt', 'Symbols')));
    const two = createLayerNameResolver(layersOf(layer('k3J9xQ0aZt', 'Symbols')));

    expect(one.resolveKnownName('underlay')).toBe('layer-underlay');
    expect(two.resolve('Underlay')).toBe('layer-underlay');
    expect(one.layers).toEqual(two.layers);
    expect(one.layerOrder).toEqual(['k3J9xQ0aZt', 'layer-underlay']);
    expect(one.layers['layer-underlay']).toMatchObject({ id: 'layer-underlay', name: 'Underlay' });
    expect(one.resolve('Wire Labels')).toBe('layer-wire-labels');
  });

  it('are not created when a layer already has the name', () => {
    const project = layersOf(layer('k3J9xQ0aZt', 'Symbols'), layer('Zq81mVb4Xy', 'underlay'));
    const resolver = createLayerNameResolver(project);

    expect(resolver.resolveKnownName('Underlay')).toBe('Zq81mVb4Xy');
    expect(resolver.resolveKnownName('layer-underlay')).toBe('Zq81mVb4Xy');
    expect(resolver.layers).toBe(project.layers);
  });

  it('are found by their id after a rename, and not replaced', () => {
    const project = layersOf(layer('layer-underlay', 'Site plan'));
    const resolver = createLayerNameResolver(project);

    expect(resolver.resolveKnownName('underlay')).toBe('layer-underlay');
    expect(resolver.resolve('Underlay')).toBe('layer-underlay');
    expect(resolver.layers).toBe(project.layers);
    expect(resolver.layers['layer-underlay'].name).toBe('Site plan');
  });

  it('are created again for an entity that still points at the id', () => {
    const resolver = createLayerNameResolver(layersOf(layer('k3J9xQ0aZt', 'Symbols')));

    expect(resolver.resolveKnownName('layer-underlay')).toBe('layer-underlay');
    expect(resolver.layers['layer-underlay']).toMatchObject({ name: 'Underlay', visible: true, locked: false });
  });

  it('leave other names and unknown ids alone', () => {
    const project = layersOf(layer('k3J9xQ0aZt', 'Symbols'));
    const resolver = createLayerNameResolver(project);

    expect(resolver.resolveKnownName('Custom')).toBeNull();
    expect(resolver.resolveKnownName('Zq81mVb4Xy')).toBeNull();
    expect(resolver.layers).toBe(project.layers);
    const custom = resolver.resolve('Custom');
    expect(custom).toHaveLength(10);
    expect(resolver.layers[custom].name).toBe('Custom');
  });
});

describe('a layer the user removed', () => {
  it('is recorded when it stands for one of the app\'s own names', () => {
    expect(withLayerRemoved(undefined, layer('layer-underlay', 'Underlay'))).toEqual({ underlay: 1 });
    // Renamed since: the id still says which name it was created for.
    expect(withLayerRemoved(undefined, layer('layer-underlay', 'Site plan'))).toEqual({ underlay: 1 });
    // A standard layer of a new project has a random id and is known by its name.
    expect(withLayerRemoved({ underlay: 1 }, layer('k3J9xQ0aZt', 'Wire Labels'))).toEqual({ underlay: 1, 'wire labels': 1 });
    expect(withLayerRemoved({ underlay: 1 }, layer('layer-underlay-2', 'Underlay'))).toEqual({ underlay: 2 });
    // Removing an older one again (an undo and redo, or a second peer) does not count twice.
    expect(withLayerRemoved({ underlay: 2 }, layer('layer-underlay', 'Underlay'))).toEqual({ underlay: 2 });
  });

  it('is not recorded for any other layer', () => {
    const counts = { underlay: 1 };

    expect(withLayerRemoved(counts, layer('k3J9xQ0aZt', 'Site Survey'))).toBe(counts);
    expect(withLayerRemoved(undefined, layer('layer-site-survey', 'Site Survey'))).toBeUndefined();
    expect(withLayerRemoved(undefined, layer('layer-underlay-1', 'Old plan'))).toBeUndefined();
    expect(withLayerRemoved(counts, undefined)).toBe(counts);
  });

  it('is not created again for the entities left on it, by id or by name', () => {
    const project = { ...layersOf(layer('k3J9xQ0aZt', 'Symbols')), removedLayers: { underlay: 1 } };
    const resolver = createLayerNameResolver(project);

    expect(resolver.resolveKnownName('layer-underlay')).toBeNull();
    expect(resolver.resolveKnownName('underlay')).toBeNull();
    expect(resolver.resolveKnownName('Annotation')).toBe('layer-annotation'); // not removed
    expect(resolver.layerOrder).toEqual(['k3J9xQ0aZt', 'layer-annotation']);
  });

  it('is followed by a new layer when something new asks for the name', () => {
    const project = { ...layersOf(layer('k3J9xQ0aZt', 'Symbols')), removedLayers: { underlay: 1 } };
    const one = createLayerNameResolver(project);
    const two = createLayerNameResolver(project);

    expect(one.resolve('underlay')).toBe('layer-underlay-2');
    expect(two.resolve('Underlay')).toBe('layer-underlay-2');
    expect(one.layers['layer-underlay-2']).toMatchObject({ name: 'Underlay', visible: true });
    // That one is live: if a shared room loses it, it is created again; the removed one is not.
    const lost = createLayerNameResolver(project);
    expect(lost.resolveKnownName('layer-underlay-2')).toBe('layer-underlay-2');
    expect(lost.resolveKnownName('layer-underlay')).toBeNull();
  });

  it('is still created again when nothing says it was removed, however the record is damaged', () => {
    for (const removedLayers of [undefined, {}, { underlay: 0 }, { underlay: -1 }, { underlay: 'yes' }, 'underlay', null]) {
      const project = { ...layersOf(layer('k3J9xQ0aZt', 'Symbols')), removedLayers } as Parameters<typeof createLayerNameResolver>[0];

      expect(createLayerNameResolver(project).resolveKnownName('layer-underlay')).toBe('layer-underlay');
    }
  });
});

describe('repairLayerNames', () => {
  it('returns the project itself when there is nothing to repair', () => {
    const project = { ...layersOf(layer('k3J9xQ0aZt', 'Symbols')), sheets: { 'sheet-1': sheetWith([line('a', 'k3J9xQ0aZt'), line('gone', 'Zq81mVb4Xy')]) } };

    expect(repairLayerNames(project)).toBe(project);
  });

  it('gives the same result for the same project, and shares what it did not change', () => {
    const make = () => ({
      ...layersOf(layer('k3J9xQ0aZt', 'Symbols')),
      sheets: {
        'sheet-1': sheetWith([line('note', 'Annotation'), line('wire', 'k3J9xQ0aZt')]),
        'sheet-2': { ...sheetWith([line('other', 'k3J9xQ0aZt')]), id: 'sheet-2' },
      },
    });
    const project = make();

    const repaired = repairLayerNames(project);

    expect(repaired).toEqual(repairLayerNames(make()));
    expect(repaired.sheets['sheet-1'].entities.note.layerId).toBe('layer-annotation');
    expect(repaired.sheets['sheet-1'].entities.wire).toBe(project.sheets['sheet-1'].entities.wire);
    expect(repaired.sheets['sheet-2']).toBe(project.sheets['sheet-2']);
    expect(project.sheets['sheet-1'].entities.note.layerId).toBe('Annotation');
    expect(repairLayerNames(repaired)).toBe(repaired);
  });

  it('leaves the entities of a removed layer alone, so the layer does not come back', () => {
    const project = {
      ...layersOf(layer('k3J9xQ0aZt', 'Symbols')),
      removedLayers: { underlay: 1 },
      sheets: { 'sheet-1': sheetWith([line('by-id', 'layer-underlay'), line('by-name', 'underlay'), line('wire', 'k3J9xQ0aZt')]) },
    };

    expect(repairLayerNames(project)).toBe(project);
  });

  it('does not throw on a project without a layer list', () => {
    const broken = { layers: {}, sheets: {} } as unknown as Parameters<typeof repairLayerNames>[0];

    expect(repairLayerNames(broken)).toBe(broken);
  });
});
