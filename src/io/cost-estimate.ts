// Cost estimate — combines material cost from the BOM with labour
// hours derived from containment route lengths and fitting / support
// counts. Default rates are intentionally conservative; the caller
// passes overrides through `CostEstimateOptions`.

import type { Project } from '../types';
import { generateContainmentBOM } from './containment-bom';
import type { ContainmentBOMRow } from './containment-bom';

export interface CostEstimateOptions {
  hourlyRate?: number; // GBP/hour
  currency?: string; // ISO 4217 — display only
  overheadPct?: number; // 0..1
  profitPct?: number;
  contingencyPct?: number;
  // Optional per-kind labour overrides (hours per metre)
  labourPerMTrunking?: number;
  labourPerMTray?: number;
  labourPerMConduit?: number;
  // Hours per fitting and per support
  labourPerFitting?: number;
  labourPerSupport?: number;
}

export interface CostLineItem {
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  category: 'material' | 'labour' | 'overhead' | 'profit' | 'contingency';
}

export interface CostEstimate {
  currency: string;
  generated: string;
  lineItems: CostLineItem[];
  materialTotal: number;
  labourTotal: number;
  overhead: number;
  profit: number;
  contingency: number;
  grandTotal: number;
  options: Required<CostEstimateOptions>;
}

const DEFAULTS: Required<CostEstimateOptions> = {
  hourlyRate: 45,
  currency: 'GBP',
  overheadPct: 0.12,
  profitPct: 0.1,
  contingencyPct: 0.05,
  labourPerMTrunking: 0.3,
  labourPerMTray: 0.4,
  labourPerMConduit: 0.5,
  labourPerFitting: 0.3,
  labourPerSupport: 0.2,
};

const csvEsc = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const escHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Total all material from the BOM (only rows with unit cost > 0).
const buildMaterialLines = (bom: ContainmentBOMRow[]): CostLineItem[] => {
  const items: CostLineItem[] = [];
  for (const row of bom) {
    if (row.unitCost <= 0) continue;
    items.push({
      description: `${row.kind} — ${row.description}`.trim(),
      unit: row.unit,
      quantity: row.quantity,
      unitCost: row.unitCost,
      totalCost: +(row.unitCost * row.quantity).toFixed(2),
      category: 'material',
    });
  }
  return items;
};

// Build a labour breakdown from the BOM rows (linear-metre runs +
// fittings + supports). Tray/trunking/conduit get distinct rates.
const buildLabourLines = (
  bom: ContainmentBOMRow[],
  opts: Required<CostEstimateOptions>,
): CostLineItem[] => {
  const items: CostLineItem[] = [];

  // Linear-metre rows have unit === 'm' and `kind` ending with " run"
  for (const row of bom) {
    if (row.unit !== 'm') continue;
    const kindKey = row.kind.replace(/ run$/, '');
    let perM = 0;
    let label = '';
    if (kindKey === 'trunking') {
      perM = opts.labourPerMTrunking;
      label = 'Trunking installation';
    } else if (kindKey === 'tray' || kindKey === 'ladder' || kindKey === 'basket') {
      perM = opts.labourPerMTray;
      label = `${kindKey} installation`;
    } else if (kindKey === 'conduit') {
      perM = opts.labourPerMConduit;
      label = 'Conduit installation';
    } else if (kindKey === 'duct' || kindKey === 'busbar') {
      perM = opts.labourPerMTray;
      label = `${kindKey} installation`;
    } else {
      perM = opts.labourPerMTray;
      label = `${kindKey} installation`;
    }
    const hours = +(row.quantity * perM).toFixed(2);
    if (hours > 0) {
      items.push({
        description: `${label} (${row.size || row.material || 'standard'})`,
        unit: 'h',
        quantity: hours,
        unitCost: opts.hourlyRate,
        totalCost: +(hours * opts.hourlyRate).toFixed(2),
        category: 'labour',
      });
    }
  }

  // Fittings and supports — sum across all rows of those kinds
  let fittingCount = 0;
  let supportCount = 0;
  for (const row of bom) {
    if (row.unit !== 'pcs') continue;
    if (row.kind.includes('flat-bend') || row.kind.includes('tee') ||
        row.kind.includes('cross') || row.kind.includes('coupler') ||
        row.kind.includes('end-cap')) {
      fittingCount += row.quantity;
    } else if (row.kind.includes('support')) {
      supportCount += row.quantity;
    }
  }
  if (fittingCount > 0) {
    const hours = +(fittingCount * opts.labourPerFitting).toFixed(2);
    items.push({
      description: 'Fitting installation',
      unit: 'h',
      quantity: hours,
      unitCost: opts.hourlyRate,
      totalCost: +(hours * opts.hourlyRate).toFixed(2),
      category: 'labour',
    });
  }
  if (supportCount > 0) {
    const hours = +(supportCount * opts.labourPerSupport).toFixed(2);
    items.push({
      description: 'Support installation',
      unit: 'h',
      quantity: hours,
      unitCost: opts.hourlyRate,
      totalCost: +(hours * opts.hourlyRate).toFixed(2),
      category: 'labour',
    });
  }
  return items;
};

