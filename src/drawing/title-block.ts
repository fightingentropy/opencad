// BS EN ISO 7200 title block builder.
//
// The standard divides a title block into four conceptual zones:
//   - Identifying:   drawing number, title, sheet x of y
//   - Descriptive:   scale, projection method, units of measure
//   - Administrative: originator, drawn / checked / approved by + dates
//   - Revision:      latest revision plus a short history list
// Plus project info (code, name, client) which the standard treats as
// part of the identifying zone but is presented separately on most
// real-world templates.

import type { Project, Sheet } from '../types';
import type { DrawingRevision, SheetMeta } from '../models/revision';
import { assembleDrawingNumber } from './numbering';

// Paper sizes in mm, ISO A series plus the most common ANSI/ISO 5457
// extension labels we already use elsewhere in the app.
export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'B' | 'D' | 'E';

export interface PaperDimensions {
  width: number;
  height: number;
}

export const PAPER_SIZES: Record<PaperSize, PaperDimensions> = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841, height: 594 },
  A2: { width: 594, height: 420 },
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
  // Imperial fallbacks — sized per their landscape mm equivalents.
  B: { width: 432, height: 279 },
  D: { width: 864, height: 559 },
  E: { width: 1118, height: 864 },
};

// Identifying-zone data — the "what is this drawing" fields.
export interface IdentifyingZone {
  drawingNumber: string;
  title: string;
  subtitle?: string;
  sheetNumber: string;
  // "1 of 12" style display string, computed from the project sheet count
  sheetOf?: string;
}

// Descriptive-zone data — interpretation hints for the reader.
export interface DescriptiveZone {
  scale: string;
  // ISO 5456 first-angle (European) or third-angle (US) projection.
  projection: 'first-angle' | 'third-angle';
  units: 'mm' | 'in';
  paperSize: PaperSize;
}

// One row of signed-off names + dates.
export interface AdministrativeRow {
  role: 'drawn' | 'checked' | 'approved' | 'designer';
  name?: string;
  date?: number;
}

// Administrative-zone data — the "who is responsible" fields.
export interface AdministrativeZone {
  originator?: string;
  rows: AdministrativeRow[];
}

// Revision-zone data — current rev plus the most recent history rows.
export interface RevisionZone {
  current?: string;
  status?: string;
  rows: DrawingRevision[];
}

// Project-info zone — everything else needed to identify the project.
export interface ProjectInfoZone {
  projectCode?: string;
  projectName: string;
  client?: string;
  engineer?: string;
}

// Composed title-block payload — pure data, no rendering decisions yet.
export interface TitleBlockData {
  identifying: IdentifyingZone;
  descriptive: DescriptiveZone;
  administrative: AdministrativeZone;
  revision: RevisionZone;
  projectInfo: ProjectInfoZone;
}

// Layout describes where the title block is positioned relative to the
// sheet origin (lower-left), and the heights of each row group. Widths
// are subdivided in the renderer.
export interface TitleBlockLayout {
  // Outer block dimensions (mm) — anchored to the bottom-right corner of
  // the sheet. The renderer offsets by these from sheet.width/height.
  width: number;
  height: number;
  // Vertical heights of the stacked zone bands, top-to-bottom (mm).
  identifyingHeight: number;
  descriptiveHeight: number;
  administrativeHeight: number;
  revisionHeight: number;
  projectInfoHeight: number;
  // Margin from sheet edge (mm).
  margin: number;
}

// Trim a list to its most recent N entries, sorted newest-first.
export const revisionTableRows = (
  meta: SheetMeta | undefined,
  maxRows = 8,
): DrawingRevision[] => {
  const all = meta?.revisions ?? [];
  if (all.length === 0) return [];
  // Sort by date descending — date is unix-ms epoch.
  const sorted = [...all].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return sorted.slice(0, Math.max(0, maxRows));
};

