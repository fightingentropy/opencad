import { describe, expect, it } from 'vitest';
import { cableVoltageDrop, estimateVdrop } from '../whole-site-helpers';
import { createEmptyProject } from '../../state/store';
import type { Cable } from '../../models/cable';

const cable = {
  id: 'c1',
  reference: 'C1',
  from: 'A',
  to: 'B',
  construction: 'XLPE/SWA/LSOH',
  cores: 3,
  csa: 4,
  hasEarth: true,
  outerDiameter: 12,
  voltage: 400,
  route: [],
  designCurrent: 20,
  status: 'design',
  systemId: 'lt',
} as unknown as Cable;

const systems = {
  lt: { id: 'lt', name: 'Lighting', kind: 'lighting', color: '#fc0' },
  pw: { id: 'pw', name: 'Power', kind: 'small-power', color: '#c00' },
} as const;

describe('cableVoltageDrop', () => {
  it('applies the lighting limit to a lighting cable and the general limit otherwise', () => {
    const light = cableVoltageDrop(cable, 50, 'BS7671', systems as never);
    const power = cableVoltageDrop({ ...cable, systemId: 'pw' }, 50, 'BS7671', systems as never);
    const unassigned = cableVoltageDrop(cable, 50, 'BS7671');
    expect(light.limitPct).toBeLessThan(power.limitPct);
    expect(unassigned.limitPct).toBe(power.limitPct);
    expect(light.vdropPct).toBeCloseTo(power.vdropPct, 9);
  });

  it('estimateVdrop agrees with it for a project', () => {
    const project = { ...createEmptyProject(), systems: systems as never };
    const r = estimateVdrop(cable, 50, project);
    expect(r.limit * 100).toBeCloseTo(cableVoltageDrop(cable, 50, 'BS7671', systems as never).limitPct, 9);
  });
});

describe('computeFill unknown status', () => {
  it('flags an unchecked fill as unknown instead of a failing 0%', async () => {
    const { computeFill } = await import('../whole-site-helpers');
    const cont = { id: 'k1', kind: 'containment', containmentType: 'tray', width: 0, points: [] } as never;
    const r = computeFill(cont, [cable]);
    expect(r.unknown).toBe(true);
    expect(r.ok).toBe(false);
    const ok = computeFill({ ...(cont as object), width: 200, height: 50 } as never, [cable]);
    expect(ok.unknown).toBe(false);
  });
});
