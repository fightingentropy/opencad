import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../state/store';
import type { CommandDef } from '../commands';
import type { InsertableComponent } from '../component-library';
import type { ContainmentEntity, Entity, Project, Sheet, SymbolEntity } from '../../types';
import {
  buildWorkspaceSearchIndex, clearWorkspaceSearchRecents, rememberWorkspaceResult, searchWorkspace, workspaceTargetView,
} from '../workspace-search';

const components: InsertableComponent[] = [
  {
    id: 'tray-300', kind: 'containment', containmentType: 'tray', title: 'Perforated tray 300 × 50',
    detail: '300 × 50 mm · 3000 mm length', keywords: 'cable tray galvanized steel', identifiers: ['TR-3050'],
    definition: { kind: 'containment', containmentType: 'tray', width: 300, height: 50, length: 3000, subType: 'perforated' },
  },
  {
    id: 'breaker', kind: 'symbol', title: 'Circuit breaker', detail: 'Electrical symbol', keywords: 'MCB protection Schneider', identifiers: ['A9F-74216'],
    definition: { kind: 'symbol', symbolId: 'circuit-breaker' },
  },
];
const command = (id: string, title: string): CommandDef => ({ id, title, category: 'Tools', run: () => {} });
const commands = [command('file.save', 'Save Project'), command('file.export-pdf', 'Export PDF'), command('tool.tray', 'Cable Tray Tool')];

function fixture(): Project {
  const project = createEmptyProject();
  const layerId = project.activeLayerId;
  const tray: ContainmentEntity = {
    id: 'route', kind: 'containment', layerId, visible: true, locked: false,
    containmentType: 'tray', width: 300, height: 50, label: 'North tray',
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], catalogPartNumber: 'MT-300',
  };
  const board: SymbolEntity = {
    id: 'board', kind: 'symbol', layerId, visible: true, locked: false,
    symbolId: 'circuit-breaker', tag: 'DB-01', description: 'North distribution board',
    position: { x: 0, y: 0 }, rotation: 0, scale: 1,
  };
  const sheet = (id: string, name: string, entities: Entity[]): Sheet => ({
    id, name, number: id === 'first' ? '101' : '202', kind: 'floor-plan', sceneStyle: 'containment',
    width: 5000, height: 3000, entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  });
  project.sheets = {
    first: sheet('first', 'Tray routing', [tray, board]),
    second: sheet('second', 'Upper floor', [{ ...board, description: 'Upper distribution board' }]),
  };
  project.sheetOrder = ['first', 'second'];
  project.activeSheetId = 'first';
  return project;
}

beforeEach(clearWorkspaceSearchRecents);

