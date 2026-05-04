// Fire-stop schedule — tabulates every PenetrationSeal in the project
// against its boundary, the penetrating containment / cable, the
// required vs achieved fire rating and the seal product.
//
// Status follows the PenetrationStatus enum. The schedule is the
// single source of truth at handover for the fire-stopping subcontract.

import type { Project, ContainmentEntity, WallEntity } from '../types';
import type { PenetrationSeal, FireRating } from '../models/fire';
import jsPDF from 'jspdf';

export interface FireStopRow {
  ref: string;
  sheet: string;
  location: string; // x,y mm
  boundary: string;
  boundaryRating: FireRating | '';
  penetration: string;
  penetrationKind: string;
  requiredRating: FireRating;
  achievedRating: FireRating | '';
  sealType: string;
  productPartNumber: string;
  status: string;
  inspector: string;
  notes: string;
}

const csvEsc = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const findEntityAndSheet = (
  project: Project,
  id: string,
): { kind: string; ref: string; sheetNumber: string } => {
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    const e = sheet?.entities[id];
    if (e) {
      let ref = id.slice(0, 8);
      if (e.kind === 'containment') ref = (e as ContainmentEntity).label ?? ref;
      if (e.kind === 'wall') ref = (e as WallEntity).id.slice(0, 8);
      return { kind: e.kind, ref, sheetNumber: sheet.number };
    }
  }
  return { kind: 'unknown', ref: id.slice(0, 8), sheetNumber: '' };
};

const cableRefForEntity = (project: Project, id: string): string | null => {
  const sched = project.cableSchedule;
  if (!sched) return null;
  const cable = sched.cableOrder
    .map((cid) => sched.cables[cid])
    .find((c) => c?.fromEntityId === id || c?.toEntityId === id);
  return cable?.reference ?? null;
};

export const exportFireStopSchedule = (project: Project): FireStopRow[] => {
  const seals = project.penetrationSeals
    ? Object.values(project.penetrationSeals)
    : [];
  const rows: FireStopRow[] = [];
  for (const s of seals as PenetrationSeal[]) {
    const boundary = findEntityAndSheet(project, s.boundaryEntityId);
    const penetration = findEntityAndSheet(project, s.penetrationEntityId);
    const cableRef = cableRefForEntity(project, s.penetrationEntityId);
    const wall = (() => {
      for (const sid of project.sheetOrder) {
        const e = project.sheets[sid]?.entities[s.boundaryEntityId];
        if (e && e.kind === 'wall') return e as WallEntity;
      }
      return null;
    })();
    rows.push({
      ref: s.reference,
      sheet: boundary.sheetNumber || penetration.sheetNumber,
      location: `${Math.round(s.crossingPoint.x)}, ${Math.round(s.crossingPoint.y)}`,
      boundary: boundary.ref,
      boundaryRating: wall?.fireRating ?? '',
      penetration: cableRef ?? penetration.ref,
      penetrationKind: penetration.kind,
      requiredRating: s.requiredRating,
      achievedRating: s.achievedRating ?? '',
      sealType: s.sealType ?? '',
      productPartNumber: s.productPartNumber ?? '',
      status: s.status,
      inspector: s.inspectedBy ?? '',
      notes: s.notes ?? '',
    });
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
};

export const fireStopScheduleToCSV = (rows: FireStopRow[]): string => {
  const header = [
    'Ref',
    'Sheet',
    'Location (mm)',
    'Boundary',
    'Boundary rating',
    'Penetration',
    'Type',
    'Required rating',
    'Achieved rating',
    'Seal type',
    'Product P/N',
    'Status',
    'Inspector',
    'Notes',
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.ref,
      r.sheet,
      r.location,
      r.boundary,
      r.boundaryRating === '' ? '' : `${r.boundaryRating} min`,
      r.penetration,
      r.penetrationKind,
      `${r.requiredRating} min`,
      r.achievedRating === '' ? '' : `${r.achievedRating} min`,
      r.sealType,
      r.productPartNumber,
      r.status,
      r.inspector,
      r.notes,
    ]
      .map(csvEsc)
      .join(','),
  );
  return [header, ...lines].join('\n');
};

export const fireStopScheduleToPDF = async (
  rows: FireStopRow[],
  project: Project,
): Promise<Blob> => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  let y = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${project.name} — Fire-Stop Schedule`, marginX, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 10)} • ${rows.length} seal${rows.length === 1 ? '' : 's'}`,
    marginX,
    y,
  );
  y += 8;

  const headers = [
    'Ref',
    'Sheet',
    'Location',
    'Boundary',
    'B Rate',
    'Penetration',
    'Type',
    'Req',
    'Ach',
    'Seal',
    'Product',
    'Status',
    'Inspector',
  ];
  const colW = [22, 18, 30, 28, 18, 30, 22, 14, 14, 22, 36, 26, 36];
  const totalW = colW.reduce((a, b) => a + b, 0);
  const rowH = 6;

  const drawHeader = () => {
    doc.setFillColor(225, 232, 240);
    doc.rect(marginX, y - 4, totalW, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = marginX;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x + 0.6, y);
      x += colW[i];
    }
    y += rowH;
  };
  const drawRow = (cells: string[]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    let x = marginX;
    for (let i = 0; i < cells.length; i++) {
      const text = cells[i] ?? '';
      const cropped = doc.splitTextToSize(text, colW[i] - 1)[0] ?? text;
      doc.text(cropped, x + 0.6, y);
      x += colW[i];
    }
    y += rowH;
  };

  drawHeader();
  for (const r of rows) {
    if (y > pageHeight - 14) {
      doc.addPage();
      y = 14;
      drawHeader();
    }
    drawRow([
      r.ref,
      r.sheet,
      r.location,
      r.boundary,
      r.boundaryRating === '' ? '' : `${r.boundaryRating} min`,
      r.penetration,
      r.penetrationKind,
      `${r.requiredRating}`,
      r.achievedRating === '' ? '' : `${r.achievedRating}`,
      r.sealType,
      r.productPartNumber,
      r.status,
      r.inspector,
    ]);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(
    'OpenCAD Electrical • Fire-Stop Schedule',
    marginX,
    pageHeight - 5,
  );
  doc.text(
    `Page ${doc.getNumberOfPages()}`,
    pageWidth - marginX - 20,
    pageHeight - 5,
  );

  return doc.output('blob');
};
