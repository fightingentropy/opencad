import { describe, it, expect } from 'vitest';
import { cablesByContainment } from '../route-index';
import { estimateCableAmpacity } from '../cable-sizing';
import type { Cable } from '../../models/cable';

const cable = (id: string, route: string[]): Cable =>
  ({ id, reference: id, csa: 2.5, construction: 'PVC/PVC', route }) as unknown as Cable;

describe('cablesByContainment', () => {
  const cables = {
    a: cable('a', ['c1', 'c2', 'c1']),
    b: cable('b', ['c2']),
    c: cable('c', []),
  };

  it('lists each cable once per containment on its route', () => {
    const idx = cablesByContainment(cables);
    expect(idx.get('c1')?.map((c) => c.id)).toEqual(['a']);
    expect(idx.get('c2')?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(idx.has('c3')).toBe(false);
  });

  it('is reused for the same cables record and rebuilt for a new one', () => {
    expect(cablesByContainment(cables)).toBe(cablesByContainment(cables));
    expect(cablesByContainment({ ...cables })).not.toBe(cablesByContainment(cables));
  });

  it('gives estimateCableAmpacity the same result as a full scan', () => {
    const list = Object.values(cables);
    const idx = cablesByContainment(cables);
    for (const c of list) {
      expect(estimateCableAmpacity(c, list, idx)).toBe(estimateCableAmpacity(c, list));
    }
  });
});
