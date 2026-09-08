import { describe, expect, it } from 'vitest';
import { boardFixture, routeFixture, routeProject } from '../../lib/__tests__/route-fixtures';
import { buildRunDrawingPack, runDrawingPackPDF, runDrawingPageSVG, selectedRunRoutes } from '../run-drawings';
import { generateContainmentBOM } from '../containment-bom';
import { exportContainmentSchedule } from '../containment-schedule';
import { placeSupportsForContainment } from '../../lib/support-placer';
import { autoDetectPenetrationsForContainment } from '../../lib/auto-features';
import { routeLength } from '../../lib/route-path';
import { generateElevationView } from '../../views/elevation';
import { generateCrossSection } from '../../views/cross-section';

describe('selected run drawings and quantities', () => {
  it('keeps rises in existing elevation views and interpolates every section crossing', () => {
    const route = routeFixture('r', [{ x: -1000, y: 500, z: 2000 }, { x: 3000, y: 500, z: 2000 },
      { x: 3000, y: 500, z: 3000 }, { x: 0, y: 1000, z: 4000 }]);
    const project = routeProject(route);
    const elevation = generateElevationView({ project, sheetId: 'output', viewName: 'A',
      viewLine: { from: { x: 0, y: 0 }, to: { x: 4000, y: 0 }, depth: 1500 } });
    const rectangles = elevation.filter(e => e.kind === 'rectangle');
    expect(rectangles).toContainEqual(expect.objectContaining({ a: { x: 0, y: 2000 }, b: { x: 3000, y: 2050 } }));
    expect(rectangles).toContainEqual(expect.objectContaining({ a: { x: 2850, y: 2000 }, b: { x: 3150, y: 3050 } }));
    expect(elevation.some(e => e.kind === 'polyline' && e.points.some(p => p.y === 4000))).toBe(true);
    const section = generateCrossSection({ project, sheetId: 'output', viewName: 'B', cutA: { x: 1500, y: 0 }, cutB: { x: 1500, y: 2000 } });
    expect(section.filter(e => e.kind === 'rectangle').map(e => e.a.y)).toEqual([2000, 3500]);
  });

  it('uses the same 3D route length in the drawing pack, material quantities and schedule', () => {
    const route = routeFixture('R-01', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }, { x: 3000, y: 0, z: 1800 }]);
    const project = routeProject(route, boardFixture());
    const before = JSON.stringify(project), pack = buildRunDrawingPack(project, route.id);
    expect(pack.lengthMm).toBe(3600);
    expect(pack.pages.map(page => page.title)).toEqual(['Plan', 'Elevation - along X', 'Section A-A', 'Materials', 'Leg schedule']);
    expect(pack.materials.find(row => row.unit === 'm')?.quantity).toBe(3.6);
    expect(exportContainmentSchedule(project)[0].length).toBe(3.6);
    expect(JSON.stringify(project)).toBe(before);
    expect(pack.materials.find(row => row.kind.endsWith('end-cap'))?.quantity).toBe(1);
    expect(pack.pages[4].primitives).toContainEqual(expect.objectContaining({ kind: 'text', text: '600 mm' }));
  });

  it('includes only selected routes while retaining the actual connected endpoint context', () => {
    const first = routeFixture('a'), joined = routeFixture('b', [{ x: 3000, y: 0, z: 2400 }, { x: 5000, y: 0, z: 2400 }]);
    const unrelated = routeFixture('other', [{ x: 10000, y: 0, z: 2400 }, { x: 16000, y: 0, z: 2400 }]);
    const project = routeProject(first, joined, unrelated);
    expect(selectedRunRoutes(project, 'a', true).map(route => route.id)).toEqual(['a', 'b']);
    expect(buildRunDrawingPack(project, 'a').lengthMm).toBe(3000);
    const pack = buildRunDrawingPack(project, 'a', { includeConnected: true });
    expect(pack.lengthMm).toBe(5000);
    expect(pack.materials.find(row => row.kind.endsWith('end-cap'))?.quantity).toBe(2);
    expect(pack.materials.some(row => row.kind.endsWith('tee'))).toBe(false);
    expect(pack.materials.find(row => row.kind.endsWith('coupler'))?.quantity).toBe(1);
  });

  it('does not join identical plan coordinates on different heights or sheets', () => {
    const a = routeFixture('a'), b = routeFixture('b', [{ x: 3000, y: 0, z: 3000 }, { x: 6000, y: 0, z: 3000 }]);
    const project = routeProject(a, b);
    expect(selectedRunRoutes(project, 'a', true)).toHaveLength(1);
    const rows = generateContainmentBOM(project);
    expect(rows.find(row => row.kind.endsWith('end-cap'))?.quantity).toBe(4);
    const sheet = project.sheets[project.activeSheetId];
    const c = routeFixture('c', [{ x: 3000, y: 0, z: 2400 }, { x: 6000, y: 0, z: 2400 }]);
    project.sheets.other = { ...sheet, id: 'other', entities: { c }, entityOrder: ['c'] }; project.sheetOrder.push('other');
    expect(generateContainmentBOM(project).find(row => row.kind.endsWith('end-cap'))?.quantity).toBe(6);
  });

  it('counts a tee once, including a branch in the middle of a continuous spine', () => {
    const a = routeFixture('spine'), branch = routeFixture('branch', [{ x: 1500, y: 0, z: 2400 }, { x: 1500, y: 2000, z: 2400 }]);
    const rows = generateContainmentBOM(routeProject(a, branch));
    expect(rows.find(row => row.kind.endsWith('tee'))?.quantity).toBe(1);
    expect(rows.find(row => row.kind.endsWith('end-cap'))?.quantity).toBe(3);
  });

  it('includes vertical bends and only generates horizontal support estimates at their own heights', () => {
    const route = routeFixture('riser', [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 },
      { x: 3000, y: 0, z: 4000 }, { x: 5000, y: 0, z: 4000 }]);
    expect(routeLength(route)).toBe(6600);
    const supports = placeSupportsForContainment(route);
    expect(new Set(supports.map(s => s.elevation))).toEqual(new Set([2400, 4000]));
    expect(supports.filter(s => s.elevation !== 2400 && s.elevation !== 4000)).toEqual([]);
    const rows = generateContainmentBOM(routeProject(route));
    expect(rows.filter(row => row.kind.includes('riser')).reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
    expect(rows.find(row => row.kind.endsWith('support'))?.quantity).toBe(supports.length);
    const vertical = routeFixture('vertical', [{ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 4000 }]);
    expect(placeSupportsForContainment(vertical)).toEqual([]);
    expect(generateContainmentBOM(routeProject(vertical)).some(row => row.kind.endsWith('support'))).toBe(false);
  });

  it('does not create a fire penetration above the wall and interpolates a sloping crossing height', () => {
    const route = routeFixture('slope', [{ x: 0, y: 0, z: 2000 }, { x: 3000, y: 0, z: 4000 }]);
    const project = routeProject(route, { id: 'wall', kind: 'wall', visible: true, locked: false, layerId: route.layerId,
      points: [{ x: 1500, y: -1000 }, { x: 1500, y: 1000 }], thickness: 150, height: 2800, fireRating: 60 });
    expect(autoDetectPenetrationsForContainment(project, project.activeSheetId, route.id).penetrations).toEqual([]);
    (project.sheets[project.activeSheetId].entities.wall as { height: number }).height = 3500;
    expect(autoDetectPenetrationsForContainment(project, project.activeSheetId, route.id).penetrations[0]).toMatchObject({ elevation: 3000 });
  });

  it('escapes user labels in the SVG preview and paginates a long route schedule', () => {
    const route = routeFixture('<script>&"', Array.from({ length: 34 }, (_, i) => ({ x: i * 500, y: 0, z: 2400 })));
    const pack = buildRunDrawingPack(routeProject(route), route.id);
    expect(pack.pages.filter(page => page.title.startsWith('Leg schedule'))).toHaveLength(3);
    const svg = runDrawingPageSVG(pack.pages[0]);
    expect(svg).not.toContain('<script>'); expect(svg).toContain('&lt;script&gt;&amp;');
    for (const page of pack.pages) for (const primitive of page.primitives) {
      const points = primitive.kind === 'line' ? [primitive.a, primitive.b] : [primitive.at];
      expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });

  it('exports a real PDF with all drawing pages and source metadata', async () => {
    const pack = buildRunDrawingPack(routeProject(routeFixture()), 'route');
    const bytes = await runDrawingPackPDF(pack);
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('/Count 5'); expect(raw).toContain('selected-run-drawing-pack');
  });
});
