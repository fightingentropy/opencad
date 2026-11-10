import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render2d } from '../render2d';
import { createContainmentSampleProject } from '../../sample-containment';
import { createEmptyProject, useStore } from '../../state/store';
import { parseDXF } from '../../io/dxf-import';
import { importIFC } from '../../io/ifc-import';
import { getSymbol, SYMBOL_LIST } from '../../symbols';
import type { Cable } from '../../models/cable';
import type { ContainmentEntity, EditorState, Entity, Project } from '../../types';

beforeAll(() => vi.stubGlobal('Path2D', class {
  moveTo = () => undefined;
  lineTo = () => undefined;
}));
afterAll(() => vi.unstubAllGlobals());

const recordingCanvas = () => {
  const texts: string[] = [];
  const strokes: string[] = [];
  const values: Record<string, unknown> = {
    globalAlpha: 1, font: '10px sans-serif', strokeStyle: '',
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: (text: string) => texts.push(text),
    stroke: () => strokes.push(String(values.strokeStyle)),
  };
  const ctx = new Proxy(values, {
    get: (target, property: string) => target[property] ?? (() => undefined),
    set: (target, property: string, value: unknown) => { target[property] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, strokes };
};

const editor = (mode: EditorState['complianceOverlay']): EditorState => ({
  ...useStore.getState().editor,
  viewport: { x: 2500, y: 2500, zoom: 0.1 },
  selection: new Set(), hover: null, drafting: null, pendingSymbol: null,
  complianceOverlay: mode,
});

const draw = (project: Project, mode: EditorState['complianceOverlay'], preview?: Entity) => {
  const recording = recordingCanvas();
  render2d(recording.ctx, project, editor(mode), {
    width: 900, height: 700, dpr: 1, symbolLookup: getSymbol, placementPreview: preview,
  });
  return recording;
};

const fixture = () => {
  const project = createContainmentSampleProject();
  const sheet = project.sheets[project.activeSheetId];
  const containment = Object.values(sheet.entities).find((entity): entity is ContainmentEntity => entity.kind === 'containment')!;
  containment.innerCsaMm2 = 10000;
  const cable: Cable = {
    id: 'power', reference: 'PW-01', from: 'A', to: 'B', circuitType: 'power',
    construction: 'XLPE/SWA/LSOH', cores: 3, csa: 16, hasEarth: true,
    outerDiameter: 50, voltage: 400, route: [containment.id],
  };
  project.cableSchedule = { cables: { [cable.id]: cable }, cableOrder: [cable.id] };
  return { project, containment, cable };
};

describe('2D cable overlays', () => {
  it.each(['off', 'fill', 'segregation', 'support-spacing'] as const)('renders a symbol preview with an empty record schedule and %s overlay', (mode) => {
    const project = createContainmentSampleProject();
    project.cableSchedule = { cables: {}, cableOrder: [] };
    const preview: Entity = {
      id: 'preview', kind: 'symbol', layerId: project.activeLayerId, visible: true, locked: false,
      symbolId: SYMBOL_LIST[0].id, position: { x: 2500, y: 2500 }, rotation: 0, scale: 1,
    };
    const rendered = draw(project, mode, preview);
    expect(rendered.strokes).toContain('#5cdcff');
    expect(rendered.texts.filter((text) => text.endsWith('%'))).toHaveLength(0);
  });

  it('uses route ID arrays and actual outer diameters from the keyed cable schedule', () => {
    const { project } = fixture();
    // One 50 mm cable occupies 1963.5 mm² of a declared 10000 mm² section.
    expect(draw(project, 'fill').texts).toContain('20%');
    expect(draw(project, 'off').texts).not.toContain('20%');
  });

  it('checks real circuit types and respects a separating compartment', () => {
    const { project, containment, cable } = fixture();
    const data: Cable = { ...cable, id: 'data', reference: 'DT-01', circuitType: 'data' };
    project.cableSchedule!.cables[data.id] = data;
    project.cableSchedule!.cableOrder.push(data.id);
    expect(draw(project, 'segregation').strokes).toContain('#ff5d5d');
    containment.compartments = 2;
    expect(draw(project, 'segregation').strokes).not.toContain('#ff5d5d');
  });

  it('labels an unchecked fill as unknown instead of 0%', () => {
    const { project, cable } = fixture();
    cable.outerDiameter = 0;
    const { texts, strokes } = draw(project, 'fill');
    expect(strokes).toContain('#9aa0a6');
    expect(texts).toContain('?');
    expect(texts).not.toContain('0%');
  });

  it('does not redraw hidden containment through its fill overlay', () => {
    const { project, containment } = fixture();
    project.layers[containment.layerId].visible = false;
    expect(draw(project, 'fill').texts).not.toContain('20%');
  });
});

describe('imported underlays', () => {
  // One line from (1000, 2000) to (1500, 2600), in millimetres.
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '1000', '20', '2000', '11', '1500', '21', '2600',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');

  const drawActiveSheet = () => {
    const translates: Array<[number, number]> = [];
    const segments: number[][] = [];
    const strokes: string[] = [];
    const values: Record<string, unknown> = {
      globalAlpha: 1, font: '10px sans-serif', strokeStyle: '',
      measureText: (text: string) => ({ width: text.length * 6 }),
      translate: (x: number, y: number) => translates.push([x, y]),
      moveTo: (x: number, y: number) => segments.push([x, y]),
      lineTo: (x: number, y: number) => segments[segments.length - 1]?.push(x, y),
      stroke: () => strokes.push(String(values.strokeStyle)),
    };
    const ctx = new Proxy(values, {
      get: (target, property: string) => target[property] ?? (() => undefined),
      set: (target, property: string, value: unknown) => { target[property] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    render2d(ctx, useStore.getState().project, editor('off'), {
      width: 900, height: 700, dpr: 1, symbolLookup: getSymbol,
    });
    return { translates, segments, strokes };
  };

  it('draws a DXF underlay on a real layer, at its origin', () => {
    useStore.setState({ project: createEmptyProject(), past: [], future: [] });
    const underlay = parseDXF(dxf);
    expect(underlay.origin).toEqual({ x: 1000, y: 2000 });
    expect(underlay.vectors).toEqual([{ a: { x: 0, y: 0 }, b: { x: 500, y: 600 }, color: undefined }]);

    useStore.getState().addEntitiesByLayerName([underlay]);

    const { project } = useStore.getState();
    const stored = project.sheets[project.activeSheetId].entities[underlay.id];
    expect(project.layers[stored.layerId]).toMatchObject({ name: 'Underlay', visible: true });

    const drawn = drawActiveSheet();
    // The vectors are origin-local, so the origin has to be applied before they are stroked.
    expect(drawn.translates).toContainEqual([1000, 2000]);
    expect(drawn.segments).toContainEqual([0, 0, 500, 600]);
    expect(drawn.strokes).toContain('#7a8593');
  });

  it('puts IFC walls and slabs on the same real layer', () => {
    useStore.setState({ project: createEmptyProject(), past: [], future: [] });
    const result = importIFC([
      'ISO-10303-21;', "FILE_SCHEMA(('IFC4'));", 'DATA;',
      '#1=IFCCARTESIANPOINT((0.,0.));',
      '#2=IFCCARTESIANPOINT((4000.,0.));',
      '#3=IFCPOLYLINE((#1,#2));',
      '#4=IFCSHAPEREPRESENTATION($,$,$,(#3));',
      '#5=IFCPRODUCTDEFINITIONSHAPE($,$,(#4));',
      '#6=IFCLOCALPLACEMENT($,$);',
      "#7=IFCWALL('w',$,'Wall',$,$,#6,#5,$,$);",
      "#8=IFCSLAB('s',$,'Slab',$,$,#6,#5,$,$);",
      'ENDSEC;', 'END-ISO-10303-21;',
    ].join('\n'));
    expect(result.entities.map((e) => e.kind).sort()).toEqual(['underlay', 'wall']);

    useStore.getState().addEntitiesByLayerName(result.entities);

    const { project } = useStore.getState();
    const added = Object.values(project.sheets[project.activeSheetId].entities);
    expect(added.length).toBe(result.entities.length);
    for (const e of added) expect(project.layers[e.layerId]?.name).toBe('Underlay');
    expect(project.layerOrder.filter((id) => project.layers[id].name === 'Underlay')).toHaveLength(1);
  });
});

describe('new-kind drawers use the real entity fields', () => {
  const calls = () => {
    const log: { op: string; args: number[] }[] = [];
    const rec = (op: string) => (...args: number[]) => { log.push({ op, args }); };
    const values: Record<string, unknown> = {
      globalAlpha: 1, font: '10px sans-serif', strokeStyle: '',
      measureText: (text: string) => ({ width: text.length * 6 }),
      moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'),
    };
    const ctx = new Proxy(values, {
      get: (target, property: string) => target[property] ?? (() => undefined),
      set: (target, property: string, value: unknown) => { target[property] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, log };
  };
  const drawOne = (entity: object) => {
    const project = createEmptyProject();
    const sheet = project.sheets[project.activeSheetId];
    const layerId = project.activeLayerId;
    const e = { id: 'x', layerId, visible: true, locked: false, ...entity } as unknown as Entity;
    sheet.entities = { x: e }; sheet.entityOrder = ['x'];
    const rec = calls();
    render2d(rec.ctx, project, editor('off'), { width: 900, height: 700, dpr: 1, symbolLookup: getSymbol });
    return rec.log;
  };
  const finite = (log: { args: number[] }[]) => log.every(c => c.args.every(Number.isFinite));

  it('draws a vertical grid line at its offset between start and end', () => {
    const log = drawOne({ kind: 'grid-line', orientation: 'vertical', offset: 1000, start: -500, end: 4000, label: 'A' });
    expect(log).toContainEqual({ op: 'moveTo', args: [1000, -500] });
    expect(log).toContainEqual({ op: 'lineTo', args: [1000, 4000] });
  });
  it('draws a horizontal grid line along y = offset', () => {
    const log = drawOne({ kind: 'grid-line', orientation: 'horizontal', offset: 2000, start: 0, end: 6000, label: '1' });
    expect(log).toContainEqual({ op: 'moveTo', args: [0, 2000] });
    expect(log).toContainEqual({ op: 'lineTo', args: [6000, 2000] });
  });
  it('draws equipment connection dots at their positions', () => {
    const log = drawOne({ kind: 'equipment', equipmentKind: 'distribution-board', tag: 'DB', a: { x: 0, y: 0 }, b: { x: 600, y: 400 },
      connections: [{ name: 'In', position: { x: 123, y: 456 } }] });
    expect(log).toContainEqual(expect.objectContaining({ op: 'arc', args: expect.arrayContaining([123, 456]) }));
    expect(finite(log)).toBe(true);
  });
  it('draws section marker arrows for a left or right view direction', () => {
    for (const viewDirection of ['left', 'right']) {
      const log = drawOne({ kind: 'section-marker', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, label: 'A-A', viewDirection });
      expect(finite(log)).toBe(true);
      const tip = log.filter(c => c.op === 'lineTo').map(c => c.args[1]);
      expect(tip).toContain(viewDirection === 'left' ? 4 : -4);
    }
  });
});
