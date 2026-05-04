// Render the BS EN ISO 7200 title block in world coordinates (mm) onto a
// canvas. The caller's world-to-screen transform is already applied
// (see render2d.ts) so we paint in mm and let the existing transform
// handle the rest. Y is flipped per the project convention so any text
// rendering needs an explicit ctx.scale(1,-1).

import type { Project, Sheet, Viewport } from '../types';
import { buildTitleBlock, defaultTitleBlockLayout } from '../drawing/title-block';
import { REVISION_STATUSES } from '../models/revision';

// Constants for paint colours — matches the existing dark-mode palette.
const BORDER = '#9aa3b2';
const DIVIDER = '#5d6473';
const LABEL_COLOR = '#9aa3b2';
const VALUE_COLOR = '#e6e8ec';
const ACCENT = '#5cdcff';

const formatDate = (ms: number | undefined): string => {
  if (!ms || !Number.isFinite(ms)) return '—';
  try {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return '—';
  }
};

// Paint a label / value pair at the given mm position. labelSize is
// small uppercase; valueSize is the larger reading-size text.
const drawPair = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  labelSize = 1.6,
  valueSize = 2.8,
) => {
  ctx.save();
  ctx.scale(1, -1);
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `${labelSize}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, -y - 0.5);
  ctx.fillStyle = VALUE_COLOR;
  ctx.font = `${valueSize}px sans-serif`;
  ctx.fillText(value || '—', x, -y - labelSize - 0.7);
  ctx.restore();
};

const drawText = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  bold = false,
) => {
  ctx.save();
  ctx.scale(1, -1);
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  ctx.fillText(text, x, -y);
  ctx.restore();
};

// Paint the title block. Position is bottom-right of the sheet, inset
// by the layout margin. Each zone is drawn as a horizontal band with
// internal vertical dividers.
export const renderTitleBlock = (
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  project: Project,
  // Viewport is supplied for renderers that want to fade out detail at
  // small zoom — currently unused, but kept on the API so existing
  // call-sites don't break when we add zoom-aware fallbacks.
  _viewport: Viewport,
): void => {
  const data = buildTitleBlock(sheet, project);
  const layout = defaultTitleBlockLayout(data.descriptive.paperSize);

  // Anchor at bottom-right of sheet, inset by layout.margin.
  const x0 = sheet.width - layout.margin - layout.width;
  const y0 = layout.margin;
  const x1 = sheet.width - layout.margin;
  const y1 = layout.margin + layout.height;

  ctx.save();

  // Outer border.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([]);
  ctx.strokeRect(x0, y0, layout.width, layout.height);

  // Compute zone Y boundaries from top-down so band names map to layout
  // fields directly.
  let cursorY = y1;
  const identTop = cursorY;
  cursorY -= layout.identifyingHeight;
  const identBot = cursorY;
  const descrTop = cursorY;
  cursorY -= layout.descriptiveHeight;
  const descrBot = cursorY;
  const adminTop = cursorY;
  cursorY -= layout.administrativeHeight;
  const adminBot = cursorY;
  const revTop = cursorY;
  cursorY -= layout.revisionHeight;
  const revBot = cursorY;
  const projTop = cursorY;
  // bottom is y0
  const projBot = y0;

  // Horizontal dividers between bands.
  ctx.strokeStyle = DIVIDER;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (const yy of [identBot, descrBot, adminBot, revBot]) {
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
  }
  ctx.stroke();

  // ---------- Identifying zone (top band) ---------------------------------
  // Big drawing-number on the right, title on the left.
  // Split this band: title on the left, drawing-number block on the right.
  const identMidX = x0 + layout.width * 0.5;
  ctx.beginPath();
  ctx.moveTo(identMidX, identTop);
  ctx.lineTo(identMidX, identBot);
  ctx.stroke();

  drawText(
    ctx,
    x0 + 2,
    identTop - 2,
    'TITLE',
    1.6,
    LABEL_COLOR,
    'left',
  );
  drawText(
    ctx,
    x0 + 2,
    identTop - 5,
    data.identifying.title,
    3.6,
    VALUE_COLOR,
    'left',
    true,
  );
  if (data.identifying.subtitle) {
    drawText(
      ctx,
      x0 + 2,
      identTop - 10,
      data.identifying.subtitle,
      2.4,
      LABEL_COLOR,
      'left',
    );
  }

  drawText(
    ctx,
    identMidX + 2,
    identTop - 2,
    'DRAWING NUMBER',
    1.6,
    LABEL_COLOR,
    'left',
  );
  drawText(
    ctx,
    identMidX + 2,
    identTop - 5.5,
    data.identifying.drawingNumber,
    3.4,
    ACCENT,
    'left',
    true,
  );
  // Sheet "X of Y" tucked at the bottom of the right half.
  if (data.identifying.sheetOf) {
    drawText(
      ctx,
      identMidX + 2,
      identBot + 2,
      `SHEET ${data.identifying.sheetOf}`,
      2.0,
      LABEL_COLOR,
      'left',
    );
  }

  // ---------- Descriptive zone -------------------------------------------
  // SCALE | PROJECTION | UNITS | PAPER
  const descrColW = layout.width / 4;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const xx = x0 + descrColW * i;
    ctx.moveTo(xx, descrTop);
    ctx.lineTo(xx, descrBot);
  }
  ctx.stroke();

  const descrCols: Array<[string, string]> = [
    ['SCALE', data.descriptive.scale],
    ['PROJ', data.descriptive.projection === 'first-angle' ? '1st-angle' : '3rd-angle'],
    ['UNITS', data.descriptive.units],
    ['PAPER', data.descriptive.paperSize],
  ];
  for (let i = 0; i < descrCols.length; i++) {
    drawPair(
      ctx,
      x0 + descrColW * i + 1.5,
      descrTop - 1.5,
      descrCols[i][0],
      descrCols[i][1],
      1.5,
      2.4,
    );
  }

  // ---------- Administrative zone ----------------------------------------
  // 4 rows: drawn / checked / approved / designer. Each row has a name
  // and a date column.
  const rowH = layout.administrativeHeight / 4;
  const admNameW = layout.width * 0.6;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = adminTop - rowH * i;
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
  }
  ctx.moveTo(x0 + admNameW, adminTop);
  ctx.lineTo(x0 + admNameW, adminBot);
  ctx.stroke();

  const admLabels: Record<string, string> = {
    drawn: 'DRAWN',
    checked: 'CHECKED',
    approved: 'APPROVED',
    designer: 'DESIGNER',
  };
  for (let i = 0; i < data.administrative.rows.length; i++) {
    const row = data.administrative.rows[i];
    const yTop = adminTop - rowH * i;
    drawPair(
      ctx,
      x0 + 1.5,
      yTop - 1,
      admLabels[row.role] ?? row.role.toUpperCase(),
      row.name ?? '—',
      1.4,
      2.2,
    );
    if (row.role !== 'designer') {
      drawPair(
        ctx,
        x0 + admNameW + 1.5,
        yTop - 1,
        'DATE',
        formatDate(row.date),
        1.4,
        2.2,
      );
    } else if (data.administrative.originator) {
      drawPair(
        ctx,
        x0 + admNameW + 1.5,
        yTop - 1,
        'ORIG',
        data.administrative.originator,
        1.4,
        2.2,
      );
    }
  }

  // ---------- Revision zone ----------------------------------------------
  // Current revision on the left; status on the right.
  const revCurW = layout.width * 0.35;
  ctx.beginPath();
  ctx.moveTo(x0 + revCurW, revTop);
  ctx.lineTo(x0 + revCurW, revBot);
  ctx.stroke();

  drawPair(
    ctx,
    x0 + 1.5,
    revTop - 1,
    'REVISION',
    data.revision.current ?? '—',
    1.6,
    3.0,
  );
  const statusInfo = data.revision.status
    ? REVISION_STATUSES[data.revision.status as keyof typeof REVISION_STATUSES]
    : undefined;
  drawPair(
    ctx,
    x0 + revCurW + 1.5,
    revTop - 1,
    'STATUS',
    statusInfo
      ? `${statusInfo.code} ${statusInfo.name}`
      : data.revision.status ?? '—',
    1.6,
    2.4,
  );

  // ---------- Project info zone ------------------------------------------
  const projColW = layout.width / 3;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    const xx = x0 + projColW * i;
    ctx.moveTo(xx, projTop);
    ctx.lineTo(xx, projBot);
  }
  ctx.stroke();

  drawPair(
    ctx,
    x0 + 1.5,
    projTop - 1,
    'PROJECT',
    data.projectInfo.projectName,
    1.5,
    2.2,
  );
  drawPair(
    ctx,
    x0 + projColW + 1.5,
    projTop - 1,
    'CLIENT',
    data.projectInfo.client ?? '—',
    1.5,
    2.2,
  );
  drawPair(
    ctx,
    x0 + projColW * 2 + 1.5,
    projTop - 1,
    'CODE',
    data.projectInfo.projectCode ?? '—',
    1.5,
    2.2,
  );

  ctx.restore();
};
