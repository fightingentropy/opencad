// Cable schedule export — one row per cable in the project's
// CableSchedule. The route column lists containment refs / labels in
// order (so the installer can find the run on the drawing).

import type { Project, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import jsPDF from 'jspdf';

export interface CableScheduleRow {
  ref: string;
  from: string;
  to: string;
  system: string;
  type: string;
  size: string; // csa × cores
  od: number;
  voltage: number;
  length: number; // m
  designCurrent: number;
  ampacity: number;
  vdropV: number;
  vdropPct: number;
  deviceRating: string;
  route: string;
}

const csvEsc = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

// Resolve a containment entity's display label from a route id by
// searching every sheet in the project.
const resolveRouteRef = (project: Project, id: string): string => {
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    const e = sheet.entities[id];
    if (e && e.kind === 'containment') {
      const c = e as ContainmentEntity;
      return c.label ?? c.id.slice(0, 6);
    }
  }
  return id.slice(0, 6);
};

const systemName = (project: Project, systemId?: string): string => {
  if (!systemId) return '';
  const sys = project.systems?.[systemId];
  return sys?.name ?? systemId;
};

const cableTypeLabel = (c: Cable): string => {
  return [c.construction, c.circuitType].filter(Boolean).join(' / ');
};

const sizeLabel = (c: Cable): string => {
  const cores = c.cores + (c.hasEarth ? ' + E' : '');
  return `${c.csa} mm² × ${cores}`;
};

export const exportCableSchedule = (
  project: Project,
): CableScheduleRow[] => {
  const sched = project.cableSchedule;
  if (!sched) return [];
  const rows: CableScheduleRow[] = [];
  for (const id of sched.cableOrder) {
    const c = sched.cables[id];
    if (!c) continue;
    const calc = c.calculated ?? {};
    rows.push({
      ref: c.reference,
      from: c.from,
      to: c.to,
      system: systemName(project, c.systemId),
      type: cableTypeLabel(c),
      size: sizeLabel(c),
      od: c.outerDiameter,
      voltage: c.voltage,
      length: c.actualLength ?? c.estimatedLength ?? 0,
      designCurrent: c.designCurrent ?? 0,
      ampacity: calc.ampacity ?? calc.baseAmpacity ?? 0,
      vdropV: calc.voltageDropV ?? 0,
      vdropPct: calc.voltageDropPct ?? 0,
      deviceRating: c.protectiveDevice
        ? `${c.protectiveDevice}${c.protectiveDeviceRating ? ` (${c.protectiveDeviceRating} A)` : ''}`
        : c.protectiveDeviceRating
          ? `${c.protectiveDeviceRating} A`
          : '',
      route: c.route.map((rid) => resolveRouteRef(project, rid)).join(' › '),
    });
  }
  return rows;
};

export const cableScheduleToCSV = (rows: CableScheduleRow[]): string => {
  const header = [
    'Ref',
    'From',
    'To',
    'System',
    'Type',
    'Size',
    'OD (mm)',
    'V',
    'Length (m)',
    'Ib (A)',
    'Iz (A)',
    'Vdrop (V)',
    'Vdrop (%)',
    'Device',
    'Route',
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.ref,
      r.from,
      r.to,
      r.system,
      r.type,
      r.size,
      r.od,
      r.voltage,
      r.length.toFixed(1),
      r.designCurrent.toFixed(1),
      r.ampacity.toFixed(1),
      r.vdropV.toFixed(2),
      r.vdropPct.toFixed(2),
      r.deviceRating,
      r.route,
    ]
      .map(csvEsc)
      .join(','),
  );
  return [header, ...lines].join('\n');
};

// Render the schedule as a landscape A3 PDF blob.
export const cableScheduleToPDF = async (
  rows: CableScheduleRow[],
  project: Project,
): Promise<Blob> => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  let y = 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${project.name} — Cable Schedule`, marginX, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 10)} • ${rows.length} cable${rows.length === 1 ? '' : 's'}`,
    marginX,
    y,
  );
  y += 6;

  const headers = [
    'Ref',
    'From',
    'To',
    'System',
    'Type',
    'Size',
    'OD',
    'V',
    'L (m)',
    'Ib',
    'Iz',
    'Vd V',
    'Vd %',
    'Device',
    'Route',
  ];
  // Column widths sum to ~400 mm to fit landscape A3 (420 mm − margins)
  const colW = [22, 28, 28, 24, 32, 24, 12, 12, 16, 14, 14, 16, 14, 28, 116];
  const rowH = 6;

  const drawRow = (cells: string[], opts?: { bold?: boolean; fill?: boolean }): void => {
    let x = marginX;
    if (opts?.fill) {
      doc.setFillColor(225, 232, 240);
      doc.rect(
        marginX,
        y - 4,
        colW.reduce((a, b) => a + b, 0),
        rowH,
        'F',
      );
    }
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(opts?.bold ? 9 : 8);
    for (let i = 0; i < cells.length; i++) {
      const text = cells[i] ?? '';
      const maxW = colW[i] - 1;
      const safe = doc.splitTextToSize(text, maxW)[0] ?? text;
      doc.text(safe, x + 0.6, y);
      x += colW[i];
    }
    y += rowH;
  };

  drawRow(headers, { bold: true, fill: true });
  for (const r of rows) {
    if (y > pageHeight - 15) {
      doc.addPage();
      y = 12;
      drawRow(headers, { bold: true, fill: true });
    }
    drawRow([
      r.ref,
      r.from,
      r.to,
      r.system,
      r.type,
      r.size,
      r.od ? `${r.od}` : '',
      `${r.voltage}`,
      r.length ? r.length.toFixed(1) : '',
      r.designCurrent ? r.designCurrent.toFixed(1) : '',
      r.ampacity ? r.ampacity.toFixed(1) : '',
      r.vdropV ? r.vdropV.toFixed(2) : '',
      r.vdropPct ? r.vdropPct.toFixed(2) : '',
      r.deviceRating,
      r.route,
    ]);
  }
  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(
    'OpenCAD Electrical • Cable Schedule',
    marginX,
    pageHeight - 4,
  );
  doc.text(
    `Page ${doc.getNumberOfPages()}`,
    pageWidth - marginX - 20,
    pageHeight - 4,
  );

  return doc.output('blob');
};
