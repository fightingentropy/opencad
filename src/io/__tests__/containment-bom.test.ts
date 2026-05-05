import { describe, it, expect } from 'vitest';
import type { ContainmentEntity, Project, Sheet } from '../../types';
import { generateContainmentBOM } from '../containment-bom';

const buildProject = (containments: ContainmentEntity[]): Project => {
  const sheet: Sheet = {
    id: 'sheet-1',
    name: 'Test',
    number: 'F-001',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities: Object.fromEntries(containments.map((c) => [c.id, c])),
    entityOrder: containments.map((c) => c.id),
  };
  return {
    id: 'p1',
    name: 'BOM Test',
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

const trunking = (
  id: string,
  points: Array<{ x: number; y: number }>,
  manufacturer = 'Acme',
  partNumber = 'TR-100x50',
): ContainmentEntity => ({
  id,
  kind: 'containment',
  layerId: 'L',
  visible: true,
  locked: false,
  containmentType: 'trunking',
  width: 100,
  height: 50,
  points,
  manufacturer,
  catalogPartNumber: partNumber,
  material: 'galvanised-steel',
  label: id,
});

describe('generateContainmentBOM', () => {
  it('returns no rows for an empty project', () => {
    expect(generateContainmentBOM(buildProject([]))).toEqual([]);
  });

  it('skips zero-length containments', () => {
    const c = trunking('TR-1', [{ x: 0, y: 0 }]);
    const rows = generateContainmentBOM(buildProject([c]));
    expect(rows).toEqual([]);
  });

  it('emits straight lengths, linear metres, supports, and covers for a 6m trunking run', () => {
    // 6m straight: 6000mm × 1.05 / 3000 = 2.1 → ceil = 3 stock pieces.
    // Supports: ceil(6000 / 1200) + 1 = 5 + 1 = 6 (per current implementation).
    // Trunking adds covers (one per stock piece) and 0 fittings (no bends).
    const c = trunking('TR-1', [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
    ]);
    const rows = generateContainmentBOM(buildProject([c]));

    const straight = rows.find((r) =>
      r.description.startsWith('Straight length'),
    );
    expect(straight).toBeDefined();
    expect(straight?.unit).toBe('pcs');
    expect(straight?.quantity).toBe(3);

    const linear = rows.find((r) => r.unit === 'm');
    expect(linear).toBeDefined();
    expect(linear?.quantity).toBeCloseTo(6.0, 2);

    const supports = rows.find((r) => r.kind.includes('support'));
    expect(supports).toBeDefined();
    expect(supports?.quantity).toBeGreaterThanOrEqual(5);

    // No bends in a straight run
    const bends = rows.find((r) => r.description.startsWith('Flat bend'));
    expect(bends).toBeUndefined();

    const covers = rows.find((r) => r.kind.includes('cover'));
    expect(covers).toBeDefined();
    expect(covers?.quantity).toBe(3);
  });

  it('counts flat bends from direction changes in the route', () => {
    // L-shaped run: 3000 + 3000 mm with one 90° bend.
    const c = trunking('TR-2', [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 3000 },
    ]);
    const rows = generateContainmentBOM(buildProject([c]));
    const bends = rows.find((r) => r.description.startsWith('Flat bend'));
    expect(bends).toBeDefined();
    expect(bends?.quantity).toBe(1);
  });

  it('counts couplers as one less than the number of stock pieces', () => {
    // 9.6m run -> ceil(9600 * 1.05 / 3000) = ceil(3.36) = 4 pieces, 3 couplers.
    const c = trunking('TR-3', [
      { x: 0, y: 0 },
      { x: 9600, y: 0 },
    ]);
    const rows = generateContainmentBOM(buildProject([c]));
    const straight = rows.find((r) => r.description.startsWith('Straight length'));
    const couplers = rows.find((r) => r.description.startsWith('Coupler'));
    expect(straight?.quantity).toBe(4);
    expect(couplers?.quantity).toBe(3);
  });

  it('aggregates rows for multiple containments with the same product key', () => {
    // Two trunkings, same manufacturer & part number → straight pieces should sum
    const c1 = trunking('TR-A', [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ]);
    const c2 = trunking('TR-B', [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ]);
    const rows = generateContainmentBOM(buildProject([c1, c2]));
    const straight = rows.find((r) => r.description.startsWith('Straight length'));
    expect(straight).toBeDefined();
    // Each 3m run -> 1.05 stock = ceil to 2 pieces. Two runs -> 4 pieces.
    expect(straight?.quantity).toBe(4);
    // Both refs should be tracked
    expect(straight?.ref).toContain('TR-A');
    expect(straight?.ref).toContain('TR-B');
  });

  it('emits open-end caps for runs with no junctions to other containments', () => {
    const c = trunking('TR-1', [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ]);
    const rows = generateContainmentBOM(buildProject([c]));
    const endCaps = rows.find((r) => r.description.startsWith('End cap'));
    expect(endCaps).toBeDefined();
    expect(endCaps?.quantity).toBe(2);
  });
});
