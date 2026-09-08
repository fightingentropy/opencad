import type { ContainmentEntity, Project, Vec2 } from '../types';
import { discoverRouteConnections } from '../lib/route-connections';
import { distance3, hasHeightChanges, routePath, type Point3 } from '../lib/route-path';
import { generateContainmentBOM, type ContainmentBOMRow } from './containment-bom';
import { buildExportMetadata, exportMetadataSummary, type ExportMetadata } from './export-metadata';

export type DrawingPrimitive =
  | { kind: 'line'; a: Vec2; b: Vec2; color: string; width: number; dashed?: boolean }
  | { kind: 'text'; at: Vec2; text: string; size: number; color: string; align?: 'left' | 'center' | 'right'; bold?: boolean }
  | { kind: 'circle'; at: Vec2; radius: number; color: string; fill?: string };
export interface RunDrawingPage { title: string; scale: number | null; width: number; height: number; primitives: DrawingPrimitive[]; }
export interface RunDrawingPack {
  title: string; routeIds: string[]; lengthMm: number; pages: RunDrawingPage[];
  materials: ContainmentBOMRow[]; metadata: ExportMetadata;
}
export interface RunDrawingOptions { includeConnected?: boolean; elevationAxis?: 'x' | 'y'; sectionLeg?: number; }
export interface DrawingLeg { route: ContainmentEntity; index: number; a: Point3; b: Point3; length: number; }

const INK = '#304b60', MUTED = '#82919c', PALE = '#ccd6dd', ACCENT = '#346f99';
const mm = (value: number) => Math.round(value).toLocaleString('en-GB');
const plain = (value: string) => value.replaceAll('×', 'x').replace(/[–—]/g, '-');
const safeLabel = (value: string, limit = 75) => plain(value).slice(0, limit);

export function selectedRunRoutes(project: Project, routeId: string, includeConnected = false): ContainmentEntity[] {
  const sheet = project.sheets[project.activeSheetId];
  const source = sheet?.entities[routeId];
  if (source?.kind !== 'containment') return [];
  const ids = new Set([source.id]);
  if (includeConnected) {
    const routes = Object.values(sheet.entities).filter((e): e is ContainmentEntity => e.kind === 'containment');
    const connections = routes.flatMap(route => discoverRouteConnections(route, project, 1)
      .filter(link => link.target.kind === 'route').map(link => [route.id, link.targetId]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of connections) if (ids.has(a) !== ids.has(b)) { ids.add(a); ids.add(b); changed = true; }
    }
  }
  return [source, ...sheet.entityOrder.filter(id => id !== source.id && ids.has(id)).map(id => sheet.entities[id] as ContainmentEntity)];
}

export function drawingLegs(project: Project, routes: ContainmentEntity[]): DrawingLeg[] {
  const floor = project.floors?.[project.sheets[project.activeSheetId].floorId ?? ''];
  return routes.flatMap(route => {
    const path = routePath(route, floor);
    return path.slice(1).map((b, index) => ({ route, index, a: path[index], b, length: distance3(path[index], b) })).filter(leg => leg.length >= 1);
  });
}

const text = (page: RunDrawingPage, value: string, x: number, y: number, size = 3, color = INK, align: 'left' | 'center' | 'right' = 'left', bold = false) =>
  page.primitives.push({ kind: 'text', at: { x, y }, text: plain(value), size, color, align, bold });
const line = (page: RunDrawingPage, a: Vec2, b: Vec2, color = INK, width = 0.3, dashed = false) =>
  page.primitives.push({ kind: 'line', a, b, color, width, dashed });
