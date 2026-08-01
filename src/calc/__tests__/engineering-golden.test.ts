import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/engineering-golden.json';
import { suggestCableSize, type CableSizingOptions } from '../cable-sizing';
import { computeDeratedCurrent, type DeratingOptions } from '../derating';
import { computeVoltageDrop, type VoltageDropOptions } from '../voltage-drop';
import { checkProtectiveDeviceCoordination } from '../protective-device';

describe('independently authored engineering golden fixtures', () => {
  it('matches the cable-sizing fixture', () => {
    const result = suggestCableSize(fixture.cableSizing.input as CableSizingOptions);
    expect(result).toMatchObject(fixture.cableSizing.expected);
  });

  it('matches the grouping and ambient derating fixture', () => {
    const { baseAmpacityA, ...input } = fixture.derating.input;
    const result = computeDeratedCurrent(baseAmpacityA, input as DeratingOptions);
    expect(result.Cg).toBe(fixture.derating.expected.Cg);
    expect(result.Ca).toBe(fixture.derating.expected.Ca);
    expect(result.totalFactor).toBeCloseTo(fixture.derating.expected.totalFactor, 8);
    expect(result.deratedCurrent).toBeCloseTo(fixture.derating.expected.deratedCurrent, 8);
  });

  it('matches the voltage-drop fixture', () => {
    const result = computeVoltageDrop(fixture.voltageDrop.input as VoltageDropOptions);
    expect(result.mvAm).toBe(fixture.voltageDrop.expected.mvAm);
    expect(result.vdropV).toBeCloseTo(fixture.voltageDrop.expected.vdropV, 8);
    expect(result.vdropPct).toBeCloseTo(fixture.voltageDrop.expected.vdropPct, 8);
    expect(result.withinLimits).toBe(fixture.voltageDrop.expected.withinLimits);
  });

  it('matches the protective-device coordination fixture', () => {
    const result = checkProtectiveDeviceCoordination(fixture.protectiveDevice.input);
    expect(result).toMatchObject({
      loadProtected: fixture.protectiveDevice.expected.loadProtected,
      cableProtected: fixture.protectiveDevice.expected.cableProtected,
      thermalProtected: fixture.protectiveDevice.expected.thermalProtected,
      ok: fixture.protectiveDevice.expected.ok,
      inequalities: { thermalLimit: fixture.protectiveDevice.expected.thermalLimit },
    });
  });
});
