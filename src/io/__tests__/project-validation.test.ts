import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Project, Sheet } from '../../types';
import {
  projectStructureDefects,
  isStructurallyValidProject,
  repairProjectStructure,
} from '../project-validation';
import { exportProjectJSON, importProjectJSON } from '../project';
import { createSampleProject } from '../../sample';
import { createWholeSiteSampleProject } from '../../sample-whole-site';
import { useNotifications } from '../../state/notifications';

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
    name: 'Validation Test',
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

// Loosely-typed clone so individual fields can be deleted/poisoned without
// fighting the Project type.
const brokenCopy = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(buildProject())) as Record<string, unknown>;

describe('projectStructureDefects', () => {
  it('accepts a minimal valid project', () => {
    expect(projectStructureDefects(buildProject())).toEqual([]);
    expect(isStructurallyValidProject(buildProject())).toBe(true);
  });

  it('rejects non-object values outright', () => {
    expect(projectStructureDefects(null)).toEqual(['project is not an object']);
    expect(projectStructureDefects(undefined)).toEqual(['project is not an object']);
    expect(projectStructureDefects([])).toEqual(['project is not an object']);
    expect(projectStructureDefects('{}')).toEqual(['project is not an object']);
  });

  it('flags a missing sheets record', () => {
    const p = brokenCopy();
    delete p.sheets;
    const defects = projectStructureDefects(p);
    expect(defects).toContain('missing sheets');
  });

  it('flags sheet order entries that do not resolve', () => {
    const p = brokenCopy();
    p.sheetOrder = ['sheet-1', 'ghost'];
    expect(projectStructureDefects(p)).toContain('sheet order references missing sheet "ghost"');
  });

  it('flags an empty sheet order', () => {
    const p = brokenCopy();
    p.sheetOrder = [];
    expect(projectStructureDefects(p)).toContain('project has no sheets');
  });

  it('flags sheets missing their entities containers', () => {
    const p = brokenCopy();
    (p.sheets as Record<string, Record<string, unknown>>)['sheet-1'] = { id: 'sheet-1' };
    const defects = projectStructureDefects(p);
    expect(defects).toContain('sheet "sheet-1" has no entities record');
    expect(defects).toContain('sheet "sheet-1" has no entity order');
  });

  it('flags an unresolvable active sheet id', () => {
    const p = brokenCopy();
    p.activeSheetId = 'ghost';
    expect(projectStructureDefects(p)).toContain('active sheet "ghost" does not exist');
  });

  it('flags layer order entries that do not resolve', () => {
    const p = brokenCopy();
    p.layerOrder = ['ghost-layer'];
    expect(projectStructureDefects(p)).toContain('layer order references missing layer "ghost-layer"');
  });

  it('tolerates an active layer id that does not resolve', () => {
    // Projects with zero layers are legal; only the string-ness is checked.
    const p = buildProject();
    expect(p.activeLayerId in p.layers).toBe(false);
    expect(projectStructureDefects(p)).toEqual([]);
  });

  it('accepts both bundled sample projects', () => {
    expect(projectStructureDefects(createSampleProject())).toEqual([]);
    expect(projectStructureDefects(createWholeSiteSampleProject())).toEqual([]);
  });

  it('tolerates unknown extra fields', () => {
    const p = brokenCopy();
    p.futureFeature = { nested: true };
    p.anotherUnknown = 42;
    expect(projectStructureDefects(p)).toEqual([]);
  });
});