export const generateCostEstimate = (
  project: Project,
  options: CostEstimateOptions = {},
): CostEstimate => {
  const opts: Required<CostEstimateOptions> = { ...DEFAULTS, ...options };
  const bom = generateContainmentBOM(project);
  const materialLines = buildMaterialLines(bom);
  const labourLines = buildLabourLines(bom, opts);
  const materialTotal = +materialLines.reduce((a, b) => a + b.totalCost, 0).toFixed(2);
  const labourTotal = +labourLines.reduce((a, b) => a + b.totalCost, 0).toFixed(2);
  const subtotal = materialTotal + labourTotal;
  const overhead = +(subtotal * opts.overheadPct).toFixed(2);
  const profit = +((subtotal + overhead) * opts.profitPct).toFixed(2);
  const contingency = +((subtotal + overhead + profit) * opts.contingencyPct).toFixed(2);
  const grandTotal = +(subtotal + overhead + profit + contingency).toFixed(2);

  const overheadLine: CostLineItem = {
    description: `Overhead (${(opts.overheadPct * 100).toFixed(1)}%)`,
    unit: 'lump',
    quantity: 1,
    unitCost: overhead,
    totalCost: overhead,
    category: 'overhead',
  };
  const profitLine: CostLineItem = {
    description: `Profit (${(opts.profitPct * 100).toFixed(1)}%)`,
    unit: 'lump',
    quantity: 1,
    unitCost: profit,
    totalCost: profit,
    category: 'profit',
  };
  const contingencyLine: CostLineItem = {
    description: `Contingency (${(opts.contingencyPct * 100).toFixed(1)}%)`,
    unit: 'lump',
    quantity: 1,
    unitCost: contingency,
    totalCost: contingency,
    category: 'contingency',
  };
  return {
    currency: opts.currency,
    generated: new Date().toISOString(),
    lineItems: [
      ...materialLines,
      ...labourLines,
      overheadLine,
      profitLine,
      contingencyLine,
    ],
    materialTotal,
    labourTotal,
    overhead,
    profit,
    contingency,
    grandTotal,
    options: opts,
  };
};

export const costEstimateToCSV = (est: CostEstimate): string => {
  const header = [
    'Category',
    'Description',
    'Unit',
    'Quantity',
    'UnitCost',
    'TotalCost',
  ].join(',');
  const lines = est.lineItems.map((l) =>
    [
      l.category,
      l.description,
      l.unit,
      l.quantity,
      l.unitCost.toFixed(2),
      l.totalCost.toFixed(2),
    ]
      .map(csvEsc)
      .join(','),
  );
  const totals = [
    `,Material total,,,,${est.materialTotal.toFixed(2)}`,
    `,Labour total,,,,${est.labourTotal.toFixed(2)}`,
    `,Overhead,,,,${est.overhead.toFixed(2)}`,
    `,Profit,,,,${est.profit.toFixed(2)}`,
    `,Contingency,,,,${est.contingency.toFixed(2)}`,
    `,Grand total (${est.currency}),,,,${est.grandTotal.toFixed(2)}`,
  ];
  return [header, ...lines, '', ...totals].join('\n');
};

export const costEstimateToHTML = (est: CostEstimate, project: Project): string => {
  const fmt = (n: number) => `${est.currency} ${n.toFixed(2)}`;
  const grouped: Record<string, CostLineItem[]> = {
    material: [],
    labour: [],
    overhead: [],
    profit: [],
    contingency: [],
  };
  for (const l of est.lineItems) grouped[l.category].push(l);
  const renderGroup = (title: string, key: keyof typeof grouped) => {
    const items = grouped[key];
    if (items.length === 0) return '';
    return `
<h3>${escHtml(title)}</h3>
<table>
  <thead><tr><th>Description</th><th>Unit</th><th>Qty</th><th>Unit cost</th><th>Total</th></tr></thead>
  <tbody>
  ${items
    .map(
      (l) =>
        `<tr><td>${escHtml(l.description)}</td><td>${escHtml(l.unit)}</td><td>${l.quantity}</td><td>${fmt(l.unitCost)}</td><td>${fmt(l.totalCost)}</td></tr>`,
    )
    .join('')}
  </tbody>
</table>`;
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Cost estimate — ${escHtml(project.name)}</title>
<style>
body { font-family: -apple-system, sans-serif; padding: 24px; max-width: 960px; margin: 0 auto; color: #1a1a1a; }
h1 { margin-bottom: 4px; }
.meta { color: #555; margin-bottom: 18px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
th, td { border: 1px solid #e0e0e0; padding: 6px 8px; text-align: left; font-size: 13px; }
th { background: #f4f6fa; }
.totals { font-size: 14px; }
.totals td { padding: 4px 12px 4px 0; }
.totals .grand { font-weight: bold; font-size: 16px; border-top: 2px solid #333; padding-top: 8px; }
</style></head>
<body>
<h1>Cost Estimate</h1>
<div class="meta">${escHtml(project.name)} • Generated ${escHtml(est.generated)} • Currency ${escHtml(est.currency)}</div>
${renderGroup('Materials', 'material')}
${renderGroup('Labour', 'labour')}
<h3>Summary</h3>
<table class="totals">
<tr><td>Material total</td><td>${fmt(est.materialTotal)}</td></tr>
<tr><td>Labour total</td><td>${fmt(est.labourTotal)}</td></tr>
<tr><td>Overhead</td><td>${fmt(est.overhead)}</td></tr>
<tr><td>Profit</td><td>${fmt(est.profit)}</td></tr>
<tr><td>Contingency</td><td>${fmt(est.contingency)}</td></tr>
<tr class="grand"><td>Grand total</td><td>${fmt(est.grandTotal)}</td></tr>
</table>
</body></html>`;
};
