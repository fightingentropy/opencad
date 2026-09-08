// Comprehensive containment BOM.
//
// For each ContainmentEntity we split the route length into stock-length
// pieces (default 3000 mm) with a 5% wastage allowance, count the
// fittings (every direction change in `points` is a flat-bend; tees and
// crosses are detected where containments meet; couplers join stock
// pieces; end-caps cap unconnected terminations) and the supports
// (horizontal sections only). Trunking also
// gets covers/lids by length. Rows are then aggregated by manufacturer +
// part number + size + material — one BOM row per unique product.

import type {
  Project,
  ContainmentEntity,
  ContainmentMaterial,
  Sheet,
} from '../types';
import { detectFittings } from '../lib/fittings';
import { distance3, equipmentPorts, routeLength, routePath } from '../lib/route-path';
import { placeSupportsForContainment } from '../lib/support-placer';
import { prependCSVExportMetadata } from './export-metadata';

export interface ContainmentBOMRow {
  ref: string;
  kind: string;
  manufacturer: string;
  partNumber: string;
  description: string;
  size: string;
  material: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  system: string;
  sheets: string[];
}

const STOCK_LENGTH_DEFAULT_MM = 3000;
const WASTAGE_FACTOR = 1.05;
// Build a stable BOM key for aggregation.
const bomKey = (parts: Array<string | number | undefined>): string =>
  parts.map((p) => (p ?? '').toString()).join('|');

const sizeLabel = (c: ContainmentEntity): string => {
  if (c.containmentType === 'conduit') return c.width ? `${c.width} mm Ø` : '';
  if (c.width && c.height) return `${c.width} × ${c.height} mm`;
  if (c.width) return `${c.width} mm`;
  return '';
};

const materialLabel = (m?: ContainmentMaterial): string => m ?? 'unspecified';

const productCost = (
  project: Project,
  manufacturer: string,
  partNumber: string,
): number => {
  if (!project.catalogues) return 0;
  for (const cat of Object.values(project.catalogues)) {
    for (const p of Object.values(cat.products)) {
      if (
        (manufacturer ? p.manufacturer === manufacturer : true) &&
        p.partNumber === partNumber
      ) {
        return p.unitCost ?? 0;
      }
    }
  }
  return 0;
};

const upsert = (
  rows: Map<string, ContainmentBOMRow>,
  key: string,
  row: ContainmentBOMRow,
  qty: number,
  sheetNumber?: string,
  sourceRef?: string,
): void => {
  const existing = rows.get(key);
  if (existing) {
    existing.quantity += qty;
    existing.totalCost = +(existing.unitCost * existing.quantity).toFixed(2);
    if (sheetNumber && !existing.sheets.includes(sheetNumber)) {
      existing.sheets.push(sheetNumber);
    }
    if (sourceRef && !existing.ref.includes(sourceRef)) {
      existing.ref = `${existing.ref}, ${sourceRef}`;
    }
  } else {
    row.quantity = qty;
    row.totalCost = +(row.unitCost * qty).toFixed(2);
    if (sheetNumber) row.sheets = [sheetNumber];
    rows.set(key, row);
  }
};

