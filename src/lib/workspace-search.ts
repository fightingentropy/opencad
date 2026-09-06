import type { CommandDef } from './commands';
import { fuzzyScore, searchCommands } from './commands';
import { getInsertableComponents, type InsertableComponent } from './component-library';
import { getSymbol } from '../symbols';
import type { Entity, Project, Sheet } from '../types';

interface SearchFields {
  id: string;
  title: string;
  detail: string;
  keywords: string;
  identifiers: string[];
}

export type WorkspaceSearchResult = SearchFields & (
  | { kind: 'command'; command: CommandDef }
  | { kind: 'component'; component: InsertableComponent }
  | { kind: 'object'; entityId: string; sheetId: string; entityKind: Entity['kind'] }
  | { kind: 'sheet'; sheetId: string }
);

const normalize = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/×/g, 'x').replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ')
  .replace(/\b(\d+)\s*(mm|cm|m)\b/g, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (value: string): string => normalize(value).replaceAll(' ', '');
const textValues = (object: object, keys: string[]): string[] => keys.flatMap((key) => {
  const value = (object as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
});
const orderedIds = (order: string[], records: object): string[] => [...new Set([...order, ...Object.keys(records)])];
const humanize = (value: string): string => value.replaceAll('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase());

export function workspaceEntityTitle(entity: Entity): string {
  const label = textValues(entity, ['tag', 'label', 'name', 'text', 'wireNumber', 'sourceName'])[0];
  if (label) return label;
  if (entity.kind === 'symbol') return getSymbol(entity.symbolId)?.name ?? 'Symbol';
  return humanize(textValues(entity, ['containmentType', 'equipmentKind', 'supportKind', 'fittingKind'])[0] ?? entity.kind);
}

/** Includes every sheet and object, retaining sheet identity for duplicate tags. */
export function buildWorkspaceSearchIndex(
  project: Project,
  components: readonly InsertableComponent[] = getInsertableComponents(project),
  commands: readonly CommandDef[] = searchCommands(''),
): WorkspaceSearchResult[] {
  const results: WorkspaceSearchResult[] = [];
  for (const command of commands) {
    if (command.contextual || (command.isEnabled && !command.isEnabled()) || command.id === 'help.palette') continue;
    results.push({
      id: `command:${command.id}`, kind: 'command', title: command.title, detail: '',
      keywords: `${command.category} ${command.id} run command`, identifiers: [command.id], command,
    });
  }
  for (const component of components) results.push({
    id: `component:${component.id}`, kind: 'component', title: component.title, detail: component.detail,
    keywords: `${component.keywords} add insert place component`, identifiers: component.identifiers ?? [], component,
  });
  for (const sheetId of orderedIds(project.sheetOrder, project.sheets)) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    results.push({
      id: `sheet:${sheetId}`, kind: 'sheet', sheetId, title: sheet.name,
      detail: [sheet.number, humanize(sheet.kind)].filter(Boolean).join(' · '),
      keywords: `${sheet.name} ${sheet.number} ${sheet.kind} sheet drawing page`, identifiers: [sheetId, sheet.number].filter(Boolean),
    });
    for (const entityId of orderedIds(sheet.entityOrder, sheet.entities)) {
      const entity = sheet.entities[entityId];
      if (!entity) continue;
      const identifiers = textValues(entity, ['id', 'tag', 'partNumber', 'catalogPartNumber', 'catalogProductId', 'wireNumber']);
      const metadata = textValues(entity, ['description', 'manufacturer', 'partNumber', 'catalogPartNumber', 'rating', 'containmentType', 'subType', 'equipmentKind', 'supportKind', 'fittingKind']);
      const symbol = entity.kind === 'symbol' ? getSymbol(entity.symbolId) : undefined;
      const layer = project.layers[entity.layerId];
      const dimensions = entity.kind === 'containment' ? `${entity.width ?? ''} x ${entity.height ?? ''} mm` : '';
      results.push({
        id: `object:${JSON.stringify([sheetId, entityId])}`, kind: 'object', entityId, sheetId, entityKind: entity.kind,
        title: workspaceEntityTitle(entity),
        detail: [sheet.name, ...textValues(entity, ['description', 'partNumber', 'catalogPartNumber'])].filter(Boolean).join(' · '),
        keywords: [entity.kind, ...metadata, ...identifiers, dimensions, symbol?.name, symbol?.description, layer?.name,
          sheet.name, sheet.number, project.floors?.[sheet.floorId ?? '']?.name,
          project.systems?.[entity.systemId ?? '']?.name, 'object existing go to find locate'].filter(Boolean).join(' '),
        identifiers,
      });
    }
  }
  // An imported catalogue or repeated order entry must not produce duplicate actions.
  return [...new Map(results.map((result) => [result.id, result])).values()];
}

const recentResults: string[] = [];
export function rememberWorkspaceResult(id: string): void {
  const previous = recentResults.indexOf(id);
  if (previous >= 0) recentResults.splice(previous, 1);
  recentResults.unshift(id);
  recentResults.splice(8);
}
export function clearWorkspaceSearchRecents(): void { recentResults.length = 0; }

function suggestions(index: readonly WorkspaceSearchResult[]): WorkspaceSearchResult[] {
  const quickCommands = ['file.save', 'edit.undo', 'view.zoom-extents', 'file.open'];
  const byId = new Map(index.map((result) => [result.id, result]));
  const recent = recentResults.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, 3);
  const commands = quickCommands.flatMap((id) => byId.has(`command:${id}`) ? [byId.get(`command:${id}`)!] : []);
  if (commands.length < 4) commands.push(...index.filter((result) => result.kind === 'command' && !commands.includes(result)).slice(0, 4 - commands.length));
  const componentResults = index.filter((result) => result.kind === 'component');
  const components = ['tray', 'trunking', 'basket', 'symbol', 'equipment'].flatMap((kind) => {
    const match = componentResults.find((result) => result.kind === 'component'
      && (result.component.containmentType ?? result.component.kind) === kind);
    return match ? [match] : [];
  });
  if (components.length < 5) components.push(...componentResults.filter((result) => !components.includes(result)).slice(0, 5 - components.length));
  return [...new Map([...recent, ...commands, ...components].map((result) => [result.id, result])).values()];
}

function matchScore(result: WorkspaceSearchResult, query: string): number | null {
  const title = normalize(result.title);
  const keywords = normalize(`${result.detail} ${result.keywords}`);
  const identifiers = result.identifiers.map(normalize);
  const queryCompact = compact(query);
  let score = 0;
  for (const token of query.split(' ').filter(Boolean)) {
    let tokenScore = 0;
    if (/^\d+$/.test(token)) {
      // A requested 300 mm section must not match the 3000 mm stock length.
      const numbers = (value: string): string[] => value.match(/\d+/g) ?? [];
      if (numbers(title).includes(token)) tokenScore = 150;
      else if (identifiers.some((id) => numbers(id).includes(token))) tokenScore = 110;
      else if (numbers(keywords).includes(token)) tokenScore = 75;
    } else if (identifiers.some((id) => compact(id) === token)) tokenScore = 180;
    else if (title.split(' ').includes(token)) tokenScore = 150;
    else if (title.split(' ').some((word) => word.startsWith(token))) tokenScore = 120;
    else if (identifiers.some((id) => compact(id).startsWith(token))) tokenScore = 110;
    else if (title.includes(token)) tokenScore = 100;
    else if (keywords.split(' ').includes(token)) tokenScore = 75;
    else if (keywords.includes(token)) tokenScore = 55;
    else if (/\d/.test(token) && compact(keywords).includes(compact(token))) tokenScore = 50;
    else if (token.length >= 3) {
      const fuzzy = fuzzyScore(token, title);
      if (fuzzy != null && fuzzy >= token.length * 1.6) tokenScore = 20 + Math.min(25, fuzzy);
    }
    if (!tokenScore) return null;
    score += tokenScore;
  }
  if (identifiers.some((id) => compact(id) === queryCompact)) score += 1600;
  else if (title === query) score += 1300;
  else if (title.startsWith(query)) score += 900;
  else if (title.includes(query)) score += 600;
  return score - title.length * 0.05;
}

/** Exact tags/part numbers lead; tokens may appear in any order or field. */
export function searchWorkspace(index: readonly WorkspaceSearchResult[], input: string, limit = 40): WorkspaceSearchResult[] {
  const normalized = normalize(input);
  if (!normalized) return suggestions(index).slice(0, limit);
  const intent = /^(add|insert|place)\s+/.test(normalized) ? 'component'
    : /^(go to|find|locate)\s+/.test(normalized) ? 'object' : null;
  const query = normalized.replace(/^(add|insert|place|go to|find|locate)\s+/, '');
  return index.flatMap((result, order) => {
    if (intent === 'component' && result.kind !== 'component') return [];
    if (intent === 'object' && result.kind !== 'object' && result.kind !== 'sheet') return [];
    const score = matchScore(result, query);
    return score == null ? [] : [{ result, order, score: score + (result.kind === intent ? 350 : 0) }];
  }).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ result }) => result);
}

