// A spreadsheet treats a cell that starts with one of these characters as a
// formula. Project text (tags, notes, names) can come from an imported file, so
// an exported cell is prefixed with a single quote to keep it as plain text.
// Plain numbers such as "-1.5" are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// Text that already begins with quotes before a formula character would be
// read back as an exporter prefix, so it gets one extra quote as well.
const QUOTED_FORMULA_START = /^'+[=+\-@\t\r]/;

export const neutralizeFormula = (s: string): string =>
  QUOTED_FORMULA_START.test(s) || (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s))
    ? `'${s}`
    : s;

// Inverse of neutralizeFormula for text the app itself exported: exactly one
// leading quote in front of (quotes and) a formula-looking start character is
// removed again so identifiers such as "-F1" survive a CSV export and re-import.
export const restoreFormula = (s: string): string =>
  QUOTED_FORMULA_START.test(s) ? s.slice(1) : s;

// Splits one simple comma-separated line and restores neutralised cells.
export const splitRestoredLine = (line: string): string[] =>
  line.split(',').map(restoreFormula);
