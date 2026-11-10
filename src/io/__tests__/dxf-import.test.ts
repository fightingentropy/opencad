import { describe, expect, it } from 'vitest';
import { parseDXFWithWarnings } from '../dxf-import';

const dxf = (entities: string[][], opts: { units?: number; blocks?: string[][] } = {}): string => {
  const pairs: Array<[number, string | number]> = [];
  if (opts.units !== undefined) pairs.push([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, opts.units], [0, 'ENDSEC']);
  if (opts.blocks) {
    pairs.push([0, 'SECTION'], [2, 'BLOCKS']);
    for (const b of opts.blocks) pairs.push(...(b.map((l) => l.split(' ')).map(([c, ...v]) => [Number(c), v.join(' ')]) as Array<[number, string]>));
    pairs.push([0, 'ENDSEC']);
  }
  pairs.push([0, 'SECTION'], [2, 'ENTITIES']);
  for (const e of entities) pairs.push(...(e.map((l) => l.split(' ')).map(([c, ...v]) => [Number(c), v.join(' ')]) as Array<[number, string]>));
  pairs.push([0, 'ENDSEC'], [0, 'EOF']);
  return pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
};

const line = (x1: number, y1: number, x2: number, y2: number): string[] => [
  '0 LINE', `10 ${x1}`, `20 ${y1}`, `11 ${x2}`, `21 ${y2}`,
];

describe('DXF import', () => {
  it('tessellates LWPOLYLINE bulges into arcs instead of straight chords', () => {
    // Semicircle from (0,0) to (10,0), bulge 1: bulges to y = -5 or +5.
    const { underlay } = parseDXFWithWarnings(
      dxf([['0 LWPOLYLINE', '90 2', '70 0', '10 0', '20 0', '42 1', '10 10', '20 0']], { units: 4 }),
    );
    expect(underlay.vectors!.length).toBeGreaterThan(8);
    expect(underlay.height).toBeCloseTo(5, 1);
    const ys = underlay.vectors!.flatMap((v) => [v.a.y, v.b.y]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(5, 1);
  });

  it('expands block inserts with position, scale and rotation', () => {
    const { underlay, warnings } = parseDXFWithWarnings(
      dxf(
        [['0 INSERT', '2 B', '10 100', '20 200', '41 2', '42 2', '50 90']],
        { units: 4, blocks: [['0 BLOCK', '2 B', '10 0', '20 0', ...line(0, 0, 10, 0), '0 ENDBLK']] },
      ),
    );
    expect(warnings).toEqual([]);
    expect(underlay.vectors).toHaveLength(1);
    // (0,0)->(10,0) scaled x2 -> (20,0), rotated 90deg -> (0,20), moved to (100,200)
    expect(underlay.origin).toEqual({ x: 100, y: 200 });
    expect(underlay.height).toBeCloseTo(20, 5);
    expect(underlay.width).toBe(1);
  });

  it('maps miles and kilometres and reports skipped geometry and assumed units', () => {
    const km = parseDXFWithWarnings(dxf([line(0, 0, 1, 0)], { units: 7 }));
    expect(km.underlay.width).toBeCloseTo(1_000_000, 0);
    const mi = parseDXFWithWarnings(dxf([line(0, 0, 1, 0)], { units: 3 }));
    expect(mi.underlay.width).toBeCloseTo(1_609_344, 0);

    const r = parseDXFWithWarnings(
      dxf([line(0, 0, 1, 0), ['0 SPLINE', '10 0', '20 0'], ['0 INSERT', '2 MISSING', '10 0', '20 0']]),
    );
    expect(r.warnings.join('\n')).toContain('INSUNITS');
    expect(r.warnings.join('\n')).toMatch(/1 unsupported SPLINE/);
    expect(r.warnings.join('\n')).toMatch(/undefined block/);
  });
});
