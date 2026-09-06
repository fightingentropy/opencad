import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render2d } from '../render2d';
import { createContainmentSampleProject } from '../../sample-containment';
import { useStore } from '../../state/store';
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

  it('does not redraw hidden containment through its fill overlay', () => {
    const { project, containment } = fixture();
    project.layers[containment.layerId].visible = false;
    expect(draw(project, 'fill').texts).not.toContain('20%');
  });
});