describe('workspace search', () => {
  it('returns mixed commands, addable components, existing objects and sheets', () => {
    const results = searchWorkspace(buildWorkspaceSearchIndex(fixture(), components, commands), 'tray');
    expect(new Set(results.map((result) => result.kind))).toEqual(new Set(['command', 'component', 'object', 'sheet']));
    expect(results.some((result) => result.kind === 'object' && result.entityId === 'route')).toBe(true);
    expect(results.some((result) => result.kind === 'component' && result.component.id === 'tray-300')).toBe(true);
  });

  it('prioritizes exact tags and punctuation-insensitive manufacturer part numbers', () => {
    const index = buildWorkspaceSearchIndex(fixture(), components, commands);
    expect(searchWorkspace(index, 'db01')[0].kind).toBe('object');
    expect(searchWorkspace(index, 'DB-01')[0].title).toBe('DB-01');
    expect(searchWorkspace(index, 'a9f74216')[0].id).toBe('component:breaker');
    expect(searchWorkspace(index, 'MT300')[0].kind).toBe('object');
    expect(searchWorkspace(index, '202')[0].id).toBe('sheet:second');
  });

  it('matches dimensions and words across fields in any order and keeps abbreviations useful', () => {
    const index = buildWorkspaceSearchIndex(fixture(), components, commands);
    expect(searchWorkspace(index, '300 tray')[0].id).toBe('component:tray-300');
    expect(searchWorkspace(index, 'tray 300x50').some((result) => result.kind === 'object')).toBe(true);
    expect(searchWorkspace(index, 'upper DB01')[0]).toMatchObject({ kind: 'object', sheetId: 'second' });
    expect(searchWorkspace(index, 'expdf')[0].id).toBe('command:file.export-pdf');
    expect(searchWorkspace(index, 'zzzznonexistent')).toHaveLength(0);
  });

  it('distinguishes Add intent from locating an existing route', () => {
    const index = buildWorkspaceSearchIndex(fixture(), components, commands);
    expect(searchWorkspace(index, 'add tray')[0].kind).toBe('component');
    expect(searchWorkspace(index, 'go to north tray')[0]).toMatchObject({ kind: 'object', entityId: 'route' });
  });

  it('treats 300 as a complete dimension rather than matching every 3000 mm stock length', () => {
    const variants = [150, 300, 600].map((width): InsertableComponent => ({
      ...components[0], id: `tray-${width}`, title: `Perforated tray ${width} × 50`,
      detail: `${width} × 50 mm · 3000 mm length`, keywords: 'tray cable 3m 3000', identifiers: [],
      definition: { kind: 'containment', containmentType: 'tray', width, height: 50, length: 3000 },
    }));
    const index = buildWorkspaceSearchIndex(fixture(), variants, commands);
    expect(searchWorkspace(index, 'add tray 300').map((result) => result.id)).toEqual(['component:tray-300']);
    expect(searchWorkspace(index, 'add tray 300mm').map((result) => result.id)).toEqual(['component:tray-300']);
    expect(searchWorkspace(index, 'add tray').every((result) => result.kind === 'component')).toBe(true);
    expect(searchWorkspace(index, 'add tray 3000')).toHaveLength(3);
  });

  it('keeps same-tag and same-ID objects on separate sheets without duplicating order entries', () => {
    const project = fixture();
    project.sheetOrder.push('first');
    project.sheets.first.entityOrder.push('board');
    const index = buildWorkspaceSearchIndex(project, [...components, components[0]], commands);
    const hits = searchWorkspace(index, 'DB01').filter((result) => result.kind === 'object');
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((result) => result.id)).size).toBe(2);
    expect(hits.map((result) => result.sheetId)).toEqual(['first', 'second']);
    expect(index.filter((result) => result.id === 'component:tray-300')).toHaveLength(1);
  });

  it('includes records omitted from imported sheet and entity order arrays', () => {
    const project = fixture();
    project.sheetOrder = ['first'];
    project.sheets.second.entityOrder = [];
    expect(searchWorkspace(buildWorkspaceSearchIndex(project, components, commands), 'upper DB01')[0])
      .toMatchObject({ kind: 'object', sheetId: 'second', entityId: 'board' });
  });

  it('keeps empty search compact, includes useful components and promotes recent actions', () => {
    const index = buildWorkspaceSearchIndex(fixture(), components, commands);
    const initial = searchWorkspace(index, '');
    expect(initial.length).toBeLessThanOrEqual(9);
    expect(initial.some((result) => result.kind === 'component')).toBe(true);
    expect(initial.some((result) => result.kind === 'object')).toBe(false);
    rememberWorkspaceResult('component:breaker');
    expect(searchWorkspace(index, '')[0].id).toBe('component:breaker');
    expect(searchWorkspace(index, '').filter((result) => result.id === 'component:breaker')).toHaveLength(1);
  });

  it('does not expose contextual or currently-disabled registry entries', () => {
    const disabled = { ...command('edit.delete', 'Delete'), isEnabled: () => false };
    const contextual = { ...command('context.pan', 'Pan gesture'), contextual: true };
    const index = buildWorkspaceSearchIndex(fixture(), [], [disabled, contextual, ...commands]);
    expect(index.filter((result) => result.kind === 'command').map((result) => result.id)).not.toContain('command:edit.delete');
    expect(searchWorkspace(index, 'pan gesture')).toHaveLength(0);
  });
});

describe('workspace target view', () => {
  it('focuses physical containment in 3D and makes drawing-only objects visible in 2D', () => {
    const project = fixture();
    const sheet = project.sheets.first;
    expect(workspaceTargetView(project, sheet, sheet.entities.route)).toBe('3d');
    expect(workspaceTargetView(project, sheet, { ...sheet.entities.route as ContainmentEntity, containmentType: 'conduit' })).toBe('2d');
    expect(workspaceTargetView(project, sheet, { ...sheet.entities.route as ContainmentEntity, containmentType: 'ladder' })).toBe('2d');
    expect(workspaceTargetView(project, sheet, sheet.entities.board)).toBe('2d');
    const annotation: Entity = { id: 'note', kind: 'text', layerId: project.activeLayerId, visible: true, locked: false, text: 'Note', position: { x: 0, y: 0 }, fontSize: 10, rotation: 0 };
    expect(workspaceTargetView(project, sheet, annotation)).toBe('2d');
  });

  it('uses the requested sheet instead of focusing another legacy panel with the same entity ID', () => {
    const project = fixture();
    project.sheets.first.kind = 'panel-layout';
    project.sheets.first.sceneStyle = 'panel';
    project.sheets.second.sceneStyle = 'building';
    expect(workspaceTargetView(project, project.sheets.first, project.sheets.first.entities.board)).toBe('3d');
    expect(workspaceTargetView(project, project.sheets.second, project.sheets.second.entities.board)).toBe('2d');
  });
});
