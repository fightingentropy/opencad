import { describe, expect, it, beforeEach } from 'vitest';
import { generateComplianceReport } from '../compliance-report';
import { supportSpanFor } from '../../calc/supports';
import { resetIds, makeContainment, makeProject, makeSupport } from '../../calc/__tests__/helpers';

const supportsLine = (containment: ReturnType<typeof makeContainment>, supportCount: number) => {
  const supports = Array.from({ length: supportCount }, () => makeSupport(containment.id));
  return generateComplianceReport(makeProject({ containments: [containment], supports })).supports;
};

describe('compliance report support spans', () => {
  beforeEach(resetIds);

  it('uses the next-larger width span for a basket between table widths', () => {
    // 450 mm sits between the 400 and 500 mm rows; the shared lookup picks 500 (1000 mm).
    const basket = makeContainment({
      containmentType: 'basket',
      width: 450,
      points: [{ x: 0, y: 0 }, { x: 2200, y: 0 }],
    });
    expect(supportSpanFor('basket', 450)).toBe(1000);
    // ceil(2200 / 1000) + 1 = 4 supports are needed, so 3 must fail.
    expect(supportsLine(basket, 3).fail).toBe(1);
    expect(supportsLine(basket, 4).pass).toBe(1);
  });

  it('treats a rigid-pvc conduit with no material as plastic', () => {
    const conduit = makeContainment({
      containmentType: 'conduit',
      subType: 'rigid-pvc',
      width: 20,
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
    });
    // Plastic 20 mm span is 750 mm: ceil(3000 / 750) + 1 = 5 supports.
    expect(supportsLine(conduit, 4).fail).toBe(1);
    expect(supportsLine(conduit, 5).pass).toBe(1);
  });
});
