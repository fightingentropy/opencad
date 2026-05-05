import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSegregation,
  checkContainmentPairSeparation,
} from '../segregation';
import { resetIds, makeContainment, makeCable } from './helpers';

describe('checkSegregation', () => {
  beforeEach(resetIds);

  it('reports no violations for a power-only cable list', () => {
    const c = makeContainment({ containmentType: 'tray' });
    const cables = [
      makeCable({ circuitType: 'power' }),
      makeCable({ circuitType: 'power', reference: 'C-002' }),
    ];
    const r = checkSegregation(c, cables);
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('flags power + data without partition as data-power-mixed error', () => {
    const c = makeContainment({ containmentType: 'tray' });
    const cables = [
      makeCable({ circuitType: 'power' }),
      makeCable({ circuitType: 'data', reference: 'C-002' }),
    ];
    const r = checkSegregation(c, cables);
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.kind === 'data-power-mixed');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('error');
  });

  it('allows power + data when compartments >= 2', () => {
    const c = makeContainment({
      containmentType: 'trunking',
      compartments: 2,
    });
    const cables = [
      makeCable({ circuitType: 'power' }),
      makeCable({ circuitType: 'data', reference: 'C-002' }),
    ];
    const r = checkSegregation(c, cables);
    expect(r.ok).toBe(true);
    expect(r.violations.filter((v) => v.kind === 'data-power-mixed')).toHaveLength(0);
  });

  it('flags fire-alarm sharing containment without partition', () => {
    const c = makeContainment({ containmentType: 'tray' });
    const cables = [
      makeCable({ circuitType: 'power' }),
      makeCable({ circuitType: 'fire-alarm', reference: 'FA-001' }),
    ];
    const r = checkSegregation(c, cables);
    const fire = r.violations.find((v) => v.kind === 'fire-alarm-shared');
    expect(fire).toBeDefined();
    expect(fire?.severity).toBe('error');
    expect(r.ok).toBe(false);
  });

  it('flags emergency cables sharing containment as a warning', () => {
    const c = makeContainment({ containmentType: 'tray' });
    const cables = [
      makeCable({ circuitType: 'power' }),
      makeCable({ circuitType: 'emergency', reference: 'EM-001' }),
    ];
    const r = checkSegregation(c, cables);
    const em = r.violations.find((v) => v.kind === 'emergency-shared');
    expect(em).toBeDefined();
    expect(em?.severity).toBe('warning');
    // Warnings don't block ok
    expect(r.ok).toBe(true);
  });

  it('warns when a cable runs through containment of a different declared category', () => {
    const c = makeContainment({
      containmentType: 'tray',
      cableCategory: 'data',
    });
    const cables = [makeCable({ circuitType: 'power', reference: 'PW-1' })];
    const r = checkSegregation(c, cables);
    expect(r.violations.some((v) => v.kind === 'partition-required')).toBe(true);
  });
});

describe('checkContainmentPairSeparation', () => {
  beforeEach(resetIds);

  it('passes when power and data trays are 50mm apart', () => {
    const a = makeContainment({ cableCategory: 'power', containmentType: 'tray' });
    const b = makeContainment({ cableCategory: 'data', containmentType: 'tray' });
    const r = checkContainmentPairSeparation(a, b, 50);
    expect(r.required).toBe(50);
    expect(r.ok).toBe(true);
  });

  it('fails when power and data trays are only 30mm apart', () => {
    const a = makeContainment({ cableCategory: 'power', containmentType: 'tray' });
    const b = makeContainment({ cableCategory: 'data', containmentType: 'tray' });
    const r = checkContainmentPairSeparation(a, b, 30);
    expect(r.required).toBe(50);
    expect(r.ok).toBe(false);
  });

  it('returns 0 required when both categories are mixed/undefined', () => {
    const a = makeContainment({ containmentType: 'tray' });
    const b = makeContainment({ containmentType: 'tray' });
    const r = checkContainmentPairSeparation(a, b, 0);
    expect(r.required).toBe(0);
    expect(r.ok).toBe(true);
  });
});
