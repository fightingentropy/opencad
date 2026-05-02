import type { Project, SymbolEntity } from '../types';
import { getSymbol } from '../symbols';

export interface BOMRow {
  tag: string;
  name: string;
  description: string;
  manufacturer: string;
  partNumber: string;
  rating: string;
  quantity: number;
  category: string;
  sheetNumbers: string[];
}

export const generateBOM = (project: Project): BOMRow[] => {
  // Aggregate by part number + name
  const map = new Map<string, BOMRow>();

  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e || e.kind !== 'symbol') continue;
      const sym = e as SymbolEntity;
      const def = getSymbol(sym.symbolId);
      if (!def) continue;
      const key = `${sym.partNumber || ''}::${def.name}::${sym.rating || ''}`;
      const tag = sym.tag || (def.tagPrefix ? `${def.tagPrefix}?` : '?');
      const existing = map.get(key);
      if (existing) {
        existing.quantity++;
        if (!existing.sheetNumbers.includes(sheet.number)) {
          existing.sheetNumbers.push(sheet.number);
        }
      } else {
        map.set(key, {
          tag,
          name: def.name,
          description: sym.description || def.description || '',
          manufacturer: sym.manufacturer || '',
          partNumber: sym.partNumber || '',
          rating: sym.rating || '',
          quantity: 1,
          category: def.category,
          sheetNumbers: [sheet.number],
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
};

export const bomToCSV = (rows: BOMRow[]): string => {
  const header = 'Tag,Name,Description,Manufacturer,Part Number,Rating,Qty,Category,Sheets';
  const lines = rows.map((r) =>
    [r.tag, r.name, r.description, r.manufacturer, r.partNumber, r.rating, r.quantity, r.category, r.sheetNumbers.join('|')]
      .map(csvEsc).join(',')
  );
  return [header, ...lines].join('\n');
};

const csvEsc = (v: any): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};
