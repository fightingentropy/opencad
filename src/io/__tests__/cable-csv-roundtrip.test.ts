import { describe, expect, it } from 'vitest';
import { cablesFromCSV } from '../xlsx';

const HEADER = 'reference,description,from,to,cores,csa,notes';

describe('cablesFromCSV', () => {
  it('keeps quoted multi-line cells in one row, including lines starting with #', () => {
    const csv = [
      '# Units,mm',
      HEADER,
      'C-1,"two\nlines","A","B",3,2.5,"first\n# not a comment\nlast"',
      'C-2,,A,C,4,6,',
    ].join('\n');
    const r = cablesFromCSV(csv);
    expect(r.errors).toEqual([]);
    expect(r.cables).toHaveLength(2);
    expect(r.cables[0].description).toBe('two\nlines');
    expect(r.cables[0].notes).toBe('first\n# not a comment\nlast');
    expect(r.cables[1].reference).toBe('C-2');
  });

  it('rejects rows with non-numeric numeric fields instead of importing NaN', () => {
    const r = cablesFromCSV([HEADER, 'C-1,,A,B,abc,2.5,', 'C-2,,A,B,3,2.5,'].join('\n'));
    expect(r.cables.map((c) => c.reference)).toEqual(['C-2']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('cores');
  });
});
