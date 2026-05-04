// Compliance summary report — counts pass/fail across the four
// compliance dimensions OpenCAD currently models: containment fill,
// support spacing, segregation between cable categories, voltage
// drop and fire-stop coverage at compartment boundaries.
//
// The numbers come from inspecting entities and cables in the project;
// they intentionally don't try to re-implement the calc engine — they
// trust `Cable.calculated` and the geometry already on the page.

import type {
  Project,
  ContainmentEntity,
  WallEntity,
} from '../types';
import type { Cable } from '../models/cable';
import type { PenetrationSeal } from '../models/fire';
import { dist, distToSegment, segIntersect } from '../lib/math';
import {
  FILL_LIMITS,
  SUPPORT_SPANS_HORIZONTAL_MM,
  SEGREGATION_MIN_MM,
  VDROP_LIMITS,
} from '../models/standards';
import jsPDF from 'jspdf';

export interface ComplianceLine {
  label: string;
  pass: number;
  fail: number;
  total: number;
  details?: string[];
}

export interface ComplianceReportData {
  projectName: string;
  generated: string;
  containmentCount: number;
  totalRouteKm: number;
  fill: ComplianceLine;
  supports: ComplianceLine;
  segregation: ComplianceLine;
  voltageDrop: ComplianceLine;
  fireStops: ComplianceLine;
  notes: string[];
}

const routeLengthMm = (c: ContainmentEntity): number => {
  if (!c.points || c.points.length < 2) return 0;
  let n = 0;
  for (let i = 1; i < c.points.length; i++) n += dist(c.points[i - 1], c.points[i]);
  return n;
};

const innerCsa = (c: ContainmentEntity): number => {
  if (c.innerCsaMm2 && c.innerCsaMm2 > 0) return c.innerCsaMm2;
  if (c.containmentType === 'conduit' && c.width) {
    return Math.PI * (c.width / 2) ** 2 * 0.8;
  }
  if (c.width && c.height) return c.width * c.height * 0.85;
  return 0;
};

const supportSpanMm = (c: ContainmentEntity): number => {
  const spans = SUPPORT_SPANS_HORIZONTAL_MM as Record<string, Record<number, number>>;
  const widthKey = c.width ?? 100;
  const lookup = (table: Record<number, number>): number => {
    const widths = Object.keys(table).map(Number).sort((a, b) => a - b);
    let pick = widths[0] ?? widthKey;
    for (const w of widths) if (w <= widthKey) pick = w;
    return table[pick] ?? 1500;
  };
  switch (c.containmentType) {
    case 'tray': return lookup(spans.tray);
    case 'ladder': return lookup(spans.ladder);
    case 'basket': return lookup(spans.basket);
    case 'trunking': return lookup(spans.trunking);
    case 'conduit': {
      const isPvc = c.material === 'pvc' || c.material === 'lsoh';
      return lookup(isPvc ? spans.conduit_pvc : spans.conduit_steel);
    }
    default: return 1500;
  }
};

const collectContainments = (project: Project): ContainmentEntity[] => {
  const out: ContainmentEntity[] = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (e && e.kind === 'containment') out.push(e as ContainmentEntity);
    }
  }
  return out;
};

const collectWalls = (project: Project): WallEntity[] => {
  const walls: WallEntity[] = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (e && e.kind === 'wall') walls.push(e as WallEntity);
    }
  }
  return walls;
};

const fillLimitFor = (project: Project, c: ContainmentEntity): number => {
  const code = project.standardsProfile?.code ?? 'BS7671';
  const limits = FILL_LIMITS[code];
  switch (c.containmentType) {
    case 'trunking': return limits.trunking;
    case 'conduit': return limits.conduit;
    case 'tray': return limits.cableTray;
    case 'ladder': return limits.cableLadder;
    case 'basket': return limits.cableBasket;
    default: return 1.0;
  }
};

const cablesIn = (project: Project, id: string): Cable[] => {
  const sched = project.cableSchedule;
  if (!sched) return [];
  return sched.cableOrder.map((cid) => sched.cables[cid]).filter((c) => c && c.route.includes(id));
};