// Default per-paper-size title block geometry. ISO 7200 specifies a
// 180 mm wide block; the height grows with sheet area so it stays
// readable but doesn't dominate small sheets.
export const defaultTitleBlockLayout = (
  paperSize: PaperSize | string = 'A1',
): TitleBlockLayout => {
  const isLarge = paperSize === 'A0' || paperSize === 'E' || paperSize === 'D';
  const isMedium = paperSize === 'A1' || paperSize === 'A2' || paperSize === 'B';
  const isSmall = paperSize === 'A4';

  const width = 180;
  let height: number;
  if (isLarge) height = 95;
  else if (isMedium) height = 80;
  else if (isSmall) height = 55;
  else height = 65; // A3 default

  // Distribute height across the five bands. The administrative band
  // gets the most room because it carries the four signature rows.
  const identifyingHeight = Math.round(height * 0.32);
  const descriptiveHeight = Math.round(height * 0.12);
  const administrativeHeight = Math.round(height * 0.28);
  const revisionHeight = Math.round(height * 0.18);
  const projectInfoHeight =
    height -
    identifyingHeight -
    descriptiveHeight -
    administrativeHeight -
    revisionHeight;

  return {
    width,
    height,
    identifyingHeight,
    descriptiveHeight,
    administrativeHeight,
    revisionHeight,
    projectInfoHeight,
    margin: 5,
  };
};

// Build the ready-to-render data structure. Pure: no DOM / canvas calls.
// Missing fields fall back to sensible defaults so a brand-new sheet
// still produces a complete, displayable title block.
export const buildTitleBlock = (
  sheet: Sheet,
  project: Project,
): TitleBlockData => {
  const meta = sheet.meta ?? {};

  // Rebuild the drawing number from parts when the assembled string
  // wasn't cached — keeps presentation and fields in sync after edits.
  const drawingNumber =
    meta.drawingNumber ??
    assembleDrawingNumber({
      projectCode: meta.projectCode ?? project.projectNumber,
      originator: meta.originator ?? project.originatorCode,
      volume: meta.volume,
      level: meta.level,
      type: meta.type,
      discipline: meta.discipline,
      sequenceNumber: meta.sequenceNumber ?? sheet.number,
    });

  // "Sheet 3 of 12" — index this sheet in the canonical sheet order.
  const idx = project.sheetOrder.indexOf(sheet.id);
  const total = project.sheetOrder.length;
  const sheetOf =
    idx >= 0 && total > 1 ? `${idx + 1} of ${total}` : undefined;

  const identifying: IdentifyingZone = {
    drawingNumber,
    title: meta.title ?? sheet.name,
    subtitle: meta.subtitle,
    sheetNumber: sheet.number || (idx >= 0 ? String(idx + 1) : '1'),
    sheetOf,
  };

  // First-angle projection is the BS / EN default; American projects
  // override via project standard. We track the standard at project
  // level (IEEE => third-angle, IEC => first-angle).
  const projection: 'first-angle' | 'third-angle' =
    project.standard === 'IEEE' ? 'third-angle' : 'first-angle';

  const descriptive: DescriptiveZone = {
    scale: meta.scale ?? '1:50',
    projection,
    units: project.units,
    paperSize: (meta.paperSize as PaperSize) ?? 'A1',
  };

  const administrative: AdministrativeZone = {
    originator: meta.originator ?? project.originatorCode,
    rows: [
      { role: 'drawn', name: meta.drawnBy, date: meta.drawnDate },
      { role: 'checked', name: meta.checkedBy, date: meta.checkedDate },
      { role: 'approved', name: meta.approvedBy, date: meta.approvedDate },
      { role: 'designer', name: meta.designer },
    ],
  };

  const revision: RevisionZone = {
    current: meta.currentRevision,
    status: meta.status,
    rows: revisionTableRows(meta, 8),
  };

  const projectInfo: ProjectInfoZone = {
    projectCode: project.projectNumber,
    projectName: project.name,
    client: project.client,
    engineer: project.engineer,
  };

  return { identifying, descriptive, administrative, revision, projectInfo };
};
