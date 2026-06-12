import { describe, expect, it } from 'vitest';
import { computeSnap } from '../snap';
import type {
  Entity,
  LineEntity,
  Sheet,
  SnapSettings,
  SymbolDef,
  SymbolEntity,
  TextEntity,
  Vec2,
} from '../../types';

const base = { layerId: 'l1', visible: true, locked: false } as const;

const line = (id: string, a: Vec2, b: Vec2, layerId = 'l1'): LineEntity => ({
  id,
  kind: 'line',
  ...base,
  layerId,
  a,
  b,
});

const makeSheet = (entities: Entity[]): Sheet => ({
  id: 'sh1',
  name: 'Test',
  number: '001',
  kind: 'schematic',
  width: 420,
  height: 297,
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
  entityOrder: entities.map((e) => e.id),
});

const settings = (over: Partial<SnapSettings> = {}): SnapSettings => ({
  enabled: true,
  grid: false,
  osnap: true,
  endpoint: true,
  midpoint: true,
  intersection: true,
  perpendicular: true,
  pin: true,
  gridSize: 10,
  ...over,
});

const noSymbols = (): SymbolDef | undefined => undefined;

// 12px tolerance at 1px/mm zoom = 12mm world tolerance
const opts = { pixelsPerMm: 1, toleranceScreenPx: 12, symbolLookup: noSymbols };

const allVisible = () => true;

describe('computeSnap', () => {
  it('returns the raw cursor when snapping is disabled', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    const r = computeSnap({ x: 3, y: 3 }, sheet, settings({ enabled: false }), opts, allVisible);
    expect(r.kind).toBe('none');
    expect(r.point).toEqual({ x: 3, y: 3 });
  });

  it('snaps to the endpoint of a segment-less entity (text position)', () => {
    const text: TextEntity = {
      id: 't',
      kind: 'text',
      ...base,
      position: { x: 40, y: 40 },
      text: 'L1',
      fontSize: 4,
      rotation: 0,
    };
    const sheet = makeSheet([text]);
    const r = computeSnap({ x: 41, y: 41 }, sheet, settings(), opts, allVisible);
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual({ x: 40, y: 40 });
    expect(r.entityId).toBe('t');
  });

  it('snaps onto a line endpoint when the cursor is just past the end', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    const r = computeSnap({ x: 103, y: 2 }, sheet, settings(), opts, allVisible);
    expect(r.kind).not.toBe('none');
    expect(r.point).toEqual({ x: 100, y: 0 });
  });

  it('snaps to the midpoint of a line', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 })]);
    const r = computeSnap({ x: 5, y: 3 }, sheet, settings(), opts, allVisible);
    expect(r.point).toEqual({ x: 5, y: 0 });
  });

  it('snaps to the intersection of two crossing lines', () => {
    const sheet = makeSheet([
      line('a', { x: 0, y: 0 }, { x: 100, y: 100 }),
      line('b', { x: 0, y: 100 }, { x: 100, y: 0 }),
    ]);
    const r = computeSnap(
      { x: 50, y: 50 },
      sheet,
      settings({ midpoint: false }),
      opts,
      allVisible
    );
    expect(r.kind).toBe('intersection');
    expect(r.point.x).toBeCloseTo(50);
    expect(r.point.y).toBeCloseTo(50);
  });

  it('does not snap to an intersection that lies outside tolerance', () => {
    // The lines cross at (100,100); the cursor sits near line `a` only.
    const sheet = makeSheet([
      line('a', { x: 0, y: 0 }, { x: 100, y: 100 }),
      line('b', { x: 0, y: 100 }, { x: 100, y: 100 }),
    ]);
    const r = computeSnap(
      { x: 20, y: 20.1 },
      sheet,
      settings({ midpoint: false, endpoint: false }),
      opts,
      allVisible
    );
    expect(r.kind).toBe('perpendicular');
    expect(r.point.x).toBeCloseTo(20.05);
    expect(r.point.y).toBeCloseTo(20.05);
  });

  it('snaps to a symbol pin through the symbol lookup', () => {
    const def: SymbolDef = {
      id: 'sw',
      name: 'Switch',
      category: 'switch',
      bounds: { minX: -20, minY: -5, maxX: 20, maxY: 5 },
      pins: [{ id: 'p1', name: '1', position: { x: 10, y: 0 } }],
      primitives: [],
    };
    const sym: SymbolEntity = {
      id: 'sym',
      kind: 'symbol',
      ...base,
      symbolId: 'sw',
      position: { x: 200, y: 200 },
      rotation: 0,
      scale: 1,
    };
    const lookup = (id: string) => (id === 'sw' ? def : undefined);
    const r = computeSnap(
      { x: 211, y: 201 },
      makeSheet([sym]),
      settings(),
      { ...opts, symbolLookup: lookup },
      allVisible
    );
    expect(r.point).toEqual({ x: 210, y: 200 });
    expect(r.entityId).toBe('sym');
  });

  it('ignores entities on hidden layers', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 100, y: 0 }, 'hidden')]);
    const r = computeSnap(
      { x: 50, y: 2 },
      sheet,
      settings(),
      opts,
      (layerId) => layerId !== 'hidden'
    );
    expect(r.kind).toBe('none');
    expect(r.point).toEqual({ x: 50, y: 2 });
  });

  it('falls back to grid snapping when no object snap is in range', () => {
    const sheet = makeSheet([line('a', { x: 200, y: 200 }, { x: 300, y: 200 })]);
    const r = computeSnap({ x: 23, y: 27 }, sheet, settings({ grid: true }), opts, allVisible);
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual({ x: 20, y: 30 });
  });
});