const rectangle = (page: RunDrawingPage, x: number, y: number, w: number, h: number, color = INK, weight = 0.3) => {
  const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  p.forEach((point, i) => line(page, point, p[(i + 1) % 4], color, weight));
};
function dimension(page: RunDrawingPage, a: Vec2, b: Vec2, value: string, offset = 8, labelShift = 0): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 2) return;
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  const p = { x: a.x + nx * offset, y: a.y + ny * offset }, q = { x: b.x + nx * offset, y: b.y + ny * offset };
  line(page, a, { x: p.x + nx * 2, y: p.y + ny * 2 }, PALE, .2);
  line(page, b, { x: q.x + nx * 2, y: q.y + ny * 2 }, PALE, .2);
  line(page, p, q, MUTED, .2);
  for (const end of [p, q]) line(page, { x: end.x - 1, y: end.y + 1 }, { x: end.x + 1, y: end.y - 1 }, MUTED, .25);
  text(page, value, (p.x + q.x) / 2 + nx * 3 + (b.x - a.x) / length * labelShift,
    (p.y + q.y) / 2 + ny * 3 + (b.y - a.y) / length * labelShift, 2.8, MUTED, 'center');
}
function fit(points: Vec2[], area: { x: number; y: number; width: number; height: number }) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const required = Math.max((maxX - minX) / area.width, (maxY - minY) / area.height, 1);
  const scale = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].find(value => value >= required) ?? Math.ceil(required / 10000) * 10000;
  return { scale, point: (p: Vec2) => ({ x: area.x + area.width / 2 + (p.x - (minX + maxX) / 2) / scale,
    y: area.y + area.height / 2 - (p.y - (minY + maxY) / 2) / scale }) };
}

