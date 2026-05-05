import { describe, it, expect, beforeEach } from 'vitest';
import { suggestContainmentSize, standardSizesFor } from '../containment-sizing';
import { resetIds, makeCable, bs7671 } from './helpers';

describe('suggestContainmentSize', () => {
  beforeEach(resetIds);

  it('returns the smallest size for an empty cable list', () => {
    const r = suggestContainmentSize([], 'tray', bs7671);
    const sizes = standardSizesFor('tray');
    expect(r.ok).toBe(true);
    expect(r.width).toBe(sizes[0].width);
    expect(r.height).toBe(sizes[0].height);
  });

  it('returns a viable size from STANDARD_SIZES for 4× 12mm OD cables at 0.4 fill target', () => {
    const cables = Array.from({ length: 4 }, () =>
      makeCable({ csa: 2.5, outerDiameter: 12 }),
    );
    const r = suggestContainmentSize(cables, 'trunking', bs7671, 0.4);
    expect(r.ok).toBe(true);
    expect(r.fillPct / 100).toBeLessThanOrEqual(0.4);
    // The picked size should appear in the standard catalogue.
    const sizes = standardSizesFor('trunking');
    expect(
      sizes.some((s) => s.width === r.width && s.height === r.height),
    ).toBe(true);
  });

  it('returns ok: false when bundle exceeds the largest standard size', () => {
    // 200 cables of OD 50mm => occupied area massive
    const cables = Array.from({ length: 200 }, () =>
      makeCable({ outerDiameter: 50 }),
    );
    const r = suggestContainmentSize(cables, 'trunking', bs7671);
    expect(r.ok).toBe(false);
    const sizes = standardSizesFor('trunking');
    const last = sizes[sizes.length - 1];
    expect(r.width).toBe(last.width);
    expect(r.height).toBe(last.height);
  });

  it('respects the BS 7671 conduit limit when no override is supplied', () => {
    const cables = Array.from({ length: 3 }, () =>
      makeCable({ outerDiameter: 8 }),
    );
    const r = suggestContainmentSize(cables, 'conduit', bs7671);
    // Limit for conduit under BS7671 is 0.40
    expect(r.fillPct / 100).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it('honours fillTargetOverride when stricter than the standards limit', () => {
    const cables = Array.from({ length: 6 }, () =>
      makeCable({ outerDiameter: 10 }),
    );
    const r = suggestContainmentSize(cables, 'trunking', bs7671, 0.2);
    if (r.ok) {
      expect(r.fillPct / 100).toBeLessThanOrEqual(0.2 + 1e-6);
    }
  });
});
