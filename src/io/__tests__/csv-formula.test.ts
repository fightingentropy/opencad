import { describe, expect, it } from 'vitest';
import { neutralizeFormula } from '../csv-safe';
import { bomToCSV } from '../bom';
import { createEmptyProject } from '../../state/store';

describe('csv formula neutralisation', () => {
  it('prefixes formula-looking text but not plain numbers', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('+cmd')).toBe("'+cmd");
    expect(neutralizeFormula('-x')).toBe("'-x");
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormula('-1.50')).toBe('-1.50');
    expect(neutralizeFormula('Panel A')).toBe('Panel A');
  });

  it('applies to exported cells', () => {
    const csv = bomToCSV(
      [{ tag: '=HYPERLINK("x")', name: 'n', description: '', manufacturer: '', partNumber: '', rating: '', quantity: 1, category: 'c', sheetNumbers: [1] } as never],
      createEmptyProject(),
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
