import { describe, expect, it } from 'vitest';
import { routeFixture, routeProject } from '../../lib/__tests__/route-fixtures';
import { generateContainmentBOM } from '../containment-bom';
import { costEstimateToCSV, costEstimateToHTML, generateCostEstimate } from '../cost-estimate';

const riserProject = () =>
  routeProject(
    routeFixture('R', [
      { x: 0, y: 0, z: 2400 },
      { x: 3000, y: 0, z: 2400 },
      { x: 3000, y: 0, z: 1800 },
      { x: 6000, y: 0, z: 1800 },
    ]),
  );

describe('generateCostEstimate', () => {
  it('charges fitting labour for riser fittings', () => {
    const project = riserProject();
    const bom = generateContainmentBOM(project);
    const risers = bom
      .filter((r) => r.kind.includes('riser'))
      .reduce((a, r) => a + r.quantity, 0);
    expect(risers).toBeGreaterThan(0);
    const fittings = bom
      .filter((r) => r.unit === 'pcs' && /flat-bend|riser|tee|cross|coupler|end-cap/.test(r.kind))
      .reduce((a, r) => a + r.quantity, 0);
    const est = generateCostEstimate(project, { labourPerFitting: 1, hourlyRate: 1 });
    const line = est.lineItems.find((l) => l.description === 'Fitting installation');
    expect(line?.quantity).toBe(fittings);
  });

  it('warns about piece rows that are left out of the material total for lack of a price', () => {
    const est = generateCostEstimate(riserProject());
    expect(est.materialTotal).toBe(0);
    expect(est.warnings.length).toBeGreaterThan(0);
    expect(est.warnings.some((w) => w.includes('riser'))).toBe(true);
    expect(costEstimateToHTML(est, riserProject())).toContain('Not priced');
    expect(costEstimateToCSV(est, riserProject())).toContain('WARNING');
  });
});
