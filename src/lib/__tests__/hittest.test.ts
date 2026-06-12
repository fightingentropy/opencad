import { describe, expect, it } from 'vitest';
import { findEntityAt, findEntitiesInRect } from '../hittest';
import type {
  ContainmentEntity,
  Entity,
  GroupEntity,
  LineEntity,
  Sheet,
  SymbolDef,
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

const noSymbols = (): SymbolDef | undefined => undefined;

// 8px tolerance at 1px/mm zoom = 8mm world tolerance
const opts = { tolerance: 8, pixelsPerMm: 1, symbolLookup: noSymbols };

const allVisible = () => true;

describe('findEntityAt', () => {
  it('returns the topmost entity when several overlap', () => {
    const sheet = makeSheet([
      line('below', { x: 0, y: 0 }, { x: 100, y: 0 }),
      line('above', { x: 0, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect(findEntityAt(sheet, { x: 50, y: 1 }, opts, allVisible)).toBe('above');
  });

  it('skips entities on hidden layers', () => {
    const sheet = makeSheet([
      line('visible', { x: 0, y: 0 }, { x: 100, y: 0 }),
      line('hidden', { x: 0, y: 0 }, { x: 100, y: 0 }, 'off'),
    ]);
    const hit = findEntityAt(sheet, { x: 50, y: 1 }, opts, (layerId) => layerId !== 'off');
    expect(hit).toBe('visible');
  });

  it('hits a containment anywhere inside its band width', () => {
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
    const sheet = makeSheet([tray]);
    // 40mm off the centerline: inside the 50mm half-band
    expect(findEntityAt(sheet, { x: 50, y: 40 }, opts, allVisible)).toBe('tray');
    // 70mm off: outside band (50) + tolerance (8)
    expect(findEntityAt(sheet, { x: 50, y: 70 }, opts, allVisible)).toBeNull();
  });

  it('returns null when nothing is near the cursor', () => {
    const sheet = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 })]);
    expect(findEntityAt(sheet, { x: 200, y: 200 }, opts, allVisible)).toBeNull();
  });
});

describe('findEntitiesInRect', () => {
  const sheet = makeSheet([
    line('l1', { x: 0, y: 0 }, { x: 10, y: 0 }),
    line('l2', { x: 20, y: 0 }, { x: 30, y: 0 }),
    line('l3', { x: 5, y: -5 }, { x: 25, y: 5 }),
  ]);

  it('crossing selection returns any overlapping entity, in draw order', () => {
    const ids = findEntitiesInRect(
      sheet,
      { x: 9, y: -1 },
      { x: 21, y: 1 },
      opts,
      allVisible,
      false
    );
    expect(ids).toEqual(['l1', 'l2', 'l3']);
  });

  it('window selection returns only fully enclosed entities', () => {
    const ids = findEntitiesInRect(
      sheet,
      { x: 15, y: -10 },
      { x: 35, y: 10 },
      opts,
      allVisible,
      true
    );
    expect(ids).toEqual(['l2']);
  });

  it('never selects extent-less group entities', () => {
    const group: GroupEntity = {
      id: 'grp',
      kind: 'group',
      ...base,
      childIds: ['a'],
    };
    const withGroup = makeSheet([line('a', { x: 0, y: 0 }, { x: 10, y: 0 }), group]);
    const ids = findEntitiesInRect(
      withGroup,
      { x: -100, y: -100 },
      { x: 100, y: 100 },
      opts,
      allVisible,
      true
    );
    expect(ids).toEqual(['a']);
  });

  it('respects layer visibility', () => {
    const ids = findEntitiesInRect(
      sheet,
      { x: -10, y: -10 },
      { x: 40, y: 10 },
      opts,
      (layerId) => layerId !== 'l1',
      false
    );
    expect(ids).toEqual([]);
  });
});
