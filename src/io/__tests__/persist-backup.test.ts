import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Project, Sheet } from '../../types';
import { loadStoredProject, saveStoredProject } from '../persist';
import { useSaveStatus } from '../../state/save-status';
import { useNotifications } from '../../state/notifications';

const STORAGE_KEY = 'opencad.project.v8';
const BACKUP_KEY = 'opencad.project.v8.bak';

const buildProject = (): Project => {
  const sheet: Sheet = {
    id: 'sheet-1',
    name: 'Test',
    number: 'F-001',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities: {},
    entityOrder: [],
  };
  return {
    id: 'p1',
    name: 'Backup Test',
    created: 0,
    modified: 0,
    layers: {},
    layerOrder: [],
    sheets: { [sheet.id]: sheet },
    sheetOrder: [sheet.id],
    activeSheetId: sheet.id,
    activeLayerId: 'L',
    units: 'mm',
    standard: 'IEC',
  };
};

// In-memory localStorage stand-in with the backing map exposed so tests can
// inspect exactly which keys were written.
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  };
};

describe('autosave guard and backup key', () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    useSaveStatus.getState().reset();
    useNotifications.getState().clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it('refuses to overwrite the autosave with a structurally invalid project', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    expect(saveStoredProject(buildProject()).ok).toBe(true);
    const goodBlob = map.get(STORAGE_KEY);
    expect(goodBlob).toBeDefined();

    const broken = { ...buildProject(), sheets: undefined } as unknown as Project;
    const result = saveStoredProject(broken);

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    // The last good blob is untouched and additionally copied to the backup key.
    expect(map.get(STORAGE_KEY)).toBe(goodBlob);
    expect(map.get(BACKUP_KEY)).toBe(goodBlob);

    const state = useSaveStatus.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('project damaged');

    const toasts = useNotifications.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].timeoutMs).toBeNull();
    expect(toasts[0].message).toContain('Autosave suspended');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('writes nothing when an invalid project is saved with no prior autosave', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    const broken = { ...buildProject(), sheets: undefined } as unknown as Project;
    const result = saveStoredProject(broken);

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(map.has(STORAGE_KEY)).toBe(false);
    expect(map.has(BACKUP_KEY)).toBe(false);
  });

  it('recovers and clears the failure toast on the next valid save', () => {
    const { storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    const broken = { ...buildProject(), sheets: undefined } as unknown as Project;
    saveStoredProject(broken);
    expect(useNotifications.getState().toasts).toHaveLength(1);

    const result = saveStoredProject(buildProject());

    expect(result.ok).toBe(true);
    expect(useSaveStatus.getState().status).toBe('saved');
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('falls back to the backup key when the main blob fails validation', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    // Parseable but structurally broken main blob (the pre-fix failure mode),
    // with a good copy preserved under the backup key.
    map.set(STORAGE_KEY, JSON.stringify({ id: 'broken' }));
    map.set(BACKUP_KEY, JSON.stringify(buildProject()));

    const loaded = loadStoredProject();

    expect(loaded?.id).toBe('p1');
    // The migration shim runs on the backup path too.
    expect(loaded?.cableSchedule).toBeDefined();
    const toasts = useNotifications.getState().toasts;
    expect(toasts.some((t) => t.kind === 'warning' && t.message.includes('backup'))).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ignores the backup key while the main blob is healthy', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    map.set(STORAGE_KEY, JSON.stringify(buildProject()));
    map.set(BACKUP_KEY, JSON.stringify({ ...buildProject(), id: 'older-backup' }));

    const loaded = loadStoredProject();

    expect(loaded?.id).toBe('p1');
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('returns null when both the main and backup blobs are damaged', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    map.set(STORAGE_KEY, JSON.stringify({ id: 'broken' }));
    map.set(BACKUP_KEY, 'not even json');

    expect(loadStoredProject()).toBeNull();
  });

  it('never falls back to a blank canvas silently — errors when nothing is restorable', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    map.set(STORAGE_KEY, 'truncated{');

    expect(loadStoredProject()).toBeNull();
    const toasts = useNotifications.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].message).toContain('could not be restored');
    // Errors are sticky so the explanation cannot scroll away unseen.
    expect(toasts[0].timeoutMs).toBeNull();
  });

  it('stays silent on a true first visit with no stored data', () => {
    const { storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    expect(loadStoredProject()).toBeNull();
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('refreshes the last-known-good backup on validated load', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    const blob = JSON.stringify(buildProject());
    map.set(STORAGE_KEY, blob);
    expect(map.has(BACKUP_KEY)).toBe(false);

    const loaded = loadStoredProject();

    expect(loaded?.id).toBe('p1');
    // The just-validated main blob becomes the backup for the new session.
    expect(map.get(BACKUP_KEY)).toBe(blob);
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('repairs a main blob with dangling entityOrder ids instead of discarding it', () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);

    const project = buildProject();
    project.sheets['sheet-1'].entityOrder = ['ghost-entity'];
    map.set(STORAGE_KEY, JSON.stringify(project));
    // A stale backup that must NOT win over the repairable main blob.
    map.set(BACKUP_KEY, JSON.stringify({ ...buildProject(), id: 'older-backup' }));

    const loaded = loadStoredProject();

    expect(loaded?.id).toBe('p1');
    expect(loaded?.sheets['sheet-1'].entityOrder).toEqual([]);
    const toasts = useNotifications.getState().toasts;
    expect(toasts.some((t) => t.kind === 'warning' && t.message.includes('repairs'))).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});
