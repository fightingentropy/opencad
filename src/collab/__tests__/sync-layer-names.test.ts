// Layer names saved as layer ids, in a shared room (src/collab/sync.ts).
//
// Generated views and DXF/IFC imports used to be saved with a layer name
// ('Annotation', 'underlay') as their layerId, which no layer has, so they
// were never drawn. Project files and autosaves are repaired when they load
// (src/io/persist.ts). A room is read straight from the Yjs maps, so it needs
// the same repair there, and in a way that several peers can do at once.

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { bindStoreToYjs, getCollabMaps } from '../sync';
import { createLayerNameResolver, withLayerRemoved } from '../../lib/layer-names';
import type { Entity, EntityId, Layer, LayerId, LineEntity, Project, Sheet } from '../../types';

interface StoreShape {
  project: Project;
  setProject: (p: Project) => void;
}

type Peer = { doc: Y.Doc; store: StoreApi<StoreShape> };

const LAYER_ID = 'k3J9xQ0aZt';
const SHEET_ID = 'sheet-1';

const line = (id: EntityId, layerId: string, x = 0): LineEntity => ({
  id, kind: 'line', layerId, visible: true, locked: false, a: { x, y: 0 }, b: { x, y: 10 },
});

// A project with one ordinary layer and no 'Annotation' or 'Underlay' layer.
const makeProject = (entities: Entity[]): Project => {
  const sheet: Sheet = {
    id: SHEET_ID,
    name: 'Schematic',
    number: '001',
    kind: 'schematic',
    width: 432,
    height: 279,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    entityOrder: entities.map((e) => e.id),
  };
  return {
    id: 'proj-1',
    name: 'Test Project',
    created: 1000,
    modified: 1000,
    layers: {
      [LAYER_ID]: { id: LAYER_ID, name: 'Symbols', color: '#ffffff', visible: true, locked: false, lineWidth: 1 },
    },
    layerOrder: [LAYER_ID],
    sheets: { [sheet.id]: sheet },
    sheetOrder: [sheet.id],
    activeSheetId: sheet.id,
    activeLayerId: LAYER_ID,
    units: 'mm',
    standard: 'IEEE',
  };
};

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

const bindPeer = (doc: Y.Doc, project: Project, writeEnabled = true): Peer => {
  const store = createStore<StoreShape>((set) => ({
    project,
    setProject: (p) => set({ project: p }),
  }));
  const binding = bindStoreToYjs(store, getCollabMaps(doc), doc, { writeEnabled });
  disposers.push(binding.dispose);
  return { doc, store };
};

// The room as an older build left it: the doc holds exactly this project.
// Seeding writes the store's project as it is, with no repair.
const roomSavedWith = (entities: Entity[]): Y.Doc => {
  const doc = new Y.Doc();
  bindPeer(doc, makeProject(entities));
  return doc;
};

const join = (room: Y.Doc, writeEnabled = true): Peer & { writes: () => number } => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(room), 'remote');
  let writes = 0; // this peer's own writes to the room, not the updates it receives
  doc.on('update', (_update: Uint8Array, origin: unknown) => { if (origin !== 'remote') writes += 1; });
  // The joining peer's own project is replaced by the room's.
  return { ...bindPeer(doc, makeProject([]), writeEnabled), writes: () => writes };
};

const exchange = (a: Peer, b: Peer): void => {
  const fromA = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc));
  const fromB = Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc));
  Y.applyUpdate(b.doc, fromA, 'remote');
  Y.applyUpdate(a.doc, fromB, 'remote');
};

const projectOf = (peer: Peer): Project => peer.store.getState().project;
const entitiesOf = (peer: Peer): Entity[] => Object.values(projectOf(peer).sheets[SHEET_ID].entities);
const layersNamed = (peer: Peer, name: string): Layer[] =>
  projectOf(peer).layerOrder.map((id) => projectOf(peer).layers[id]).filter((layer) => layer?.name === name);
const undrawn = (peer: Peer): EntityId[] =>
  entitiesOf(peer).filter((e) => projectOf(peer).layers[e.layerId] === undefined).map((e) => e.id);