export function buildRunDrawingPack(project: Project, routeId: string, options: RunDrawingOptions = {}): RunDrawingPack {
  const routes = selectedRunRoutes(project, routeId, options.includeConnected);
  const legs = drawingLegs(project, routes);
  if (!routes.length || !legs.length) throw new Error('Select a route with at least one complete leg.');
  const ids = new Set(routes.map(route => route.id));
  const metadata = buildExportMetadata(project, 'selected-run-drawing-pack');
  const title = safeLabel(routes[0].label || routes[0].containmentType + ' run');
  const lengthMm = legs.reduce((sum, leg) => sum + leg.length, 0);
  const pages: RunDrawingPage[] = [];
  const page = (name: string): RunDrawingPage => {
    const p: RunDrawingPage = { title: name, width: 420, height: 297, scale: null, primitives: [] };
    text(p, 'OPENCAD / ELECTRICAL', 18, 18, 2.8, ACCENT, 'left', true);
    text(p, safeLabel(project.name), 402, 18, 2.8, MUTED, 'right');
    line(p, { x: 18, y: 24 }, { x: 402, y: 24 }, PALE, .25);
    text(p, name, 18, 37, 7, INK, 'left', true);
    text(p, title + (routes.length > 1 ? ` + ${routes.length - 1} connected runs` : '') + `  /  ${(lengthMm / 1000).toFixed(3)} m`, 18, 46, 3.2, MUTED);
    pages.push(p); return p;
  };
  const points = legs.flatMap(leg => [leg.a, leg.b]);
  const firstHorizontal = Math.max(0, legs.findIndex(leg => Math.abs(leg.a.z - leg.b.z) < .01));
  const section = legs[options.sectionLeg ?? firstHorizontal] ?? legs[firstHorizontal];
  const sectionMiddle = { x: (section.a.x + section.b.x) / 2, y: (section.a.y + section.b.y) / 2, z: (section.a.z + section.b.z) / 2 };
  const plan = page('Plan');
  const planFit = fit(points, { x: 54, y: 75, width: 312, height: 146 });
  plan.scale = planFit.scale;
  for (const leg of legs) {
    const a = planFit.point(leg.a), b = planFit.point(leg.b);
    if (Math.hypot(b.x - a.x, b.y - a.y) > .1) {
      line(plan, a, b, PALE, Math.max(.4, (leg.route.width ?? 100) / plan.scale));
      line(plan, a, b, ACCENT, .35);
      dimension(plan, a, b, mm(Math.hypot(leg.b.x - leg.a.x, leg.b.y - leg.a.y)) + ' mm', 9 + leg.index % 2 * 4, leg === section ? 14 : 0);
    } else text(plan, `${leg.b.z > leg.a.z ? 'Rise' : 'Drop'} ${mm(Math.abs(leg.b.z - leg.a.z))} mm`, a.x + 4, a.y - 7, 2.8, ACCENT);
  }
  const pointGroups = new Map<string, { point: Vec2; ids: string[] }>();
  routes.forEach((route, routeIndex) => routePath(route, project.floors?.[project.sheets[project.activeSheetId].floorId ?? '']).forEach((p, i) => {
    const key = `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;
    const group = pointGroups.get(key) ?? { point: planFit.point(p), ids: [] };
    group.ids.push(routes.length > 1 ? `${routeIndex + 1}.${i + 1}` : `P${i + 1}`); pointGroups.set(key, group);
  }));
  for (const group of pointGroups.values()) {
    plan.primitives.push({ kind: 'circle', at: group.point, radius: 1, color: ACCENT, fill: '#ffffff' });
    text(plan, group.ids.join('/'), group.point.x + 3, group.point.y + 5, 2.7, INK);
  }
  const cut = planFit.point(sectionMiddle);
  const xyLength = Math.hypot(section.b.x - section.a.x, section.b.y - section.a.y);
  const nx = xyLength > 0 ? -(section.b.y - section.a.y) / xyLength : 1;
  const ny = xyLength > 0 ? -(section.b.x - section.a.x) / xyLength : 0;
  const cutA = { x: cut.x - nx * 15, y: cut.y - ny * 15 }, cutB = { x: cut.x + nx * 15, y: cut.y + ny * 15 };
  line(plan, cutA, cutB, MUTED, .25, true);
  text(plan, 'A', cutA.x - nx * 4, cutA.y - ny * 4 + 1, 3, INK, 'center');
  text(plan, 'A', cutB.x + nx * 4, cutB.y + ny * 4 + 1, 3, INK, 'center');
  text(plan, 'Plan dimensions are horizontal. Rises and drops are dimensioned separately.', 18, 248, 2.8, MUTED);
  text(plan, `Section A-A: ${safeLabel(section.route.label || section.route.containmentType, 40)}, leg ${section.index + 1}, midpoint.`, 18, 255, 2.8, MUTED);

  const axis = options.elevationAxis ?? (Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) >= Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) ? 'x' : 'y');
  const elevation = page(`Elevation - along ${axis.toUpperCase()}`);
  const projected = (point: Point3) => ({ x: point[axis], y: point.z });
  const elevationFit = fit([...points.map(projected), ...points.map(p => ({ x: p[axis], y: 0 }))], { x: 54, y: 75, width: 312, height: 145 });
  elevation.scale = elevationFit.scale;
  const floorA = elevationFit.point({ x: Math.min(...points.map(p => p[axis])), y: 0 });
  const floorB = elevationFit.point({ x: Math.max(...points.map(p => p[axis])), y: 0 });
  line(elevation, { x: floorA.x - 12, y: floorA.y }, { x: floorB.x + 12, y: floorB.y }, MUTED, .3, true);
  text(elevation, '0 FFL', floorA.x - 15, floorA.y + 1, 2.8, MUTED, 'right');
  const labelled = new Set<string>();
  for (const leg of legs) {
    const a = elevationFit.point(projected(leg.a)), b = elevationFit.point(projected(leg.b));
    const length = Math.hypot(leg.b[axis] - leg.a[axis], leg.b.z - leg.a.z);
    if (length > 1) {
      line(elevation, a, b, PALE, Math.max(.6, (leg.route.height ?? 50) / elevation.scale));
      line(elevation, a, b, ACCENT, .4);
      dimension(elevation, a, b, mm(length) + ' mm', -9 - leg.index % 2 * 4);
    }
    for (const point of [leg.a, leg.b]) {
      const key = `${point[axis].toFixed(2)}:${point.z.toFixed(2)}`;
      if (labelled.has(key)) continue;
      labelled.add(key);
      const p = elevationFit.point(projected(point));
      text(elevation, `${point.z >= 0 ? '+' : ''}${mm(point.z)}`, p.x + 3, p.y + 5, 2.6, MUTED);
    }
  }
  text(elevation, `Looking along ${axis === 'x' ? 'Y' : 'X'}. Elevations in mm above finished floor level.`, 18, 248, 2.8, MUTED);
  text(elevation, 'Dimensions show this projection; the leg schedule gives true 3D lengths.', 18, 255, 2.8, MUTED);

  const crossSection = page('Section A-A');
  const width = section.route.width ?? 100;
  const height = section.route.containmentType === 'conduit' ? width : section.route.height ?? 50;
  const sectionFit = fit([{ x: -width / 2, y: 0 }, { x: width / 2, y: height }], { x: 45, y: 86, width: 170, height: 110 });
  crossSection.scale = sectionFit.scale;
  const tl = sectionFit.point({ x: -width / 2, y: height }), br = sectionFit.point({ x: width / 2, y: 0 });
  const bl = { x: tl.x, y: br.y }, tr = { x: br.x, y: tl.y };
  if (section.route.containmentType === 'conduit') {
    const at = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
    crossSection.primitives.push({ kind: 'circle', at, radius: width / 2 / crossSection.scale, color: INK },
      { kind: 'circle', at, radius: Math.max(1, width / 2 - 2) / crossSection.scale, color: INK });
  } else {
    line(crossSection, tl, bl, INK, .65); line(crossSection, bl, br, INK, .65); line(crossSection, br, tr, INK, .65);
    if (['trunking', 'duct', 'busbar'].includes(section.route.containmentType)) line(crossSection, tl, tr, INK, .65);
    else { line(crossSection, tl, { x: tl.x + Math.min(4, width / crossSection.scale / 8), y: tl.y }, INK, .65);
      line(crossSection, tr, { x: tr.x - Math.min(4, width / crossSection.scale / 8), y: tr.y }, INK, .65); }
  }
  dimension(crossSection, bl, br, `${mm(width)} mm`, 13);
  dimension(crossSection, br, tr, `${mm(height)} mm`, 13);
  const info = [
    ['ROUTE', safeLabel(section.route.label || section.route.containmentType, 40)],
    ['SECTION', `${mm(width)} x ${mm(height)} mm`],
    ['CUT POSITION', `Leg ${section.index + 1}, midpoint`],
    ['X / Y', `${mm(sectionMiddle.x)} / ${mm(sectionMiddle.y)} mm`],
    ['HEIGHT AT CUT', `${mm(sectionMiddle.z)} mm above FFL`],
    ['MATERIAL', safeLabel(section.route.material?.replaceAll('-', ' ') || 'Unspecified', 40)],
    ['TYPE', safeLabel(section.route.subType?.replaceAll('-', ' ') || section.route.containmentType, 40)],
  ];
  info.forEach(([label, value], i) => { text(crossSection, label, 267, 87 + i * 18, 2.4, MUTED); text(crossSection, value, 267, 93 + i * 18, 3.1, INK); });
  line(crossSection, { x: 245, y: 75 }, { x: 245, y: 224 }, PALE, .2);
  text(crossSection, 'Section is normal to the selected leg. Nominal width and depth; wall thickness is illustrative.', 18, 248, 2.8, MUTED);
  text(crossSection, 'Use the selected manufacturer’s fitting and support details for construction.', 18, 255, 2.8, MUTED);

  const materials = generateContainmentBOM(project, ids);
  for (let start = 0; start < materials.length; start += 18) {
    const table = page(start ? 'Materials - continued' : 'Materials');
    const cols = [18, 250, 333, 376, 402];
    ['ITEM', 'SIZE', 'QUANTITY', 'UNIT'].forEach((value, i) => text(table, value, cols[i], 65, 2.5, MUTED, 'left', true));
    line(table, { x: 18, y: 69 }, { x: 402, y: 69 }, PALE, .3);
    materials.slice(start, start + 18).forEach((row, i) => {
      const y = 79 + i * 9;
      text(table, safeLabel(row.description, 105), cols[0], y, 2.8);
      text(table, safeLabel(row.size, 32), cols[1], y, 2.8, MUTED);
      text(table, row.quantity.toLocaleString('en-GB', { maximumFractionDigits: 3 }), cols[2] + 25, y, 2.8, INK, 'right');
      text(table, row.unit, cols[3], y, 2.8, MUTED);
      line(table, { x: 18, y: y + 3 }, { x: 402, y: y + 3 }, PALE, .1);
    });
    text(table, 'Stock: 3 m lengths with 5% allowance. Route metres are an alternative measure, not additional material.', 18, 248, 2.8, MUTED);
    text(table, 'Fittings reflect modelled joints. Horizontal support quantities are estimates; vertical fixings require design.', 18, 255, 2.8, MUTED);
  }
  for (let start = 0; start < legs.length; start += 15) {
    const schedule = page(start ? 'Leg schedule - continued' : 'Leg schedule');
    ['LEG', 'FROM X / Y / Z (mm)', 'TO X / Y / Z (mm)', 'TRUE LENGTH'].forEach((value, i) => text(schedule, value, [18, 75, 210, 365][i], 65, 2.5, MUTED, 'left', true));
    line(schedule, { x: 18, y: 69 }, { x: 402, y: 69 }, PALE, .3);
    legs.slice(start, start + 15).forEach((leg, i) => {
      const y = 80 + i * 10, format = (p: Point3) => `${mm(p.x)} / ${mm(p.y)} / ${mm(p.z)}`;
      text(schedule, `${routes.indexOf(leg.route) + 1}.${leg.index + 1}`, 18, y, 2.8);
      text(schedule, format(leg.a), 75, y, 2.8); text(schedule, format(leg.b), 210, y, 2.8);
      text(schedule, `${mm(leg.length)} mm`, 400, y, 2.8, INK, 'right');
      line(schedule, { x: 18, y: y + 4 }, { x: 402, y: y + 4 }, PALE, .1);
    });
    text(schedule, `Total true route length: ${(lengthMm / 1000).toFixed(3)} m. Coordinates use the source sheet datum.`, 18, 248, 2.8, MUTED);
    text(schedule, hasHeightChanges(routes[0]) ? 'Route includes elevation changes.' : 'Z values are above finished floor level.', 18, 255, 2.8, MUTED);
  }
  const sheet = project.sheets[project.activeSheetId];
  pages.forEach((p, i) => {
    line(p, { x: 18, y: 265 }, { x: 402, y: 265 }, PALE, .25);
    text(p, `${sheet.number} / ${safeLabel(sheet.name, 55)}`, 18, 274, 2.7, MUTED);
    text(p, `A3 / ${p.scale ? '1:' + p.scale : 'Schedule'} / mm`, 18, 281, 2.7, MUTED);
    text(p, 'Model coordination drawing - verify on site', 210, 274, 2.7, MUTED, 'center');
    text(p, `Project updated ${metadata.projectModifiedAt.slice(0, 10)}`, 210, 281, 2.5, MUTED, 'center');
    text(p, `${i + 1} / ${pages.length}`, 402, 274, 3, INK, 'right');
    text(p, metadata.generatedAt.slice(0, 10), 402, 281, 2.7, MUTED, 'right');
  });
  return { title, routeIds: [...ids], lengthMm, pages, materials, metadata };
}

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function runDrawingPageSVG(page: RunDrawingPage): string {
  const primitives = page.primitives.map(p => p.kind === 'line'
    ? `<line x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" stroke="${p.color}" stroke-width="${p.width}"${p.dashed ? ' stroke-dasharray="2 2"' : ''}/>`
    : p.kind === 'circle' ? `<circle cx="${p.at.x}" cy="${p.at.y}" r="${p.radius}" stroke="${p.color}" stroke-width="0.3" fill="${p.fill ?? 'none'}"/>`
      : `<text x="${p.at.x}" y="${p.at.y}" fill="${p.color}" font-family="Arial, Helvetica, sans-serif" font-size="${p.size}" font-weight="${p.bold ? 700 : 400}" text-anchor="${p.align === 'right' ? 'end' : p.align === 'center' ? 'middle' : 'start'}">${escape(p.text)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${escape(page.title)}"><rect width="420" height="297" fill="white"/>${primitives}</svg>`;
}

export async function runDrawingPackPDF(pack: RunDrawingPack): Promise<Uint8Array> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  doc.setProperties({ title: pack.title + ' - route drawings', subject: exportMetadataSummary(pack.metadata),
    keywords: JSON.stringify({ ...pack.metadata, routeIds: pack.routeIds }), creator: 'OpenCAD Electrical' });
  for (const [index, page] of pack.pages.entries()) {
    if (index) doc.addPage('a3', 'landscape');
    for (const p of page.primitives) {
      if (p.kind === 'line') {
        doc.setDrawColor(p.color); doc.setLineWidth(p.width); doc.setLineDashPattern(p.dashed ? [2, 2] : [], 0);
        doc.line(p.a.x, p.a.y, p.b.x, p.b.y);
      } else if (p.kind === 'circle') {
        doc.setDrawColor(p.color); doc.setLineWidth(.3); doc.setLineDashPattern([], 0);
        if (p.fill) doc.setFillColor(p.fill);
        doc.circle(p.at.x, p.at.y, p.radius, p.fill ? 'FD' : 'S');
      } else {
        doc.setTextColor(p.color); doc.setFont('helvetica', p.bold ? 'bold' : 'normal'); doc.setFontSize(p.size * 72 / 25.4);
        doc.text(p.text, p.at.x, p.at.y, { align: p.align ?? 'left' });
      }
    }
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
