// Local undo history while peers edit (src/collab/sync.ts, src/state/store.ts).

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import { bindStoreToYjs, getCollabMaps } from '../sync';
import { createEmptyProject, useStore } from '../../state/store';
import type { LineEntity, Project } from '../../types';

const disposers: (() => void)[] = [];
afterEach(() => { while (disposers.length) disposers.pop()?.(); });

const line = (project: Project, id: string, x: number): LineEntity => ({
  id, kind: 'line', layerId: project.activeLayerId, visible: true, locked: false, a: { x, y: 0 }, b: { x, y: 10 },
});
const entities = (project: Project) => project.sheets[project.activeSheetId].entities;

const setup = () => {
  const base = createEmptyProject();
  useStore.getState().setProject(base);
  const docA = new Y.Doc(), docB = new Y.Doc();
  disposers.push(bindStoreToYjs(useStore, getCollabMaps(docA), docA).dispose);
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'remote');
  const storeB = createStore<{ project: Project; setProject: (p: Project) => void }>(set => ({
    project: structuredClone(base), setProject: p => set({ project: p }),
  }));
  disposers.push(bindStoreToYjs(storeB, getCollabMaps(docB), docB).dispose);
  const sync = () => {
    const toB = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB));
    const toA = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));
    Y.applyUpdate(docB, toB, 'remote'); Y.applyUpdate(docA, toA, 'remote');
  };
  const peerAdds = (id: string) => {
    const p = storeB.getState().project;
    const sheet = p.sheets[p.activeSheetId];
    storeB.getState().setProject({ ...p, sheets: { ...p.sheets, [sheet.id]: { ...sheet,
      entities: { ...sheet.entities, [id]: line(p, id, 77) }, entityOrder: [...sheet.entityOrder, id] } } });
  };
  const peerAddsViaStore = (id: string) => {
    // Like a real peer: the store action also bumps project.modified.
    const p = storeB.getState().project;
    storeB.getState().setProject({ ...p, modified: p.modified + 1000 });
    peerAdds(id);
    const q = storeB.getState().project;
    storeB.getState().setProject({ ...q, modified: q.modified + 1000 });
  };
  return { sync, peerAdds, peerAddsViaStore };
};

describe('local undo while collaborating', () => {
  it('keeps the undo stack when a peer adds an entity, and undo leaves the peer entity alone', () => {
    const { sync, peerAdds } = setup();
    useStore.getState().addEntity(line(useStore.getState().project, 'mine', 5));
    expect(useStore.getState().past.length).toBe(1);
    peerAdds('theirs');
    sync();
    expect(Object.keys(entities(useStore.getState().project))).toEqual(expect.arrayContaining(['mine', 'theirs']));
    expect(useStore.getState().past.length).toBe(1);
    useStore.getState().undo();
    const after = entities(useStore.getState().project);
    expect(after.mine).toBeUndefined();
    expect(after.theirs).toBeDefined();
  });

  it('keeps redo available after a peer edit', () => {
    const { sync, peerAdds } = setup();
    useStore.getState().addEntity(line(useStore.getState().project, 'mine', 5));
    useStore.getState().undo();
    peerAdds('theirs');
    sync();
    expect(useStore.getState().future.length).toBe(1);
    useStore.getState().redo();
    const after = entities(useStore.getState().project);
    expect(after.mine).toBeDefined();
    expect(after.theirs).toBeDefined();
  });

  it('keeps the undo stack when the peer edit also bumps project.modified', () => {
    const { sync, peerAddsViaStore } = setup();
    useStore.getState().addEntity(line(useStore.getState().project, 'mine', 5));
    peerAddsViaStore('theirs');
    sync();
    expect(entities(useStore.getState().project).theirs).toBeDefined();
    expect(useStore.getState().past.length).toBe(1);
    useStore.getState().undo();
    expect(entities(useStore.getState().project).theirs).toBeDefined();
  });
});
