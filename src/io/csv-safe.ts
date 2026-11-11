// A spreadsheet treats a cell that starts with one of these characters as a
// formula. Project text (tags, notes, names) can come from an imported file, so
// an exported cell is prefixed with a single quote to keep it as plain text.
// Plain numbers such as "-1.5" are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export const neutralizeFormula = (s: string): string =>
  FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;

// Inverse of neutralizeFormula for text the app itself exported: a leading
// quote added in front of a formula-looking start character is removed again
// so identifiers such as "-F1" survive a CSV export and re-import.
export const restoreFormula = (s: string): string =>
  /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