/** Drawing-only targets should never be selected behind an unrelated 3D view. */
export function workspaceTargetView(project: Project, sheet: Sheet, entity?: Entity): '2d' | '3d' {
  const site = sheet.sceneStyle === 'site' || sheet.sceneStyle === 'containment'
    || (!!sheet.floorId && !!Object.keys(project.sites ?? {}).length);
  if (!entity) return site || sheet.kind === 'panel-layout' || sheet.sceneStyle === 'building' ? '3d' : '2d';
  if (entity.visible === false || project.layers[entity.layerId]?.visible === false) return '2d';
  if (sheet.sceneStyle === 'containment') return entity.kind === 'containment'
    && ['tray', 'trunking', 'basket'].includes(entity.containmentType) ? '3d' : '2d';
  if (site) {
    if (entity.kind === 'containment' && (entity.subType === 'underground-duct'
      || (entity.containmentType === 'conduit' && !Number.isFinite(entity.elevation)))) return '2d';
    return ['containment', 'wall', 'room', 'equipment', 'fitting', 'support', 'riser', 'penetration'].includes(entity.kind) ? '3d' : '2d';
  }
  if (sheet.kind !== 'panel-layout' && Object.values(project.sheets).some((item) => item.kind === 'panel-layout')) return '2d';
  if (entity.kind === 'symbol' || entity.kind === 'containment' || (sheet.kind === 'panel-layout' && entity.kind === 'wire')) return '3d';
  if (sheet.sceneStyle === 'building' && (entity.kind === 'wall' || entity.kind === 'room')) return '3d';
  return '2d';
}