export const generateContainmentBOM = (
  project: Project,
  selectedIds?: ReadonlySet<string>,
): ContainmentBOMRow[] => {
  const containments: Array<{
    e: ContainmentEntity;
    sheet: Sheet;
  }> = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (e && e.kind === 'containment') {
        containments.push({ e: { ...e, points: routePath(e, project.floors?.[sheet.floorId ?? '']) }, sheet });
      }
    }
  }

  const rows = new Map<string, ContainmentBOMRow>();
  let auto = 1;

  for (const { e: c, sheet } of containments) {
    if (selectedIds && !selectedIds.has(c.id)) continue;
    const sheetNumber = sheet.number;
    const lengthMm = routeLength(c);
    if (lengthMm === 0) continue;
    const piecesNeeded = Math.ceil((lengthMm * WASTAGE_FACTOR) / STOCK_LENGTH_DEFAULT_MM);
    const lengthMetres = +(lengthMm / 1000).toFixed(3);
    const supports = placeSupportsForContainment(c).length;
    const neighbours = containments.filter(other => other.sheet.id === sheet.id && other.e.id !== c.id
      && other.e.containmentType === c.containmentType && other.e.width === c.width && other.e.height === c.height).map(other => other.e);
    const ports = Object.values(sheet.entities).flatMap(e => e.kind === 'equipment' ? equipmentPorts(e) : []);
    const counts = new Map<string, number>();
    const fittings = detectFittings(c, neighbours, { canOwnJunction: route => !selectedIds || selectedIds.has(route.id) });
    for (const fitting of fittings) {
      if (fitting.fittingKind === 'end-cap' && ports.some(port => distance3(port.position, { ...fitting.position, z: fitting.elevation }) < 10)) continue;
      counts.set(fitting.fittingKind, (counts.get(fitting.fittingKind) ?? 0) + 1);
    }

    const manufacturer = c.manufacturer ?? '';
    const partNumber = c.catalogPartNumber ?? '';
    const size = sizeLabel(c);
    const material = materialLabel(c.material);
    const ref = c.label ?? `CT-${String(auto++).padStart(3, '0')}`;
    const baseUnitCost = productCost(project, manufacturer, partNumber);
    const system = c.systemId ?? '';

    // 1) Straight stock pieces — ordered by length, billed per piece
    const straightKey = bomKey([
      'straight',
      c.containmentType,
      c.subType,
      manufacturer,
      partNumber,
      size,
      material,
    ]);
    upsert(
      rows,
      straightKey,
      {
        ref,
        kind: `${c.containmentType}${c.subType ? ` (${c.subType})` : ''}`,
        manufacturer,
        partNumber,
        description: `Straight length, ${size || c.containmentType}, ${material}`.trim(),
        size,
        material,
        unit: 'pcs',
        quantity: 0,
        unitCost: baseUnitCost,
        totalCost: 0,
        system,
        sheets: [],
      },
      piecesNeeded,
      sheetNumber,
      ref,
    );

    // 2) Linear metres of route — useful alternate billing
    const linearKey = bomKey([
      'linear',
      c.containmentType,
      c.subType,
      manufacturer,
      partNumber,
      size,
      material,
    ]);
    upsert(
      rows,
      linearKey,
      {
        ref,
        kind: `${c.containmentType} run`,
        manufacturer,
        partNumber,
        description: `Route length ${size || ''}`.trim(),
        size,
        material,
        unit: 'm',
        quantity: 0,
        unitCost: 0,
        totalCost: 0,
        system,
        sheets: [],
      },
      lengthMetres,
      sheetNumber,
      ref,
    );

    // 3) Fittings — flat bends, tees, crosses, couplers, end caps
    const fittingTypes: Array<{
      sub: string;
      desc: string;
      qty: number;
    }> = [
      { sub: 'flat-bend', desc: 'Flat bend', qty: counts.get('flat-bend') ?? 0 },
      { sub: 'inside-riser', desc: 'Inside vertical bend', qty: counts.get('inside-riser') ?? 0 },
      { sub: 'outside-riser', desc: 'Outside vertical bend', qty: counts.get('outside-riser') ?? 0 },
      { sub: 'tee', desc: 'Tee', qty: counts.get('tee') ?? 0 },
      { sub: 'cross', desc: 'Cross', qty: counts.get('cross') ?? 0 },
      { sub: 'coupler', desc: 'Coupler', qty: counts.get('coupler') ?? 0 },
      { sub: 'end-cap', desc: 'End cap', qty: counts.get('end-cap') ?? 0 },
    ];
    for (const f of fittingTypes) {
      if (f.qty <= 0) continue;
      const fkey = bomKey([
        'fitting',
        f.sub,
        c.containmentType,
        manufacturer,
        size,
        material,
      ]);
      upsert(
        rows,
        fkey,
        {
          ref,
          kind: `${c.containmentType} ${f.sub}`,
          manufacturer,
          partNumber: '',
          description: `${f.desc} for ${size || c.containmentType}, ${material}`.trim(),
          size,
          material,
          unit: 'pcs',
          quantity: 0,
          unitCost: 0,
          totalCost: 0,
          system,
          sheets: [],
        },
        f.qty,
        sheetNumber,
        ref,
      );
    }

    // 4) Supports — one row per containment kind/size/material
    const skey = bomKey([
      'support',
      c.containmentType,
      manufacturer,
      size,
      material,
    ]);
    if (supports > 0) upsert(
      rows,
      skey,
      {
        ref,
        kind: `${c.containmentType} support`,
        manufacturer,
        partNumber: '',
        description: `Horizontal bracket / hanger estimate for ${size || c.containmentType}`,
        size,
        material,
        unit: 'pcs',
        quantity: 0,
        unitCost: 0,
        totalCost: 0,
        system,
        sheets: [],
      },
      supports,
      sheetNumber,
      ref,
    );

    // 5) Trunking covers/lids — one piece per stock length
    if (c.containmentType === 'trunking') {
      const ckey = bomKey([
        'cover',
        c.containmentType,
        manufacturer,
        size,
        material,
      ]);
      upsert(
        rows,
        ckey,
        {
          ref,
          kind: `${c.containmentType} cover`,
          manufacturer,
          partNumber: '',
          description: `Cover / lid for ${size || c.containmentType}`,
          size,
          material,
          unit: 'pcs',
          quantity: 0,
          unitCost: 0,
          totalCost: 0,
          system,
          sheets: [],
        },
        piecesNeeded,
        sheetNumber,
        ref,
      );
    }
  }

  // Stable sort: containment kind, then size, then unit, then description.
  return Array.from(rows.values()).sort((a, b) => {
    return (
      a.kind.localeCompare(b.kind) ||
      a.size.localeCompare(b.size) ||
      a.unit.localeCompare(b.unit) ||
      a.description.localeCompare(b.description)
    );
  });
};

const csvEsc = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const containmentBOMToCSV = (
  rows: ContainmentBOMRow[],
  project: Project,
): string => {
  const header = [
    'Ref',
    'Kind',
    'Manufacturer',
    'PartNumber',
    'Description',
    'Size',
    'Material',
    'Unit',
    'Qty',
    'UnitCost',
    'TotalCost',
    'System',
    'Sheets',
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.ref,
      r.kind,
      r.manufacturer,
      r.partNumber,
      r.description,
      r.size,
      r.material,
      r.unit,
      r.quantity,
      r.unitCost.toFixed(2),
      r.totalCost.toFixed(2),
      r.system,
      r.sheets.join('|'),
    ]
      .map(csvEsc)
      .join(','),
  );
  return prependCSVExportMetadata(
    [header, ...lines].join('\n'),
    project,
    'containment-bom-csv',
  );
};
