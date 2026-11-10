import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, Project, Sheet } from '../../types';
import type { Cable } from '../../models/cable';
import { DEFAULT_STANDARDS } from '../../models/standards';
import { computeContainmentFill } from '../../calc/fill';
import { containmentScheduleToCSV, exportContainmentSchedule } from '../containment-schedule';

const trunking = {
  id: 't1',
  kind: 'containment',
  layerId: 'L',
  visible: true,
  locked: false,
  containmentType: 'trunking',
  width: 100,
  height: 50,
  points: [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
  ],
  label: 'T-1',
} as ContainmentEntity;

const cable = (id: string): Cable =>
  ({
    id,
    reference: id,
    from: 'A',
    to: 'B',
    circuitType: 'power',
    construction: 'PVC',
    cores: 1,
    csa: 2.5,
    hasEarth: false,
    outerDiameter: 5,
    voltage: 230,
    route: ['t1'],
  }) as unknown as Cable;

const project = (): Project => {
  const sheet = {
    id: 's1',
    name: 'S',
    number: 'F-1',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities: { t1: trunking },
    entityOrder: ['t1'],
  } as Sheet;
  const cables = Array.from({ length: 20 }, (_, i) => cable(`c${i}`));
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
    standardsProfile: DEFAULT_STANDARDS.BS7671,
    cableSchedule: {
      cables: Object.fromEntries(cables.map((c) => [c.id, c])),
      cableOrder: cables.map((c) => c.id),
    },
  } as unknown as Project;
};

describe('containment schedule fill', () => {
  it('reports the same fill and status as the compliance fill calculation', () => {
    const p = project();
    const expected = computeContainmentFill(
      trunking,
      Object.values(p.cableSchedule!.cables),
      DEFAULT_STANDARDS.BS7671,
    );
    const [row] = exportContainmentSchedule(p);
    expect(row.fillPct).toBeCloseTo(expected.fillPct, 1);
    expect(row.fillStatus).toBe(expected.fillStatus);
    expect(containmentScheduleToCSV([row], p)).toContain(expected.fillStatus);
  });
});