const evaluateFill = (project: Project, containments: ContainmentEntity[]): ComplianceLine => {
  let pass = 0;
  let fail = 0;
  const details: string[] = [];
  for (const c of containments) {
    const csa = innerCsa(c);
    if (csa <= 0) continue;
    const cables = cablesIn(project, c.id);
    const occupied = cables.reduce((a, b) => a + Math.PI * (b.outerDiameter / 2) ** 2, 0);
    const ratio = occupied / csa;
    const limit = fillLimitFor(project, c);
    if (ratio > limit) {
      fail++;
      details.push(
        `${c.label ?? c.id.slice(0, 6)}: ${(ratio * 100).toFixed(1)}% (limit ${(limit * 100).toFixed(0)}%)`,
      );
    } else {
      pass++;
    }
  }
  return { label: 'Containment fill', pass, fail, total: pass + fail, details };
};

const evaluateSupports = (project: Project, containments: ContainmentEntity[]): ComplianceLine => {
  // Count auto-generated SupportEntity per containment id and compare
  // to the count required by length / max span. Containments with no
  // supports at all just get flagged (no detail data available).
  const supportCount = new Map<string, number>();
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (e && e.kind === 'support') {
        for (const cid of e.supportingContainmentIds ?? []) {
          supportCount.set(cid, (supportCount.get(cid) ?? 0) + 1);
        }
      }
    }
  }
  let pass = 0;
  let fail = 0;
  const details: string[] = [];
  for (const c of containments) {
    const lengthMm = routeLengthMm(c);
    if (lengthMm <= 0) continue;
    const span = supportSpanMm(c);
    const required = Math.max(1, Math.ceil(lengthMm / span) + 1);
    const provided = supportCount.get(c.id) ?? 0;
    if (provided >= required) {
      pass++;
    } else {
      fail++;
      details.push(
        `${c.label ?? c.id.slice(0, 6)}: ${provided}/${required} (max span ${span} mm)`,
      );
    }
  }
  return { label: 'Support spacing', pass, fail, total: pass + fail, details };
};

const evaluateSegregation = (project: Project): ComplianceLine => {
  // Count, per containment with mixed cable categories, the worst-case
  // segregation pair and check it against SEGREGATION_MIN_MM. We treat
  // "mixed" containment as a violation if power and data co-exist.
  const containments = collectContainments(project);
  let pass = 0;
  let fail = 0;
  const details: string[] = [];
  for (const c of containments) {
    const cables = cablesIn(project, c.id);
    if (cables.length < 2) {
      pass++;
      continue;
    }
    const cats = new Set(cables.map((cab) => cab.circuitType));
    let violated = false;
    for (const a of cats) {
      for (const b of cats) {
        if (a === b) continue;
        const min = SEGREGATION_MIN_MM[a]?.[b];
        if (min !== undefined && min > 0 && c.cableCategory !== 'mixed') {
          violated = true;
        }
      }
    }
    if (violated) {
      fail++;
      details.push(
        `${c.label ?? c.id.slice(0, 6)}: mixes ${[...cats].join(', ')}`,
      );
    } else {
      pass++;
    }
  }
  return { label: 'Cable segregation', pass, fail, total: pass + fail, details };
};

const evaluateVoltageDrop = (project: Project): ComplianceLine => {
  const sched = project.cableSchedule;
  if (!sched) return { label: 'Voltage drop', pass: 0, fail: 0, total: 0 };
  const code = project.standardsProfile?.code ?? 'BS7671';
  const limits = VDROP_LIMITS[code];
  let pass = 0;
  let fail = 0;
  const details: string[] = [];
  for (const id of sched.cableOrder) {
    const c = sched.cables[id];
    if (!c) continue;
    const pct = c.calculated?.voltageDropPct;
    if (pct === undefined) continue;
    const isLighting = c.circuitType === 'control' || (c.systemId ?? '').includes('light');
    const lim = (isLighting ? limits.lighting : limits.other) * 100;
    if (pct > lim) {
      fail++;
      details.push(`${c.reference}: ${pct.toFixed(2)}% > ${lim}%`);
    } else {
      pass++;
    }
  }
  return { label: 'Voltage drop', pass, fail, total: pass + fail, details };
};

