// Excel-friendly tabular import/export. We don't ship an .xlsx writer
// (would need a 3rd-party dep) — these are TSV/CSV that paste cleanly
// into Excel and round-trip via spreadsheet save-as-CSV.

import type { Cable, CableId } from '../models/cable';
import type { Project } from '../types';
import type { BOMRow } from './bom';
import { assertImportTextLimits, IMPORT_LIMITS, ImportLimitError } from './import-limits';
import { prependCSVExportMetadata } from './export-metadata';

const csvEscape = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const rowsToCSV = (rows: unknown[][]): string =>
  rows.map((r) => r.map(csvEscape).join(',')).join('\n');

const rowsToTSV = (rows: unknown[][]): string =>
  rows.map((r) => r.map((v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');

const CABLE_HEADERS = [
  'reference', 'description', 'from', 'to', 'systemId', 'circuitType',
  'construction', 'cores', 'csa', 'hasEarth', 'earthCsa',
  'outerDiameter', 'massPerMetre', 'voltage',
  'manufacturer', 'partNumber',
  'estimatedLength', 'actualLength', 'lengthAllowance',
  'designCurrent', 'protectiveDevice', 'protectiveDeviceRating',
  'status', 'notes',
];

export const cablesToCSV = (cables: Cable[], project: Project): string => {
  const rows: unknown[][] = [CABLE_HEADERS];
  for (const c of cables) {
    rows.push([
      c.reference, c.description ?? '', c.from, c.to,
      c.systemId ?? '', c.circuitType,
      c.construction, c.cores, c.csa, c.hasEarth ? 'Y' : 'N', c.earthCsa ?? '',
      c.outerDiameter, c.massPerMetre ?? '', c.voltage,
      c.manufacturer ?? '', c.partNumber ?? '',
      c.estimatedLength ?? '', c.actualLength ?? '', c.lengthAllowance ?? '',
      c.designCurrent ?? '', c.protectiveDevice ?? '', c.protectiveDeviceRating ?? '',
      c.status ?? '', c.notes ?? '',
    ]);
  }
  return prependCSVExportMetadata(
    rowsToCSV(rows),
    project,
    'cable-register-csv',
  );
};

// Quote-aware CSV tokenizer: scans the whole text so quoted cells may
// contain newlines. A row whose first character is '#' (outside quotes)
// is an export-metadata comment and is skipped; blank rows are skipped.
const parseCSV = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let rowStart = true;
  const endRow = () => {
    row.push(cur);
    cur = '';
    if (row.length > 1 || row[0].trim().length > 0) rows.push(row);
    row = [];
    rowStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
      continue;
    }
    if (rowStart && ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') { endRow(); continue; }
    if (rowStart && (ch === ' ' || ch === '\t')) {
      // Leading whitespace before a possible '#' comment marker.
      let j = i;
      while (text[j] === ' ' || text[j] === '\t') j++;
      if (text[j] === '#') { i = j - 1; continue; }
    }
    rowStart = false;
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cur);
      if (row.length > 128) throw new ImportLimitError('Cable CSV', 'more than 128 columns');
      cur = '';
    }
    else cur += ch;
  }
  if (cur.length > 0 || row.length > 0) endRow();
  return rows;
};

export interface CableImportResult {
  cables: Cable[];
  errors: string[];
}

const newId = (): CableId => `c-${Math.random().toString(36).slice(2, 10)}`;

export const cablesFromCSV = (text: string): CableImportResult => {
  assertImportTextLimits(text, 'Cable CSV', IMPORT_LIMITS.cableCsv);
  const rows = parseCSV(text);
  if (rows.length === 0) return { cables: [], errors: [] };
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const errors: string[] = [];
  const cables: Cable[] = [];
  for (let li = 1; li < rows.length; li++) {
    const cells = rows[li];
    try {
      const num = (name: string, fallback?: number): number | undefined => {
        const raw = (cells[idx(name)] ?? '').trim();
        if (raw === '') return fallback;
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error(`${name} "${raw}" is not a number`);
        return n;
      };
      const c: Cable = {
        id: newId(),
        reference: cells[idx('reference')] ?? `C-${li}`,
        description: cells[idx('description')] || undefined,
        from: cells[idx('from')] ?? '',
        to: cells[idx('to')] ?? '',
        systemId: cells[idx('systemId')] || undefined,
        circuitType: (cells[idx('circuitType')] || 'power') as Cable['circuitType'],
        construction: (cells[idx('construction')] || 'XLPE/SWA/LSOH') as Cable['construction'],
        cores: num('cores', 3) as number,
        csa: num('csa', 2.5) as number,
        hasEarth: (cells[idx('hasEarth')] || 'Y').toUpperCase() === 'Y',
        earthCsa: num('earthCsa'),
        outerDiameter: num('outerDiameter', 10) as number,
        massPerMetre: num('massPerMetre'),
        voltage: num('voltage', 230) as number,
        manufacturer: cells[idx('manufacturer')] || undefined,
        partNumber: cells[idx('partNumber')] || undefined,
        route: [],
        estimatedLength: num('estimatedLength'),
        actualLength: num('actualLength'),
        lengthAllowance: num('lengthAllowance'),
        designCurrent: num('designCurrent'),
        protectiveDevice: cells[idx('protectiveDevice')] || undefined,
        protectiveDeviceRating: num('protectiveDeviceRating'),
        status: (cells[idx('status')] as Cable['status']) || undefined,
        notes: cells[idx('notes')] || undefined,
      };
      cables.push(c);
    } catch (err) {
      errors.push(`Row ${li + 1}: ${(err as Error).message}`);
    }
  }
  return { cables, errors };
};

export const tabSeparated = (rows: unknown[][]): string => rowsToTSV(rows);
export { rowsToCSV };

// Extended BOM CSV — adds a sheet count column and a per-line cost
// estimate column on top of the legacy bom.ts schema (the existing
// bomToCSV is preserved unchanged so callers that depend on its
// columns keep working).
export const bomToCSVExtended = (rows: BOMRow[], project: Project): string => {
  const header = [
    'Tag',
    'Name',
    'Description',
    'Manufacturer',
    'PartNumber',
    'Rating',
    'Qty',
    'Category',
    'SheetCount',
    'Sheets',
  ];
  const out: unknown[][] = [header];
  for (const r of rows) {
    out.push([
      r.tag,
      r.name,
      r.description,
      r.manufacturer,
      r.partNumber,
      r.rating,
      r.quantity,
      r.category,
      r.sheetNumbers.length,
      r.sheetNumbers.join('|'),
    ]);
  }
  return prependCSVExportMetadata(
    rowsToCSV(out),
    project,
    'extended-symbol-bom-csv',
  );
};
