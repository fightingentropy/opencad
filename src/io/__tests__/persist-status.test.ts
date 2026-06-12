import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Project, Sheet } from '../../types';
import { saveStoredProject } from '../persist';
import { useSaveStatus } from '../../state/save-status';
import { useNotifications } from '../../state/notifications';

const AUTOSAVE_TOAST_ID = 'autosave-failure';

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
    name: 'Persist Test',
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

// In-memory localStorage stand-in — the vitest environment is node, so
// there's no real Storage global to lean on.
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
};

const quotaStorage = () => ({
  getItem: () => null,
  setItem: () => {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  },
  removeItem: () => {},
});

const brokenStorage = () => ({
  getItem: () => null,
  setItem: () => {
    throw new Error('storage disabled');
  },
  removeItem: () => {},
});

describe('saveStoredProject status surfacing', () => {
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

  it('transitions saving → saved on success and records a timestamp', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const seen: string[] = [];
    const unsub = useSaveStatus.subscribe((s) => seen.push(s.status));

    const result = saveStoredProject(buildProject());
    unsub();

    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(seen).toEqual(['saving', 'saved']);
    const state = useSaveStatus.getState();
    expect(state.status).toBe('saved');
    expect(state.lastSavedAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('sets error status and pushes a sticky toast on quota failure', () => {
    vi.stubGlobal('localStorage', quotaStorage());

    const result = saveStoredProject(buildProject());

    expect(result).toMatchObject({ ok: false, reason: 'quota' });
    const state = useSaveStatus.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('storage full');

    const toasts = useNotifications.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(AUTOSAVE_TOAST_ID);
    expect(toasts[0].kind).toBe('error');
    // Sticky — errors default to no timeout in the notification store.
    expect(toasts[0].timeoutMs).toBeNull();
    expect(toasts[0].message).toContain('storage is full');
    expect(toasts[0].detail).toContain('File → Save');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('dedupes repeated failures into a single toast via the stable id', () => {
    vi.stubGlobal('localStorage', quotaStorage());

    saveStoredProject(buildProject());
    saveStoredProject(buildProject());
    saveStoredProject(buildProject());

    const toasts = useNotifications.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(AUTOSAVE_TOAST_ID);
  });

  it('keeps the last-good timestamp when a later save fails', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    saveStoredProject(buildProject());
    const savedAt = useSaveStatus.getState().lastSavedAt;
    expect(savedAt).not.toBeNull();

    vi.stubGlobal('localStorage', quotaStorage());
    saveStoredProject(buildProject());

    const state = useSaveStatus.getState();
    expect(state.status).toBe('error');
    expect(state.lastSavedAt).toBe(savedAt);
  });

  it('dismisses the failure toast and recovers on the next successful save', () => {
    vi.stubGlobal('localStorage', quotaStorage());
    saveStoredProject(buildProject());
    expect(useNotifications.getState().toasts).toHaveLength(1);

    vi.stubGlobal('localStorage', memoryStorage());
    const result = saveStoredProject(buildProject());

    expect(result.ok).toBe(true);
    const state = useSaveStatus.getState();
    expect(state.status).toBe('saved');
    expect(state.error).toBeNull();
    expect(state.lastSavedAt).not.toBeNull();
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('reports unavailable storage as an error with its own copy', () => {
    vi.stubGlobal('localStorage', brokenStorage());

    const result = saveStoredProject(buildProject());

    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    const state = useSaveStatus.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('storage unavailable');
    expect(useNotifications.getState().toasts[0]?.id).toBe(AUTOSAVE_TOAST_ID);
  });

  it('reports serialisation failures as unknown', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const project = buildProject();
    // A circular reference makes JSON.stringify throw before storage is hit.
    (project as unknown as Record<string, unknown>).self = project;

    const result = saveStoredProject(project);

    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
    expect(useSaveStatus.getState().status).toBe('error');
    expect(useSaveStatus.getState().error).toBe('save failed');
    expect(useNotifications.getState().toasts[0]?.id).toBe(AUTOSAVE_TOAST_ID);
  });
});
