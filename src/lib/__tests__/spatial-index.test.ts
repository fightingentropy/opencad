import { describe, expect, it } from 'vitest';
import { buildSpatialIndex, getSpatialIndex } from '../spatial-index';
import type {
  ContainmentEntity,
  Entity,
  GroupEntity,
  LineEntity,
  RectangleEntity,
  Sheet,
  SymbolDef,
  SymbolEntity,
  Vec2,
} from '../../types';

const base = { layerId: 'l1', visible: true, locked: false } as const;

const line = (id: string, a: Vec2, b: Vec2): LineEntity => ({
  id,
  kind: 'line',
  ...base,
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

const noSymbols = (): SymbolDef | undefined => undefined;

describe('buildSpatialIndex', () => {
  it('returns only entities whose bounds overlap the region, in draw order', () => {
    const sheet = makeSheet([
      line('a', { x: 0, y: 0 }, { x: 10, y: 10 }),
      line('b', { x: 200, y: 200 }, { x: 210, y: 210 }),
      line('c', { x: 5, y: 5 }, { x: 15, y: 15 }),
    ]);
    const index = buildSpatialIndex(sheet, noSymbols);

    expect(index.query({ minX: -1, minY: -1, maxX: 6, maxY: 6 })).toEqual(['a', 'c']);
    expect(index.query({ minX: 199, minY: 199, maxX: 201, maxY: 201 })).toEqual(['b']);
    expect(index.query({ minX: 500, minY: 500, maxX: 510, maxY: 510 })).toEqual([]);
    // Whole-sheet query keeps entityOrder ordering
    expect(index.query({ minX: -10, minY: -10, maxX: 300, maxY: 300 })).toEqual(['a', 'b', 'c']);
  });

  it('pads containment bounds by half the band width', () => {
    const tray: ContainmentEntity = {
      id: 'tray',
      kind: 'containment',
      ...base,
      containmentType: 'tray',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      width: 100,
    };
    const index = buildSpatialIndex(makeSheet([tray]), noSymbols);

    // 40mm off the centerline is inside the 50mm half-band
    expect(index.query({ minX: 49, minY: 39, maxX: 51, maxY: 41 })).toEqual(['tray']);
    // 70mm off is beyond it
    expect(index.query({ minX: 49, minY: 69, maxX: 51, maxY: 71 })).toEqual([]);
  });

  it('indexes symbols by their transformed def bounds', () => {
    const def: SymbolDef = {
      id: 'sw',
      name: 'Switch',
      category: 'switch',
      bounds: { minX: -20, minY: -5, maxX: 20, maxY: 5 },
      pins: [],
      primitives: [],
    };
    const sym: SymbolEntity = {
      id: 'sym',
      kind: 'symbol',
      ...base,
      symbolId: 'sw',
      position: { x: 100, y: 100 },
      rotation: Math.PI / 2,
      scale: 1,
    };
    const lookup = (id: string) => (id === 'sw' ? def : undefined);
    const index = buildSpatialIndex(makeSheet([sym]), lookup);

    // Rotated 90°, world bounds are x∈[95,105], y∈[80,120].
    // Inside the rotated box (proves rotation is applied to the def bounds):
    expect(index.query({ minX: 99, minY: 116, maxX: 101, maxY: 120 })).toEqual(['sym']);
    // Outside the rotated box, but inside the def-less 30·scale fallback box
    // (proves the def bounds are used, not the fallback):
    expect(index.query({ minX: 116, minY: 99, maxX: 120, maxY: 101 })).toEqual([]);
  });

  it('skips extent-less entities like groups', () => {
    const group: GroupEntity = {
      id: 'grp',
      kind: 'group',
      ...base,
      childIds: ['a'],
    };
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 }), group]);
    const index = buildSpatialIndex(sheet, noSymbols);

    expect(index.query({ minX: -100, minY: -100, maxX: 100, maxY: 100 })).toEqual(['a']);
  });

  it('still finds entities too large for cell bucketing (broad list)', () => {
    const big: RectangleEntity = {
      id: 'big',
      kind: 'rectangle',
      ...base,
      a: { x: 0, y: 0 },
      b: { x: 10000, y: 10000 },
    };
    const sheet = makeSheet([
      big,
      line('corner', { x: 0, y: 0 }, { x: 10, y: 10 }),
    ]);
    const index = buildSpatialIndex(sheet, noSymbols);

    expect(index.query({ minX: 4990, minY: 4990, maxX: 5010, maxY: 5010 })).toEqual(['big']);
    expect(index.query({ minX: -1, minY: -1, maxX: 5, maxY: 5 })).toEqual(['big', 'corner']);
  });

  it('handles an empty sheet', () => {
    const index = buildSpatialIndex(makeSheet([]), noSymbols);
    expect(index.query({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([]);
  });
});

describe('getSpatialIndex', () => {
  it('caches per sheet object identity and rebuilds on a new sheet object', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 })]);
    const first = getSpatialIndex(sheet, noSymbols);
    expect(getSpatialIndex(sheet, noSymbols)).toBe(first);

    // Store mutations replace the Sheet object — a clone must rebuild.
    const next: Sheet = { ...sheet };
    expect(getSpatialIndex(next, noSymbols)).not.toBe(first);
  });

  it('rebuilds when a different symbol lookup is supplied', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 })]);
    const first = getSpatialIndex(sheet, noSymbols);
    const otherLookup = (): SymbolDef | undefined => undefined;
    expect(getSpatialIndex(sheet, otherLookup)).not.toBe(first);
  });
});
