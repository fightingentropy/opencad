// Comprehensive containment BOM.
//
// For each ContainmentEntity we split the route length into stock-length
// pieces (default 3000 mm) with a 5% wastage allowance, count the
// fittings (every direction change in `points` is a flat-bend; tees and
// crosses are detected where containments meet; couplers join stock
// pieces; end-caps cap unconnected terminations) and the supports
// (length / max span from SUPPORT_SPANS_HORIZONTAL_MM). Trunking also
// gets covers/lids by length. Rows are then aggregated by manufacturer +
// part number + size + material — one BOM row per unique product.

import type {
  Project,
  ContainmentEntity,
  ContainmentMaterial,
  Vec2,
  EntityId,
} from '../types';
import { dist } from '../lib/math';
import { SUPPORT_SPANS_HORIZONTAL_MM } from '../models/standards';

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
const ENDPOINT_TOLERANCE_MM = 5;

interface RouteMetrics {
  lengthMm: number;
  bends: number;
  segments: number;
}

const routeLengthMm = (points: Vec2[]): number => {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
};

const directionChanges = (points: Vec2[]): number => {
  if (points.length < 3) return 0;
  let count = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    // Cross product magnitude — non-zero means direction changed
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) > 1e-3) count++;
  }
  return count;
};

const computeMetrics = (points: Vec2[]): RouteMetrics => ({
  lengthMm: routeLengthMm(points),
  bends: directionChanges(points),
  segments: Math.max(0, points.length - 1),
});

// Approximate max support span for a containment based on its kind/width.
const supportSpanMm = (c: ContainmentEntity): number => {
  const spans = SUPPORT_SPANS_HORIZONTAL_MM as Record<
    string,
    Record<number, number>
  >;
  const widthKey = c.width ?? 100;
  const lookup = (table: Record<number, number>): number => {
    // Largest tabulated width <= widthKey (else smallest)
    const widths = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    let pick = widths[0] ?? widthKey;
    for (const w of widths) if (w <= widthKey) pick = w;
    return table[pick] ?? 1500;
  };
  switch (c.containmentType) {
    case 'tray':
      return lookup(spans.tray);
    case 'ladder':
      return lookup(spans.ladder);
    case 'basket':
      return lookup(spans.basket);
    case 'trunking':
      return lookup(spans.trunking);
    case 'conduit': {
      const isPvc =
        c.material === 'pvc' ||
        c.material === 'lsoh' ||
        c.subType === 'rigid-pvc' ||
        c.subType === 'lsoh-conduit';
      return lookup(isPvc ? spans.conduit_pvc : spans.conduit_steel);
    }
    case 'duct':
      return 1500;
    case 'busbar':
      return 3000;
    default:
      return 1500;
  }
};

// Detect tees / crosses by counting how many other containments share
// each interior endpoint of every containment in the project.
const collectJunctions = (
  containments: ContainmentEntity[],
): Map<EntityId, { tees: number; crosses: number; openEnds: number }> => {
  const out = new Map<
    EntityId,
    { tees: number; crosses: number; openEnds: number }
  >();
  // Bin endpoints to avoid O(n²) point comparisons across all entities
  const buckets = new Map<string, Array<{ id: EntityId; idx: number; p: Vec2 }>>();
  const key = (p: Vec2) =>
    `${Math.round(p.x / ENDPOINT_TOLERANCE_MM)}:${Math.round(p.y / ENDPOINT_TOLERANCE_MM)}`;
  for (const c of containments) {
    if (!c.points || c.points.length < 2) continue;
    const ends = [0, c.points.length - 1];
    for (const idx of ends) {
      const p = c.points[idx];
      const k = key(p);
      const list = buckets.get(k) ?? [];
      list.push({ id: c.id, idx, p });
      buckets.set(k, list);
    }
  }
  for (const c of containments) {
    out.set(c.id, { tees: 0, crosses: 0, openEnds: 0 });
  }
  for (const c of containments) {
    if (!c.points || c.points.length < 2) continue;
    const stats = out.get(c.id)!;
    for (const endIdx of [0, c.points.length - 1]) {
      const p = c.points[endIdx];
      // Look at neighbouring buckets (±1) to catch points near a boundary
      let touching = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${Math.round(p.x / ENDPOINT_TOLERANCE_MM) + dx}:${Math.round(p.y / ENDPOINT_TOLERANCE_MM) + dy}`;
          const list = buckets.get(k);
          if (!list) continue;
          for (const e of list) {
            if (e.id === c.id) continue;
            if (dist(e.p, p) <= ENDPOINT_TOLERANCE_MM) touching++;
          }
        }
      }
      if (touching === 0) stats.openEnds++;
      else if (touching === 1) stats.tees++;
      else if (touching >= 2) stats.crosses++;
    }
  }
  return out;
};

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
): ContainmentBOMRow[] => {
  const containments: Array<{
    e: ContainmentEntity;
    sheetNumber: string;
  }> = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (e && e.kind === 'containment') {
        containments.push({ e: e as ContainmentEntity, sheetNumber: sheet.number });
      }
    }
  }
  const junctions = collectJunctions(containments.map((c) => c.e));

  const rows = new Map<string, ContainmentBOMRow>();
  let auto = 1;

  for (const { e: c, sheetNumber } of containments) {
    const metrics = computeMetrics(c.points ?? []);
    if (metrics.lengthMm === 0) continue;
    const stock = STOCK_LENGTH_DEFAULT_MM;
    const piecesNeeded = Math.ceil((metrics.lengthMm * WASTAGE_FACTOR) / stock);
    const lengthMetres = +(metrics.lengthMm / 1000).toFixed(2);
    const span = supportSpanMm(c);
    const supports = Math.max(1, Math.ceil(metrics.lengthMm / span) + 1);
    const j = junctions.get(c.id) ?? { tees: 0, crosses: 0, openEnds: 0 };
    const bends = metrics.bends;
    // A coupler connects each adjacent pair of stock pieces — pieces - 1
    const couplers = Math.max(0, piecesNeeded - 1);
    const endCaps = j.openEnds;
    const tees = j.tees;
    const crosses = j.crosses;

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
      { sub: 'flat-bend', desc: 'Flat bend', qty: bends },
      { sub: 'tee', desc: 'Tee', qty: tees },
      { sub: 'cross', desc: 'Cross', qty: crosses },
      { sub: 'coupler', desc: 'Coupler', qty: couplers },
      { sub: 'end-cap', desc: 'End cap', qty: endCaps },
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
    upsert(
      rows,
      skey,
      {
        ref,
        kind: `${c.containmentType} support`,
        manufacturer,
        partNumber: '',
        description: `Bracket / hanger for ${size || c.containmentType}`,
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

export const containmentBOMToCSV = (rows: ContainmentBOMRow[]): string => {
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
  return [header, ...lines].join('\n');
};