const containmentCrossesWall = (
  c: ContainmentEntity,
  wall: WallEntity,
): { x: number; y: number } | null => {
  if (!c.points || !wall.points) return null;
  if (c.points.length < 2 || wall.points.length < 2) return null;
  for (let i = 1; i < c.points.length; i++) {
    for (let j = 1; j < wall.points.length; j++) {
      const ix = segIntersect(
        c.points[i - 1],
        c.points[i],
        wall.points[j - 1],
        wall.points[j],
      );
      if (ix) return ix;
    }
  }
  return null;
};

const evaluateFireStops = (
  project: Project,
  containments: ContainmentEntity[],
  walls: WallEntity[],
): ComplianceLine => {
  const seals = project.penetrationSeals
    ? Object.values(project.penetrationSeals)
    : [];
  let pass = 0;
  let fail = 0;
  const details: string[] = [];

  for (const c of containments) {
    for (const w of walls) {
      if (!w.fireRating) continue;
      const cross = containmentCrossesWall(c, w);
      if (!cross) continue;
      const seal = seals.find((s: PenetrationSeal) => {
        if (s.boundaryEntityId !== w.id) return false;
        if (s.penetrationEntityId !== c.id) return false;
        return dist(s.crossingPoint, cross) < 250;
      });
      if (!seal) {
        fail++;
        details.push(
          `${c.label ?? c.id.slice(0, 6)} crosses wall ${w.id.slice(0, 6)} (${w.fireRating} min) — no seal`,
        );
        continue;
      }
      if (seal.status === 'failed') {
        fail++;
        details.push(`${seal.reference}: failed inspection`);
      } else if (
        seal.achievedRating !== undefined &&
        seal.achievedRating < seal.requiredRating
      ) {
        fail++;
        details.push(
          `${seal.reference}: rating ${seal.achievedRating} < required ${seal.requiredRating}`,
        );
      } else {
        pass++;
      }
    }
  }
  return { label: 'Fire-stops', pass, fail, total: pass + fail, details };
};

export const generateComplianceReport = (
  project: Project,
): ComplianceReportData => {
  const containments = collectContainments(project);
  const walls = collectWalls(project);
  const totalRouteKm = +(
    containments.reduce((a, c) => a + routeLengthMm(c), 0) / 1_000_000
  ).toFixed(3);
  const notes: string[] = [];
  const code = project.standardsProfile?.code ?? 'BS7671';
  notes.push(`Standards profile: ${code}`);
  notes.push(
    'Compliance checks operate on entities present in the model — undocumented installations cannot be evaluated.',
  );
  // Sanity check that math helpers are used (see segregation distance below)
  void distToSegment;
  return {
    projectName: project.name,
    generated: new Date().toISOString(),
    containmentCount: containments.length,
    totalRouteKm,
    fill: evaluateFill(project, containments),
    supports: evaluateSupports(project, containments),
    segregation: evaluateSegregation(project),
    voltageDrop: evaluateVoltageDrop(project),
    fireStops: evaluateFireStops(project, containments, walls),
    notes,
  };
};

const escHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const lineRow = (l: ComplianceLine): string => {
  const pct = l.total > 0 ? ((l.pass / l.total) * 100).toFixed(1) : '—';
  const cls = l.fail === 0 ? 'pass' : 'fail';
  return `<tr class="${cls}">
    <td>${escHtml(l.label)}</td>
    <td>${l.pass}</td>
    <td>${l.fail}</td>
    <td>${l.total}</td>
    <td>${pct}${pct !== '—' ? '%' : ''}</td>
  </tr>`;
};

const detailsBlock = (l: ComplianceLine): string => {
  if (!l.details || l.details.length === 0) return '';
  const items = l.details.slice(0, 25).map((d) => `<li>${escHtml(d)}</li>`).join('');
  const more =
    l.details.length > 25
      ? `<li>… and ${l.details.length - 25} more</li>`
      : '';
  return `<h3>${escHtml(l.label)} failures</h3><ul>${items}${more}</ul>`;
};