const edit = (peer: Peer, id: EntityId, x: number): void => {
  const project = projectOf(peer);
  const sheet = project.sheets[SHEET_ID];
  const moved = { ...sheet.entities[id], a: { x, y: 0 }, b: { x, y: 10 } } as Entity;
  peer.store.getState().setProject({
    ...project,
    modified: project.modified + 1,
    sheets: { ...project.sheets, [SHEET_ID]: { ...sheet, entities: { ...sheet.entities, [id]: moved } } },
  });
};

// The project changes the store's removeLayer and addEntitiesByLayerName make.
const removeLayer = (peer: Peer, id: LayerId): void => {
  const project = projectOf(peer);
  const layers = { ...project.layers };
  delete layers[id];
  const removedLayers = withLayerRemoved(project.removedLayers, project.layers[id]);
  peer.store.getState().setProject({
    ...project,
    layers,
    layerOrder: project.layerOrder.filter((l) => l !== id),
    ...(removedLayers ? { removedLayers } : {}),
    modified: project.modified + 1,
  });
};

const addByLayerName = (peer: Peer, e: Entity): void => {
  const project = projectOf(peer);
  const sheet = project.sheets[SHEET_ID];
  const resolver = createLayerNameResolver(project);
  const added = { ...e, layerId: resolver.resolve(e.layerId) };
  peer.store.getState().setProject({
    ...project,
    layers: resolver.layers,
    layerOrder: resolver.layerOrder,
    modified: project.modified + 1,
    sheets: {
      ...project.sheets,
      [SHEET_ID]: { ...sheet, entities: { ...sheet.entities, [e.id]: added }, entityOrder: [...sheet.entityOrder, e.id] },
    },
  });
};

const oldRoom = (): Y.Doc =>
  roomSavedWith([line('note', 'Annotation'), line('dxf-1', 'underlay'), line('dxf-2', 'underlay'), line('wire', LAYER_ID)]);

