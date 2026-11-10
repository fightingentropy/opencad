// Removing a layer the app created for one of its own layer names.
//
// Such a layer has an id made from its name ('layer-underlay'), and the repair
// for layer names saved as layer ids accepts that id as a reference to the
// layer. Removing a layer leaves its entities where they are, still pointing
// at it, so without a record of the removal the repair would take them for a
// layer that was lost and create it again on the next load or room read.

import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import { migrateProject } from '../../io/persist';
import { exportProjectJSON, importProjectJSON } from '../../io/project';
import type { Entity, Layer, Project } from '../../types';

beforeEach(() => {
  useStore.setState({ project: createEmptyProject(), past: [], future: [] });
});

const line = (id: string, layerId: string): Entity => ({
  id, kind: 'line', layerId, visible: true, locked: false, a: { x: 0, y: 0 }, b: { x: 1, y: 1 },
});

const current = (): Project => useStore.getState().project;
const layersNamed = (project: Project, name: string): Layer[] =>
  project.layerOrder.map((id) => project.layers[id]).filter((layer) => layer.name === name);
const entity = (project: Project, id: string): Entity => project.sheets[project.activeSheetId].entities[id];
const drawn = (project: Project, id: string): boolean => project.layers[entity(project, id).layerId] !== undefined;

describe('removing a layer the app created by name', () => {
  it('keeps it removed when the project is loaded again', () => {
    useStore.getState().addEntitiesByLayerName([line('dxf', 'underlay')]);
    const underlay = layersNamed(current(), 'Underlay')[0];
    expect(drawn(current(), 'dxf')).toBe(true);

    useStore.getState().removeLayer(underlay.id);

    for (const loaded of [migrateProject(current()), importProjectJSON(exportProjectJSON(current()))]) {
      expect(layersNamed(loaded, 'Underlay')).toEqual([]);
      expect(loaded.layerOrder).toEqual(current().layerOrder);
      expect(drawn(loaded, 'dxf')).toBe(false);
    }
  });

  it('puts later imports on a new layer, without bringing the removed one\'s entities back', () => {
    useStore.getState().addEntitiesByLayerName([line('first', 'underlay')]);
    const removed = layersNamed(current(), 'Underlay')[0];
    useStore.getState().removeLayer(removed.id);

    useStore.getState().addEntitiesByLayerName([line('second', 'underlay')]);

    const [underlay, ...others] = layersNamed(current(), 'Underlay');
    expect(others).toEqual([]);
    expect(underlay.id).not.toBe(removed.id);
    expect(entity(current(), 'second').layerId).toBe(underlay.id);
    expect(drawn(current(), 'first')).toBe(false);
    const loaded = migrateProject(current());
    expect(loaded.layerOrder).toEqual(current().layerOrder);
    expect(drawn(loaded, 'first')).toBe(false);
    expect(drawn(loaded, 'second')).toBe(true);
  });

  it('keeps a removed standard layer removed for entities still saved with its name', () => {
    // A file from before layer names were repaired, opened and then edited: the
    // user removes the Annotation layer the old entity was put on.
    useStore.setState({ project: migrateProject({
      ...current(),
      sheets: {
        ...current().sheets,
        [current().activeSheetId]: {
          ...current().sheets[current().activeSheetId],
          entities: { note: line('note', 'Annotation') },
          entityOrder: ['note'],
        },
      },
    }) });
    const annotation = layersNamed(current(), 'Annotation')[0];
    expect(entity(current(), 'note').layerId).toBe(annotation.id);

    useStore.getState().removeLayer(annotation.id);
    // The same entity as an older build in a room would still hold it: by name.
    const withNameRef: Project = {
      ...current(),
      sheets: {
        ...current().sheets,
        [current().activeSheetId]: {
          ...current().sheets[current().activeSheetId],
          entities: { note: line('note', 'Annotation') },
        },
      },
    };

    const loaded = migrateProject(withNameRef);
    expect(layersNamed(loaded, 'Annotation')).toEqual([]);
    expect(drawn(loaded, 'note')).toBe(false);
  });

  it('comes back, with its entities, when the removal is undone', () => {
    useStore.getState().addEntitiesByLayerName([line('dxf', 'underlay')]);
    const before = current();
    useStore.getState().removeLayer(layersNamed(before, 'Underlay')[0].id);

    useStore.getState().undo();

    expect(current()).toBe(before);
    expect(migrateProject(current()).layers).toBe(before.layers);
    expect(drawn(current(), 'dxf')).toBe(true);
  });
});