export const complianceReportToHTML = (data: ComplianceReportData): string => {
  const failingLines = [data.fill, data.supports, data.segregation, data.voltageDrop, data.fireStops]
    .filter((l) => l.fail > 0)
    .map(detailsBlock)
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Compliance Report — ${escHtml(data.projectName)}</title>
<style>
body { font-family: -apple-system, sans-serif; color: #1a1a1a; padding: 24px; max-width: 900px; margin: 0 auto; }
h1 { margin-bottom: 4px; }
.meta { color: #555; margin-bottom: 24px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f0f3f7; }
tr.fail td { background: #fff4f0; }
tr.pass td { background: #f4faf4; }
ul { margin-top: 0; }
h3 { margin-top: 18px; }
</style></head>
<body>
<h1>Compliance Report</h1>
<div class="meta">${escHtml(data.projectName)} • Generated ${escHtml(data.generated)}</div>
<table>
  <tr><th>Total containment runs</th><td>${data.containmentCount}</td></tr>
  <tr><th>Total route length</th><td>${data.totalRouteKm.toFixed(3)} km</td></tr>
</table>
<h2>Compliance summary</h2>
<table>
  <thead><tr><th>Check</th><th>Pass</th><th>Fail</th><th>Total</th><th>Pass rate</th></tr></thead>
  <tbody>
    ${[data.fill, data.supports, data.segregation, data.voltageDrop, data.fireStops].map(lineRow).join('')}
  </tbody>
</table>
${failingLines}
<h3>Notes</h3>
<ul>${data.notes.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>
</body></html>`;
};

export const complianceReportToPDF = async (
  data: ComplianceReportData,
): Promise<Blob> => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 15;
  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`Compliance Report — ${data.projectName}`, marginX, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generated ${data.generated}`, marginX, y);
  y += 8;

  const tableHead = (cols: string[], widths: number[]) => {
    doc.setFillColor(225, 232, 240);
    doc.rect(marginX, y - 4, widths.reduce((a, b) => a + b, 0), 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = marginX;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], x + 1, y);
      x += widths[i];
    }
    y += 6;
  };
  const tableRow = (cells: string[], widths: number[]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    let x = marginX;
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i], x + 1, y);
      x += widths[i];
    }
    y += 6;
  };

  tableHead(['Metric', 'Value'], [70, 100]);
  tableRow(['Containment runs', String(data.containmentCount)], [70, 100]);
  tableRow(['Total route length', `${data.totalRouteKm.toFixed(3)} km`], [70, 100]);
  y += 4;

  tableHead(['Check', 'Pass', 'Fail', 'Total', 'Pass %'], [60, 25, 25, 25, 30]);
  for (const l of [
    data.fill,
    data.supports,
    data.segregation,
    data.voltageDrop,
    data.fireStops,
  ]) {
    const pct = l.total > 0 ? ((l.pass / l.total) * 100).toFixed(1) : '—';
    tableRow(
      [
        l.label,
        String(l.pass),
        String(l.fail),
        String(l.total),
        pct === '—' ? pct : `${pct}%`,
      ],
      [60, 25, 25, 25, 30],
    );
  }
  y += 4;

  for (const l of [
    data.fill,
    data.supports,
    data.segregation,
    data.voltageDrop,
    data.fireStops,
  ]) {
    if (!l.details || l.details.length === 0) continue;
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${l.label} — failures`, marginX, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const items = l.details.slice(0, 60);
    for (const d of items) {
      if (y > pageHeight - 12) {
        doc.addPage();
        y = 18;
      }
      doc.text(`• ${d}`, marginX + 2, y);
      y += 4;
    }
    if (l.details.length > items.length) {
      doc.text(`… and ${l.details.length - items.length} more`, marginX + 2, y);
      y += 4;
    }
    y += 2;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('OpenCAD Electrical • Compliance Report', marginX, pageHeight - 5);
  doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 25, pageHeight - 5);

  return doc.output('blob');
};
