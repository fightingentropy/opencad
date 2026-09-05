import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import type { LineEntity, Project } from '../../types';
import {
  INSTALLATION_LIMITS,
  installationActivities,
  installationRecordDefects,
  installationStatus,
} from '../../models/installation';
import { exportProjectJSON, importProjectJSON } from '../../io/project';
import { projectStructureDefects } from '../../io/project-validation';
import { bindStoreToYjs, getCollabMaps } from '../../collab/sync';
import { setCollaborationReadOnly } from '../collaboration-guard';
import { createEmptyProject, useStore } from '../store';
import {
  addInstallationComment,
  setInstallationStatus,
  withInstallationComment,
  withInstallationStatus,
} from '../installation-actions';

const makeProject = (): Project => {
  const p = createEmptyProject();
  const line: LineEntity = {
    id: 'part', kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 },
    layerId: p.activeLayerId, visible: true, locked: false,
  };
  const first = { ...p.sheets[p.activeSheetId], id: 'first', entities: { part: line }, entityOrder: ['part'] };
  const second = { ...first, id: 'second', name: 'Upper floor', entities: { part: { ...line } } };
  return { ...p, sheets: { first, second }, sheetOrder: ['first', 'second'], activeSheetId: 'first' };
};

beforeEach(() => {
  setCollaborationReadOnly(false);
  useStore.getState().setProject(makeProject());
});

afterEach(() => {
  vi.restoreAllMocks();
  setCollaborationReadOnly(false);
});

describe('installation progress and comments', () => {
  it('starts older drawings as planned without fabricating completed work', () => {
    const entity = { ...makeProject().sheets.first.entities.part, phase: 'as-built' as const };
    expect(installationStatus(entity)).toBe('planned');
    expect(installationActivities(makeProject())).toEqual([]);
  });

  it('records transitions, completion dates and reopening without losing earlier completion evidence', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(setInstallationStatus('first', 'part', 'in-progress', '  Site engineer  ')).toBe(true);
    now.mockReturnValue(2000);
    expect(setInstallationStatus('first', 'part', 'completed', 'Site engineer')).toBe(true);
    let record = useStore.getState().project.sheets.first.entities.part.installation!;
    expect(record.completedAt).toBe(2000);
    expect(record.activities).toMatchObject([
      { kind: 'status', previousStatus: 'planned', status: 'in-progress', createdAt: 1000, author: 'Site engineer' },
      { kind: 'status', previousStatus: 'in-progress', status: 'completed', createdAt: 2000 },
    ]);
    now.mockReturnValue(3000);
    expect(setInstallationStatus('first', 'part', 'in-progress')).toBe(true);
    record = useStore.getState().project.sheets.first.entities.part.installation!;
    expect(record.status).toBe('in-progress');
    expect(record.completedAt).toBeUndefined();
    expect(record.activities).toHaveLength(3);
    expect(record.activities[1]).toMatchObject({ status: 'completed', createdAt: 2000 });
    expect(installationRecordDefects(record)).toEqual([]);
  });

  it('preserves completion and comments when adding a trimmed note', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    setInstallationStatus('first', 'part', 'completed');
    expect(addInstallationComment('first', 'part', '  Glands checked.\nReady for inspection.  ', 'Installer')).toBe(true);
    const record = useStore.getState().project.sheets.first.entities.part.installation!;
    expect(record).toMatchObject({ status: 'completed', completedAt: 1000, updatedAt: 1000 });
    expect(record.activities[1]).toMatchObject({ kind: 'comment', text: 'Glands checked.\nReady for inspection.', author: 'Installer' });
    // Both entries share a clock tick; newest appended note must display first.
    expect(installationActivities(useStore.getState().project)[0].kind).toBe('comment');
  });

  it('allows a note on a planned part before work starts', () => {
    expect(addInstallationComment('first', 'part', 'Awaiting cable delivery')).toBe(true);
    const record = useStore.getState().project.sheets.first.entities.part.installation!;
    expect(record.status).toBe('planned');
    expect(record.activities).toHaveLength(1);
    expect(record.activities[0].kind).toBe('comment');
  });

  it('changes the requested sheet even when another sheet has the same entity id', () => {
    const before = useStore.getState().project;
    expect(setInstallationStatus('second', 'part', 'completed')).toBe(true);
    const after = useStore.getState().project;
    expect(after.activeSheetId).toBe('first');
    expect(after.sheets.first).toBe(before.sheets.first);
    expect(installationStatus(after.sheets.first.entities.part)).toBe('planned');
    expect(installationStatus(after.sheets.second.entities.part)).toBe('completed');
    expect(installationActivities(after)[0]).toMatchObject({ sheetId: 'second', entityId: 'part', sheetName: 'Upper floor' });
  });

  it('undoes and redoes status and note edits as separate atomic history entries', () => {
    const before = useStore.getState().project;
    setInstallationStatus('second', 'part', 'completed');
    const completed = useStore.getState().project;
    addInstallationComment('second', 'part', 'Inspection booked');
    const commented = useStore.getState().project;
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(completed);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(commented);
  });

  it('rejects viewer writes before changing the drawing or undo history', () => {
    const before = useStore.getState();
    setCollaborationReadOnly(true);
    expect(setInstallationStatus('second', 'part', 'completed')).toBe(false);
    expect(addInstallationComment('first', 'part', 'Forbidden')).toBe(false);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().past).toBe(before.past);
    expect(useStore.getState().editor.statusMessage).toMatch(/viewer/i);
  });

  it('ignores duplicate statuses, missing entities and invalid or oversized input without undo entries', () => {
    const before = useStore.getState();
    expect(setInstallationStatus('first', 'part', 'planned')).toBe(false);
    expect(setInstallationStatus('first', 'missing', 'completed')).toBe(false);
    expect(setInstallationStatus('missing', 'part', 'completed')).toBe(false);
    expect(setInstallationStatus('first', 'part', 'invalid' as 'completed')).toBe(false);
    expect(addInstallationComment('first', 'part', ' \n ')).toBe(false);
    expect(addInstallationComment('first', 'part', 'x'.repeat(INSTALLATION_LIMITS.commentLength + 1))).toBe(false);
    expect(addInstallationComment('first', 'part', 'Note', 'x'.repeat(INSTALLATION_LIMITS.authorLength + 1))).toBe(false);
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().past).toBe(before.past);
  });

  it('does not silently truncate an existing activity history when its bound is reached', () => {
    const project = makeProject();
    project.sheets.first.entities.part.installation = {
      status: 'planned', updatedAt: 1000,
      activities: Array.from({ length: INSTALLATION_LIMITS.activityCount }, (_, i) => ({
        id: `activity-${i}`, kind: 'comment', text: 'Site note', createdAt: 1000,
      })),
    };
    expect(withInstallationComment(project, 'first', 'part', 'Another')).toBe(project);
    expect(withInstallationStatus(project, 'first', 'part', 'completed')).toBe(project);
    expect(project.sheets.first.entities.part.installation.activities).toHaveLength(INSTALLATION_LIMITS.activityCount);
  });

  it('aggregates a project timeline across sheets newest first', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    setInstallationStatus('second', 'part', 'completed');
    now.mockReturnValue(2000);
    addInstallationComment('first', 'part', 'First floor update');
    const rows = installationActivities(useStore.getState().project);
    expect(rows.map((row) => [row.sheetId, row.kind])).toEqual([['first', 'comment'], ['second', 'status']]);
    expect(rows[0].entityLabel).toBeTruthy();
  });
});

