import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  clearIndexedDbProjects,
  indexedDbJournalLength,
  loadIndexedDbProjectSnapshots,
  saveIndexedDbProjectSnapshot,
} from '../indexeddb-project-store';

describe('IndexedDB project snapshots', () => {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', indexedDB);
    await clearIndexedDbProjects();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('atomically rotates current to backup and records a bounded journal entry', async () => {
    await saveIndexedDbProjectSnapshot('{"id":"one"}', 'one', 1);
    await saveIndexedDbProjectSnapshot('{"id":"two"}', 'two', 2);
    const snapshots = await loadIndexedDbProjectSnapshots();
    expect(snapshots.current).toMatchObject({ raw: '{"id":"two"}', projectId: 'two' });
    expect(snapshots.backup).toMatchObject({ raw: '{"id":"one"}', projectId: 'one' });
    expect(await indexedDbJournalLength()).toBe(2);
  });

  it('clears snapshots and journal together', async () => {
    await saveIndexedDbProjectSnapshot('{"id":"one"}', 'one', 1);
    await clearIndexedDbProjects();
    expect(await loadIndexedDbProjectSnapshots()).toEqual({ current: null, backup: null });
    expect(await indexedDbJournalLength()).toBe(0);
  });
});