describe('layer names saved as layer ids, in a shared room', () => {
  it('draws them for a peer that joins, without writing to the room', () => {
    const peer = join(oldRoom());

    expect(undrawn(peer)).toEqual([]);
    const { entities } = projectOf(peer).sheets[SHEET_ID];
    expect(layersNamed(peer, 'Annotation')).toHaveLength(1);
    expect(layersNamed(peer, 'Underlay')).toHaveLength(1);
    expect(entities.note.layerId).toBe(layersNamed(peer, 'Annotation')[0].id);
    expect(entities['dxf-1'].layerId).toBe(layersNamed(peer, 'Underlay')[0].id);
    expect(entities['dxf-2'].layerId).toBe(entities['dxf-1'].layerId);
    expect(entities.wire.layerId).toBe(LAYER_ID);
    // Joining is not an edit: the repair is the reader's, and the room is as it was.
    expect(peer.writes()).toBe(0);
  });

  it('draws them for a viewer, who cannot write', () => {
    const viewer = join(oldRoom(), false);

    expect(undrawn(viewer)).toEqual([]);
    edit(viewer, 'dxf-1', 5);
    expect(viewer.writes()).toBe(0);
  });

  it('gives two peers that repair the same room at once the same layers', () => {
    const room = oldRoom();
    const a = join(room);
    const b = join(room);

    // Each edits a different imported entity before hearing from the other. Both
    // writes carry the layer the repair created; with ids of their own, one
    // peer's layer would lose and its entity would point at nothing.
    edit(a, 'dxf-1', 11);
    edit(b, 'dxf-2', 22);
    exchange(a, b);

    for (const peer of [a, b]) {
      expect(undrawn(peer)).toEqual([]);
      expect(layersNamed(peer, 'Underlay')).toHaveLength(1);
      expect(layersNamed(peer, 'Annotation')).toHaveLength(1);
    }
    expect(projectOf(a).layers).toEqual(projectOf(b).layers);
    expect(projectOf(a).layerOrder).toEqual(projectOf(b).layerOrder);
    expect(projectOf(a).sheets[SHEET_ID].entities).toEqual(projectOf(b).sheets[SHEET_ID].entities);
    expect((projectOf(a).sheets[SHEET_ID].entities['dxf-1'] as LineEntity).a.x).toBe(11);
    expect((projectOf(a).sheets[SHEET_ID].entities['dxf-2'] as LineEntity).a.x).toBe(22);
  });

  it('writes the repair for an entity when that entity is edited, and peers on it agree', () => {
    const room = oldRoom();
    const a = join(room);
    const b = join(room);

    edit(a, 'note', 7);
    expect(a.writes()).toBeGreaterThan(0);
    exchange(a, b);

    const stored = JSON.parse(String(getCollabMaps(b.doc).entities.get(`${SHEET_ID}\u001fnote`))) as Entity;
    expect(stored.layerId).toBe(layersNamed(a, 'Annotation')[0].id);
    expect(projectOf(b).sheets[SHEET_ID].entities.note).toEqual(projectOf(a).sheets[SHEET_ID].entities.note);
    expect(undrawn(b)).toEqual([]);
    expect(b.writes()).toBe(0);
  });

  it('restores a layer the repair created when a peer that never had it overwrites the layer list', () => {
    const room = oldRoom();
    const a = join(room);
    edit(a, 'dxf-1', 11); // writes the entity on the new Underlay layer, and the layer

    // An older build is in the room too. It has not seen that write, and its own
    // write of the project fields (here a rename) lands last: the layer list in
    // the room no longer has the Underlay layer.
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(room), 'remote');
    const meta = getCollabMaps(old).meta;
    const fields = JSON.parse(String(meta.get('project'))) as Project;
    old.clientID = a.doc.clientID + 1; // the higher client id wins a concurrent write
    meta.set('project', JSON.stringify({ ...fields, name: 'Renamed by an older build' }));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(old), 'remote');

    expect(projectOf(a).name).toBe('Renamed by an older build');
    expect(undrawn(a)).toEqual([]);
    expect(layersNamed(a, 'Underlay')).toHaveLength(1);
    expect((projectOf(a).sheets[SHEET_ID].entities['dxf-1'] as LineEntity).a.x).toBe(11);
  });

  it('keeps a layer one peer removed removed, for every peer and on every later read', () => {
    const room = oldRoom();
    const a = join(room);
    const b = join(room);
    edit(a, 'dxf-1', 11); // dxf-1 is now in the room by layer id; dxf-2 is still there by name
    exchange(a, b);

    removeLayer(a, layersNamed(a, 'Underlay')[0].id);
    exchange(a, b);
    // More reads of the room, on both peers, with the removed layer's entities still in it.
    edit(b, 'wire', 5);
    exchange(a, b);
    edit(a, 'wire', 6);
    exchange(a, b);

    for (const peer of [a, b]) {
      expect(layersNamed(peer, 'Underlay')).toEqual([]);
      expect(undrawn(peer).sort()).toEqual(['dxf-1', 'dxf-2']);
      expect(layersNamed(peer, 'Annotation')).toHaveLength(1); // other repairs are unaffected
    }
    expect(projectOf(a).layerOrder).toEqual(projectOf(b).layerOrder);
    // A peer that joins later reads the same thing.
    const late = join(a.doc);
    expect(layersNamed(late, 'Underlay')).toEqual([]);
    expect(undrawn(late).sort()).toEqual(['dxf-1', 'dxf-2']);
  });

  it('puts imports after a removal on a new layer that peers agree on, without the removed entities', () => {
    const room = oldRoom();
    const a = join(room);
    const b = join(room);
    edit(a, 'dxf-1', 11);
    exchange(a, b);
    removeLayer(a, layersNamed(a, 'Underlay')[0].id);
    exchange(a, b);

    // Both import at once, before hearing from each other.
    addByLayerName(a, line('new-a', 'underlay', 1));
    addByLayerName(b, line('new-b', 'underlay', 2));
    exchange(a, b);

    for (const peer of [a, b]) {
      expect(layersNamed(peer, 'Underlay')).toHaveLength(1);
      expect(undrawn(peer).sort()).toEqual(['dxf-1', 'dxf-2']);
      const { entities } = projectOf(peer).sheets[SHEET_ID];
      expect(entities['new-a'].layerId).toBe(layersNamed(peer, 'Underlay')[0].id);
      expect(entities['new-b'].layerId).toBe(entities['new-a'].layerId);
    }
    expect(projectOf(a).layers).toEqual(projectOf(b).layers);
  });
});