describe('installation persistence and validation', () => {
  it('round-trips all progress and multiline notes through project export/import', () => {
    let project = withInstallationStatus(makeProject(), 'second', 'part', 'completed', 'Inspector');
    project = withInstallationComment(project, 'second', 'part', 'Terminations checked.\nPhotographs filed.', 'Installer');
    const imported = importProjectJSON(exportProjectJSON(project));
    expect(imported.sheets.second.entities.part.installation).toEqual(project.sheets.second.entities.part.installation);
    expect(installationActivities(imported)).toEqual(installationActivities(project));
    expect(projectStructureDefects(imported)).toEqual([]);
  });

  it.each([
    null,
    { status: 'imaginary', updatedAt: 0, activities: [] },
    { status: 'planned', updatedAt: 'yesterday', activities: [] },
    { status: 'planned', updatedAt: 0, activities: {} },
    { status: 'planned', updatedAt: 0, activities: [{ id: 'x', kind: 'comment', createdAt: 0, text: {} }] },
    { status: 'completed', updatedAt: 0, completedAt: -1, activities: [] },
  ])('rejects malformed imported installation metadata without discarding it (%j)', (installation) => {
    const file = JSON.parse(exportProjectJSON(makeProject()));
    file.project.sheets.first.entities.part.installation = installation;
    expect(() => importProjectJSON(JSON.stringify(file))).toThrow(/installation|completion/);
  });

  it('rejects imported histories with duplicate ids, oversized comments and invalid event dates', () => {
    const activity = { id: 'note-1', kind: 'comment', createdAt: 1000, text: 'Recorded note' };
    const invalidHistories = [
      [activity, activity],
      [{ ...activity, text: 'x'.repeat(INSTALLATION_LIMITS.commentLength + 1) }],
      [{ ...activity, createdAt: 8.64e15 + 1 }],
      [{ ...activity, author: { name: 'Unexpected object' } }],
      [{ id: 'status-1', kind: 'status', createdAt: 1000, previousStatus: 'planned', status: 'energized' }],
    ];
    for (const activities of invalidHistories) {
      const file = JSON.parse(exportProjectJSON(makeProject()));
      file.project.sheets.first.entities.part.installation = { status: 'planned', updatedAt: 1000, activities };
      expect(() => importProjectJSON(JSON.stringify(file))).toThrow(/installation/);
    }
  });

  it('syncs complete installation records through the existing per-entity collaboration maps', () => {
    const initial = makeProject();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const makeStore = () => createStore<{ project: Project; setProject: (project: Project) => void }>((set) => ({
      project: initial, setProject: (project) => set({ project }),
    }));
    const storeA = makeStore();
    const storeB = makeStore();
    const a = bindStoreToYjs(storeA, getCollabMaps(docA), docA);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = bindStoreToYjs(storeB, getCollabMaps(docB), docB);
    try {
      let updated = withInstallationStatus(initial, 'second', 'part', 'completed');
      updated = withInstallationComment(updated, 'second', 'part', 'Board installed');
      storeA.getState().setProject(updated);
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      expect(storeB.getState().project.sheets.second.entities.part.installation)
        .toEqual(updated.sheets.second.entities.part.installation);
      expect(installationActivities(storeB.getState().project)).toHaveLength(2);
    } finally {
      a.dispose();
      b.dispose();
      docA.destroy();
      docB.destroy();
    }
  });
});
