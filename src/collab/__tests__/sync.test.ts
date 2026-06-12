// Entity-level merge semantics for the v2 collab sync (src/collab/sync.ts).
//
// Two Y.Docs stand in for two peers. Each doc gets its own minimal
// Zustand store bound via bindStoreToYjs; "network partition" is
// simulated by editing both stores while no updates flow, then
// exchanging state via Y.applyUpdate in both directions (computed
// against pre-exchange state vectors, like a real reconnect).

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { bindStoreToYjs, getCollabMaps } from '../sync';
import type { Entity, EntityId, LineEntity, Project, Sheet, SheetId } from '../../types';

interface StoreShape {
  project: Project;
  setProject: (p: Project) => void;
}

type Peer = {
  doc: Y.Doc;
  store: StoreApi<StoreShape>;
  dispose: () => void;
};

const LAYER_ID = 'layer-default';
const SHEET_ID = 'sheet-1';

const line = (id: EntityId, x: number, color?: string): LineEntity => ({
  id,
  kind: 'line',
  layerId: LAYER_ID,
  visible: true,
  locked: false,
  a: { x, y: 0 },
  b: { x, y: 10 },
  ...(color ? { color } : {}),
});

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
      [LAYER_ID]: {
        id: LAYER_ID,
        name: 'Default',
        color: '#ffffff',
        visible: true,
        locked: false,
        lineWidth: 1,
      },
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

// Immutable store-style edits, mirroring what the real store does.
const withEntity = (p: Project, sheetId: SheetId, e: Entity): Project => {
  const sheet = p.sheets[sheetId];
  return {
    ...p,
    modified: p.modified + 1,
    sheets: {
      ...p.sheets,
      [sheetId]: {
        ...sheet,
        entities: { ...sheet.entities, [e.id]: e },
        entityOrder: sheet.entityOrder.includes(e.id)
          ? sheet.entityOrder
          : [...sheet.entityOrder, e.id],
      },
    },
  };
};

const withoutEntity = (p: Project, sheetId: SheetId, id: EntityId): Project => {
  const sheet = p.sheets[sheetId];
  const entities = { ...sheet.entities };
  delete entities[id];
  return {
    ...p,
    modified: p.modified + 1,
    sheets: {
      ...p.sheets,
      [sheetId]: {
        ...sheet,
        entities,
        entityOrder: sheet.entityOrder.filter((x) => x !== id),
      },
    },
  };
};

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

const bindPeer = (doc: Y.Doc, project: Project): Peer => {
  const store = createStore<StoreShape>((set) => ({
    project,
    setProject: (p) => set({ project: p }),
  }));
  const binding = bindStoreToYjs(store, getCollabMaps(doc), doc);
  disposers.push(binding.dispose);
  return { doc, store, dispose: binding.dispose };
};

/** Two peers sharing a common base project, then partitioned. */
const makePeers = (base: Project): { a: Peer; b: Peer } => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const a = bindPeer(docA, base);
  // Peer B joins a session in progress: B's doc gets A's seed first,
  // so the binding adopts the shared state instead of re-seeding.
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'remote');
  const b = bindPeer(docB, structuredClone(base));
  return { a, b };
};

/** Bidirectional update exchange, like both peers reconnecting. */
const exchange = (a: Peer, b: Peer): void => {
  // Encode both deltas against pre-exchange state vectors first, so
  // neither direction smuggles in the other's just-applied changes.
  const fromA = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc));
  const fromB = Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc));
  Y.applyUpdate(b.doc, fromA, 'remote');
  Y.applyUpdate(a.doc, fromB, 'remote');
};

const sheetOf = (peer: Peer): Sheet => peer.store.getState().project.sheets[SHEET_ID];

describe('entity-level collab merging', () => {
  it('keeps concurrent edits to two different entities (both survive)', () => {
    const e1 = line('e1', 0);
    const e2 = line('e2', 100);
    const { a, b } = makePeers(makeProject([e1, e2]));

    // Partitioned: A moves e1, B recolours e2.
    const e1Moved = line('e1', 42);
    const e2Recoloured = line('e2', 100, '#ff0000');
    a.store.getState().setProject(withEntity(a.store.getState().project, SHEET_ID, e1Moved));
    b.store.getState().setProject(withEntity(b.store.getState().project, SHEET_ID, e2Recoloured));

    exchange(a, b);

    for (const peer of [a, b]) {
      const sheet = sheetOf(peer);
      expect(sheet.entities['e1']).toEqual(e1Moved);
      expect(sheet.entities['e2']).toEqual(e2Recoloured);
    }
    expect(sheetOf(a)).toEqual(sheetOf(b));
  });

  it('resolves same-entity concurrent edits atomically to one writer (no field tearing)', () => {
    const e1 = line('e1', 0);
    const { a, b } = makePeers(makeProject([e1]));

    // Both peers rewrite e1, touching the SAME two fields with
    // different values. A correct merge yields exactly one peer's
    // version in full — never A's position with B's colour or vice versa.
    const versionA: LineEntity = { ...line('e1', 11, '#aaaa11'), b: { x: 11, y: 111 } };
    const versionB: LineEntity = { ...line('e1', 99, '#bbbb99'), b: { x: 99, y: 999 } };
    a.store.getState().setProject(withEntity(a.store.getState().project, SHEET_ID, versionA));
    b.store.getState().setProject(withEntity(b.store.getState().project, SHEET_ID, versionB));

    exchange(a, b);

    const resultA = sheetOf(a).entities['e1'];
    const resultB = sheetOf(b).entities['e1'];
    // Convergence: both peers see the identical entity...
    expect(resultA).toEqual(resultB);
    // ...and it is byte-for-byte one writer's full version, not a blend.
    const winner = JSON.stringify(resultA);
    expect([JSON.stringify(versionA), JSON.stringify(versionB)]).toContain(winner);
  });

  it('merges an entity add on one peer with a different-entity delete on the other', () => {
    const e1 = line('e1', 0);
    const { a, b } = makePeers(makeProject([e1]));

    // Partitioned: A adds e2 while B deletes e1.
    const e2 = line('e2', 50);
    a.store.getState().setProject(withEntity(a.store.getState().project, SHEET_ID, e2));
    b.store.getState().setProject(withoutEntity(b.store.getState().project, SHEET_ID, 'e1'));

    exchange(a, b);

    for (const peer of [a, b]) {
      const sheet = sheetOf(peer);
      expect(sheet.entities['e2']).toEqual(e2); // the add survived
      expect(sheet.entities['e1']).toBeUndefined(); // the delete survived
      expect(sheet.entityOrder).toEqual(['e2']); // order reconciled, no ghosts
    }
    expect(sheetOf(a)).toEqual(sheetOf(b));
  });
});
