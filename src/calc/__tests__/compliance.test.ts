import { describe, it, expect, beforeEach } from 'vitest';
import { runComplianceChecks } from '../compliance';
import { resetIds, makeContainment, makeCable, makeProject } from './helpers';

describe('runComplianceChecks', () => {
  beforeEach(resetIds);

  it('returns zero issues for an empty project', () => {
    const project = makeProject();
    const r = runComplianceChecks(project);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.totalChecks).toBe(0);
    expect(r.containmentCount).toBe(0);
    expect(r.cableCount).toBe(0);
  });

  it('flags one fill error for an over-fill containment', () => {
    const c = makeContainment({
      containmentType: 'trunking',
      width: 25,
      height: 25,
    });
    const cables = Array.from({ length: 5 }, (_, i) =>
      makeCable({
        csa: 16,
        cores: 2,
        outerDiameter: 18,
        reference: `C-${i}`,
        route: [c.id],
      }),
    );
    const project = makeProject({ containments: [c], cables });
    const r = runComplianceChecks(project);
    const fillIssues = r.issues.filter((i) => i.kind === 'fill');
    expect(fillIssues.length).toBe(1);
    expect(fillIssues[0].severity).toBe('error');
    expect(r.byKind.fill).toBe(1);
    expect(r.errors).toBeGreaterThanOrEqual(1);
  });

  it('returns the right shape with totalChecks, byKind, generatedAt populated', () => {
    const c = makeContainment({ containmentType: 'tray', width: 200 });
    const cable = makeCable({ route: [c.id] });
    const project = makeProject({ containments: [c], cables: [cable] });
    const r = runComplianceChecks(project);
    expect(r).toHaveProperty('totalChecks');
    expect(r).toHaveProperty('passed');
    expect(r).toHaveProperty('warnings');
    expect(r).toHaveProperty('errors');
    expect(r).toHaveProperty('byKind');
    expect(r).toHaveProperty('issues');
    expect(r).toHaveProperty('containmentCount', 1);
    expect(r).toHaveProperty('cableCount', 1);
    expect(r).toHaveProperty('averageFillPct');
    expect(r.byKind).toHaveProperty('fill', 0);
    expect(r.byKind).toHaveProperty('segregation');
    expect(r.byKind).toHaveProperty('voltage-drop');
    expect(typeof r.generatedAt).toBe('number');
  });

  it('reports a voltage-drop error when a cable exceeds the limit', () => {
    const c = makeContainment({ containmentType: 'tray', width: 200 });
    // 1.5mm² PVC SP, 16A, 100m, 230V => 29*16*100/1000 = 46.4V => 20.2%
    const cable = makeCable({
      csa: 1.5,
      cores: 2,
      construction: 'PVC/PVC',
      voltage: 230,
      designCurrent: 16,
      estimatedLength: 100,
      route: [c.id],
    });
    const project = makeProject({ containments: [c], cables: [cable] });
    const r = runComplianceChecks(project);
    const vd = r.issues.filter((i) => i.kind === 'voltage-drop');
    expect(vd.length).toBe(1);
    expect(vd[0].severity).toBe('error');
  });

  it('reports a segregation error when power and data share an unpartitioned tray', () => {
    const c = makeContainment({ containmentType: 'tray', width: 300 });
    const power = makeCable({ circuitType: 'power', route: [c.id], reference: 'PW-1' });
    const data = makeCable({ circuitType: 'data', route: [c.id], reference: 'DT-1' });
    const project = makeProject({ containments: [c], cables: [power, data] });
    const r = runComplianceChecks(project);
    const seg = r.issues.filter((i) => i.kind === 'segregation');
    expect(seg.length).toBeGreaterThanOrEqual(1);
    expect(r.errors).toBeGreaterThanOrEqual(1);
  });

  it('computes averageFillPct across containments that have cables routed', () => {
    const c1 = makeContainment({ containmentType: 'tray', width: 200 });
    const c2 = makeContainment({ containmentType: 'tray', width: 200 });
    const cab1 = makeCable({ route: [c1.id], reference: 'A' });
    const cab2 = makeCable({ route: [c2.id], reference: 'B' });
    const project = makeProject({
      containments: [c1, c2],
      cables: [cab1, cab2],
    });
    const r = runComplianceChecks(project);
    expect(r.averageFillPct).toBeGreaterThan(0);
  });
});