describe('repairProjectStructure', () => {
  it('leaves a valid project untouched', () => {
    const p = brokenCopy();
    const before = JSON.stringify(p);
    expect(repairProjectStructure(p)).toEqual([]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('leaves both bundled sample projects untouched', () => {
    // Samples must pass with zero defects AND zero repairs — a repair here
    // would mean the builders ship internally inconsistent data.
    expect(repairProjectStructure(JSON.parse(JSON.stringify(createSampleProject())))).toEqual([]);
    expect(
      repairProjectStructure(JSON.parse(JSON.stringify(createWholeSiteSampleProject()))),
    ).toEqual([]);
  });

  it('drops dangling entityOrder ids and records the repair', () => {
    const p = brokenCopy();
    const sheet = (p.sheets as Record<string, Record<string, unknown>>)['sheet-1'];
    sheet.entityOrder = ['ghost-1', 'ghost-2'];
    const repairs = repairProjectStructure(p);
    expect(repairs.some((r) => r.includes('dangling entity id'))).toBe(true);
    expect(sheet.entityOrder).toEqual([]);
    expect(projectStructureDefects(p)).toEqual([]);
  });

  it('restores entities the order array lost track of', () => {
    const p = brokenCopy();
    const sheet = (p.sheets as Record<string, Record<string, unknown>>)['sheet-1'];
    sheet.entities = { 'e-1': { id: 'e-1', kind: 'wire' } };
    sheet.entityOrder = [];
    const repairs = repairProjectStructure(p);
    expect(repairs.some((r) => r.includes('draw order'))).toBe(true);
    expect(sheet.entityOrder).toEqual(['e-1']);
  });

  it('rebuilds derivable fields: orders and active ids', () => {
    const p = brokenCopy();
    delete p.sheetOrder;
    delete p.layerOrder;
    delete p.activeSheetId;
    delete p.activeLayerId;
    const repairs = repairProjectStructure(p);
    expect(repairs.length).toBeGreaterThan(0);
    expect(p.sheetOrder).toEqual(['sheet-1']);
    expect(p.layerOrder).toEqual([]);
    expect(p.activeSheetId).toBe('sheet-1');
    expect(typeof p.activeLayerId).toBe('string');
    expect(projectStructureDefects(p)).toEqual([]);
  });

  it('drops sheet/layer order entries that resolve to nothing', () => {
    const p = brokenCopy();
    p.sheetOrder = ['sheet-1', 'ghost-sheet'];
    p.layers = { L1: { id: 'L1' } };
    p.layerOrder = ['L1', 'ghost-layer'];
    repairProjectStructure(p);
    expect(p.sheetOrder).toEqual(['sheet-1']);
    expect(p.layerOrder).toEqual(['L1']);
    expect(projectStructureDefects(p)).toEqual([]);
  });

  it('fills a missing id and name with safe defaults', () => {
    const p = brokenCopy();
    delete p.id;
    delete p.name;
    const repairs = repairProjectStructure(p);
    expect(repairs).toHaveLength(2);
    expect(typeof p.id).toBe('string');
    expect((p.id as string).length).toBeGreaterThan(0);
    expect(p.name).toBe('Untitled project');
  });

  it('never fabricates sheets or entities containers', () => {
    const noSheets = brokenCopy();
    delete noSheets.sheets;
    repairProjectStructure(noSheets);
    expect(projectStructureDefects(noSheets)).toContain('missing sheets');

    const noEntities = brokenCopy();
    (noEntities.sheets as Record<string, Record<string, unknown>>)['sheet-1'] = { id: 'sheet-1' };
    repairProjectStructure(noEntities);
    expect(projectStructureDefects(noEntities)).toContain('sheet "sheet-1" has no entities record');
  });

  it('returns no repairs for non-object values', () => {
    expect(repairProjectStructure(null)).toEqual([]);
    expect(repairProjectStructure([])).toEqual([]);
    expect(repairProjectStructure('junk')).toEqual([]);
  });
});

describe('importProjectJSON', () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    useNotifications.getState().clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('rejects junk that is not even JSON', () => {
    expect(() => importProjectJSON('this is not json {')).toThrow();
  });

  it('rejects files without the format marker', () => {
    expect(() => importProjectJSON('{"format":"something-else"}')).toThrow(
      'Not an OpenCAD project file',
    );
    expect(() => importProjectJSON('null')).toThrow('Not an OpenCAD project file');
  });

  it('rejects files with the right marker but a damaged project', () => {
    // The exact scenario from the data-loss bug: correct marker, no sheets.
    const file = JSON.parse(exportProjectJSON(buildProject()));
    delete file.project.sheets;
    expect(() => importProjectJSON(JSON.stringify(file))).toThrow(
      /damaged or incomplete: .*missing sheets/,
    );
  });

  it('caps the defect list in the error message', () => {
    const file = JSON.parse(exportProjectJSON(buildProject()));
    // Four defects survive repair: two non-object sheets plus a sheet with
    // neither entities record nor entity order.
    file.project.sheets = { a: 5, b: null, c: { id: 'c' } };
    let message = '';
    try {
      importProjectJSON(JSON.stringify(file));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/damaged or incomplete/);
    expect(message).toMatch(/\(\+\d+ more\)$/);
  });

  it('repairs dangling entityOrder ids instead of rejecting the file', () => {
    const file = JSON.parse(exportProjectJSON(buildProject()));
    file.project.sheets['sheet-1'].entityOrder = ['ghost-1', 'ghost-2'];
    const imported = importProjectJSON(JSON.stringify(file));
    expect(imported.sheets['sheet-1'].entityOrder).toEqual([]);
    // The repair is recorded: console line plus a warning toast.
    expect(warnSpy).toHaveBeenCalled();
    const toasts = useNotifications.getState().toasts;
    expect(toasts.some((t) => t.kind === 'warning' && t.message.includes('repairs'))).toBe(true);
  });

  it('repairs missing derivable fields instead of rejecting the file', () => {
    const file = JSON.parse(exportProjectJSON(buildProject()));
    delete file.project.sheetOrder;
    delete file.project.activeSheetId;
    delete file.project.layerOrder;
    const imported = importProjectJSON(JSON.stringify(file));
    expect(imported.sheetOrder).toEqual(['sheet-1']);
    expect(imported.activeSheetId).toBe('sheet-1');
  });

  it('preserves unknown extra fields from newer app versions', () => {
    const file = JSON.parse(exportProjectJSON(buildProject()));
    file.project.futureFeature = { enabled: true };
    const imported = importProjectJSON(JSON.stringify(file));
    expect((imported as unknown as Record<string, unknown>).futureFeature).toEqual({
      enabled: true,
    });
    expect(useNotifications.getState().toasts).toHaveLength(0);
  });

  it('round-trips an exported project and applies migrations', () => {
    const project = buildProject();
    const imported = importProjectJSON(exportProjectJSON(project));
    expect(imported.id).toBe(project.id);
    expect(imported.sheetOrder).toEqual(project.sheetOrder);
    // The fixture predates the cable schedule / standards profile — the
    // import path now runs the same migration shim as the autosave loader.
    expect(imported.cableSchedule).toBeDefined();
    expect(imported.standardsProfile).toBeDefined();
    expect(imported.catalogues && Object.keys(imported.catalogues).length).toBeTruthy();
  });

  it('round-trips the whole-site sample project', () => {
    const sample = createWholeSiteSampleProject();
    const imported = importProjectJSON(exportProjectJSON(sample));
    expect(imported.id).toBe(sample.id);
    expect(imported.sheetOrder).toEqual(sample.sheetOrder);
    expect(Object.keys(imported.sheets)).toEqual(Object.keys(sample.sheets));
  });
});
