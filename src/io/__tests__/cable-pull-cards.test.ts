import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, Project, Sheet } from '../../types';
import type { Cable } from '../../models/cable';
import { generateCablePullCards } from '../cable-pull-cards';

const run = (id: string, points: Array<{ x: number; y: number; z?: number }>): ContainmentEntity =>
  ({
    id,
    kind: 'containment',
    layerId: 'L',
    visible: true,
    locked: false,
    containmentType: 'tray',
    width: 100,
    height: 50,
    points,
    label: id,
  }) as ContainmentEntity;

const projectWith = (runs: ContainmentEntity[]): Project => {
  const sheet: Sheet = {
    id: 's1',
    name: 'S',
    number: 'F-1',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities: Object.fromEntries(runs.map((r) => [r.id, r])),
    entityOrder: runs.map((r) => r.id),
  };
  const cable = {
    id: 'c1',
    reference: 'C-1',
    from: 'A',
    to: 'B',
    circuitType: 'power',
    construction: 'SWA',
    cores: 3,
    csa: 4,
    hasEarth: true,
    outerDiameter: 15,
    massPerMetre: 1,
    voltage: 400,
    route: runs.map((r) => r.id),
  } as unknown as Cable;
  return {
    id: 'p',
    name: 'P',
    created: 0,
    modified: 0,
    layers: {},
    layerOrder: [],
    sheets: { s1: sheet },
    sheetOrder: ['s1'],
    activeSheetId: 's1',
    activeLayerId: 'L',
    units: 'mm',
    standard: 'IEC',
    cableSchedule: { cables: { c1: cable }, cableOrder: ['c1'] },
  } as unknown as Project;
};

describe('generateCablePullCards', () => {
  it('counts the vertical leg of a riser in the length', () => {
    const [card] = generateCablePullCards(
      projectWith([
        run('R', [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 3000 },
        ]),
      ]),
    );
    expect(card.totalLengthM).toBeCloseTo(3, 2);
    expect(card.segments[0].lengthM).toBeCloseTo(3, 2);
  });

  it('scales the bend factor by the deflection angle', () => {
    const tension = (pts: Array<{ x: number; y: number; z?: number }>) =>
      generateCablePullCards(projectWith([run('R', pts)]))[0].estimatedTensionN;
    const straight = tension([
      { x: 0, y: 0, z: 0 },
      { x: 5000, y: 0, z: 0 },
      { x: 10000, y: 0, z: 0 },
    ]);
    const kink = tension([
      { x: 0, y: 0, z: 0 },
      { x: 5000, y: 0, z: 0 },
      { x: 10000, y: 437, z: 0 }, // about 5 degrees
    ]);
    const right = tension([
      { x: 0, y: 0, z: 0 },
      { x: 5000, y: 0, z: 0 },
      { x: 5000, y: 5000, z: 0 },
    ]);
    expect(kink).toBeGreaterThanOrEqual(straight);
    expect(kink / straight).toBeLessThan(1.1);
    expect(right / straight).toBeGreaterThan(1.4);
  });
});
