// Excel-friendly tabular import/export. We don't ship an .xlsx writer
// (would need a 3rd-party dep) — these are TSV/CSV that paste cleanly
// into Excel and round-trip via spreadsheet save-as-CSV.

import type { Cable, CableId } from '../models/cable';
import type { BOMRow } from './bom';

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

export const cablesToCSV = (cables: Cable[]): string => {
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
  return rowsToCSV(rows);
};

const parseCSVLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
};

export interface CableImportResult {
  cables: Cable[];
  errors: string[];
}

const newId = (): CableId => `c-${Math.random().toString(36).slice(2, 10)}`;

export const cablesFromCSV = (text: string): CableImportResult => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { cables: [], errors: [] };
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const errors: string[] = [];
  const cables: Cable[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCSVLine(lines[li]);
    try {
      const c: Cable = {
        id: newId(),
        reference: cells[idx('reference')] ?? `C-${li}`,
        description: cells[idx('description')] || undefined,
        from: cells[idx('from')] ?? '',
        to: cells[idx('to')] ?? '',
        systemId: cells[idx('systemId')] || undefined,
        circuitType: (cells[idx('circuitType')] || 'power') as Cable['circuitType'],
        construction: (cells[idx('construction')] || 'XLPE/SWA/LSOH') as Cable['construction'],
        cores: Number(cells[idx('cores')] || 3),
        csa: Number(cells[idx('csa')] || 2.5),
        hasEarth: (cells[idx('hasEarth')] || 'Y').toUpperCase() === 'Y',
        earthCsa: cells[idx('earthCsa')] ? Number(cells[idx('earthCsa')]) : undefined,
        outerDiameter: Number(cells[idx('outerDiameter')] || 10),
        massPerMetre: cells[idx('massPerMetre')] ? Number(cells[idx('massPerMetre')]) : undefined,
        voltage: Number(cells[idx('voltage')] || 230),
        manufacturer: cells[idx('manufacturer')] || undefined,
        partNumber: cells[idx('partNumber')] || undefined,
        route: [],
        estimatedLength: cells[idx('estimatedLength')] ? Number(cells[idx('estimatedLength')]) : undefined,
        actualLength: cells[idx('actualLength')] ? Number(cells[idx('actualLength')]) : undefined,
        lengthAllowance: cells[idx('lengthAllowance')] ? Number(cells[idx('lengthAllowance')]) : undefined,
        designCurrent: cells[idx('designCurrent')] ? Number(cells[idx('designCurrent')]) : undefined,
        protectiveDevice: cells[idx('protectiveDevice')] || undefined,
        protectiveDeviceRating: cells[idx('protectiveDeviceRating')] ? Number(cells[idx('protectiveDeviceRating')]) : undefined,
        status: (cells[idx('status')] as Cable['status']) || undefined,
        notes: cells[idx('notes')] || undefined,
      };
      cables.push(c);
    } catch (err) {
      errors.push(`Line ${li + 1}: ${(err as Error).message}`);
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
export const bomToCSVExtended = (rows: BOMRow[]): string => {
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
  return rowsToCSV(out);
};

