import type {
  Entity,
  Project,
  Sheet,
  EditorState,
  Vec2,
  Layer,
  SymbolEntity,
  EntityId,
  SymbolPrimitive,
} from '../types';
import { worldToScreen } from '../lib/viewport';
import type { SymbolDef } from '../types';
import { transformSymbolPoint } from '../lib/hittest';
import { entityBounds } from '../lib/math';

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  symbolLookup: (id: string) => SymbolDef | undefined;
}

const SELECTION_COLOR = '#ffd84d';
const HOVER_COLOR = '#5cdcff';
const PIN_COLOR = '#3ba3ff';
const SNAP_COLOR = '#ffd84d';

export const render2d = (
  ctx: CanvasRenderingContext2D,
  project: Project,
  editor: EditorState,
  opts: RenderOptions
): void => {
  const { width, height, dpr } = opts;
  ctx.save();
  // Clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.scale(dpr, dpr);

  const sheet = project.sheets[project.activeSheetId];
  if (!sheet) {
    ctx.restore();
    return;
  }

  const v = editor.viewport;

  // Background
  ctx.fillStyle = sheet.background ?? '#0a0e14';
  ctx.fillRect(0, 0, width, height);

  // Grid
  drawGrid(ctx, editor, project, opts);

  // Page boundary
  drawPageBoundary(ctx, sheet, editor, opts);

  // Entities
  ctx.save();
  // Set up world-to-screen transform.
  // x' = (x - vx) * z + W/2 ; y' = -(y - vy) * z + H/2
  // i.e. setTransform(z, 0, 0, -z, W/2 - vx*z, H/2 + vy*z)
  ctx.setTransform(
    dpr * v.zoom,
    0,
    0,
    -dpr * v.zoom,
    dpr * (width / 2 - v.x * v.zoom),
    dpr * (height / 2 + v.y * v.zoom)
  );

  const layerVisible = (id: string) => project.layers[id]?.visible ?? true;

  for (const entityId of sheet.entityOrder) {
    const e = sheet.entities[entityId];
    if (!e || !e.visible) continue;
    const layer = project.layers[e.layerId];
    if (!layer || !layer.visible) continue;
    const isSelected = editor.selection.has(entityId);
    const isHovered = editor.hover === entityId && !isSelected;
    drawEntity(ctx, e, layer, opts, { isSelected, isHovered, zoom: v.zoom });
  }

  // Drafting preview
  if (editor.drafting) {
    drawDrafting(ctx, editor, opts);
  }

  // Symbol placement preview
  if (editor.tool === 'symbol' && editor.pendingSymbol) {
    const def = opts.symbolLookup(editor.pendingSymbol);
    if (def) {
      const pos = editor.cursorSnap ?? editor.cursor;
      drawSymbolPrimitives(ctx, def.primitives, {
        position: pos,
        rotation: 0,
        scale: 1,
        mirror: false,
      }, '#5cdcff', 0.4, true);
    }
  }

  // Pin highlights at cursor
  drawPinHighlights(ctx, sheet, editor, opts, layerVisible);

  ctx.restore();

  // Snap indicator (in screen space, no transform)
  if (editor.cursorSnap && editor.snap.enabled) {
    drawSnapIndicator(ctx, editor, opts);
  }

  // Crosshair
  drawCrosshair(ctx, editor, opts);

  ctx.restore();
};

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  editor: EditorState,
  project: Project,
  opts: RenderOptions
) => {
  const { width, height } = opts;
  const v = editor.viewport;
  const gs = editor.snap.gridSize || 5;
  // Compute world bounds of viewport
  const wMinX = (-width / 2) / v.zoom + v.x;
  const wMaxX = (width / 2) / v.zoom + v.x;
  const wMinY = -(height / 2) / v.zoom + v.y;
  const wMaxY = (height / 2) / v.zoom + v.y;

  const pxPerUnit = v.zoom * gs;
  if (pxPerUnit < 4) return; // too dense, skip

  const major = 5; // every 5 grid units = a major line

  ctx.lineWidth = 1;
  // Minor grid
  ctx.strokeStyle = '#141a25';
  ctx.beginPath();
  const startX = Math.floor(wMinX / gs) * gs;
  const endX = Math.ceil(wMaxX / gs) * gs;
  const startY = Math.floor(wMinY / gs) * gs;
  const endY = Math.ceil(wMaxY / gs) * gs;
  for (let x = startX; x <= endX; x += gs) {
    if (Math.round(x / gs) % major === 0) continue;
    const sx = (x - v.x) * v.zoom + width / 2;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }
  for (let y = startY; y <= endY; y += gs) {
    if (Math.round(y / gs) % major === 0) continue;
    const sy = -(y - v.y) * v.zoom + height / 2;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();

  // Major grid
  ctx.strokeStyle = '#1f2a3d';
  ctx.beginPath();
  for (let x = startX; x <= endX; x += gs) {
    if (Math.round(x / gs) % major !== 0) continue;
    const sx = (x - v.x) * v.zoom + width / 2;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }
  for (let y = startY; y <= endY; y += gs) {
    if (Math.round(y / gs) % major !== 0) continue;
    const sy = -(y - v.y) * v.zoom + height / 2;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();

  // Origin axes
  const ox = (0 - v.x) * v.zoom + width / 2;
  const oy = -(0 - v.y) * v.zoom + height / 2;
  ctx.strokeStyle = '#3a4660';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ox >= 0 && ox <= width) {
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, height);
  }
  if (oy >= 0 && oy <= height) {
    ctx.moveTo(0, oy);
    ctx.lineTo(width, oy);
  }
  ctx.stroke();
};

const drawPageBoundary = (
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  editor: EditorState,
  opts: RenderOptions
) => {
  const { width, height } = opts;
  const v = editor.viewport;
  // Page from (0,0) to (width, height) in mm
  const a = worldToScreen({ x: 0, y: 0 }, v, width, height);
  const b = worldToScreen({ x: sheet.width, y: sheet.height }, v, width, height);
  // page interior
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x + 4, y + 4, w, h);

  // page background slightly lighter
  ctx.fillStyle = '#0d131c';
  ctx.fillRect(x, y, w, h);

  // border
  ctx.strokeStyle = '#445575';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  // title block area in lower-right (60mm wide x 30mm tall)
  const tbW = Math.min(60 * v.zoom, w * 0.45);
  const tbH = Math.min(30 * v.zoom, h * 0.25);
  ctx.strokeStyle = '#445575';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + w - tbW - 4, y + h - tbH - 4, tbW, tbH);
  // sub-divisions
  ctx.strokeStyle = '#2c3a52';
  ctx.beginPath();
  ctx.moveTo(x + w - tbW - 4, y + h - tbH * 0.66 - 4);
  ctx.lineTo(x + w - 4, y + h - tbH * 0.66 - 4);
  ctx.moveTo(x + w - tbW - 4, y + h - tbH * 0.33 - 4);
  ctx.lineTo(x + w - 4, y + h - tbH * 0.33 - 4);
  ctx.moveTo(x + w - tbW * 0.5 - 4, y + h - tbH - 4);
  ctx.lineTo(x + w - tbW * 0.5 - 4, y + h - 4);
  ctx.stroke();

  // Title block text (rendered when zoomed enough)
  if (tbW > 80) {
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `${Math.min(10, tbH * 0.2)}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText('OPENCAD ELECTRICAL', x + w - tbW + 2, y + h - tbH);
    ctx.fillStyle = '#e6e8ec';
    ctx.font = `${Math.min(11, tbH * 0.22)}px sans-serif`;
    ctx.fillText(sheet.name, x + w - tbW + 2, y + h - tbH + tbH * 0.34);
    ctx.fillStyle = '#9aa3b2';
    ctx.font = `${Math.min(9, tbH * 0.18)}px ui-monospace, monospace`;
    ctx.fillText(`SHEET ${sheet.number}`, x + w - tbW + 2, y + h - tbH + tbH * 0.7);
    ctx.fillText(sheet.kind.toUpperCase(), x + w - tbW * 0.5 + 2, y + h - tbH + tbH * 0.7);
  }
};

const drawEntity = (
  ctx: CanvasRenderingContext2D,
  e: Entity,
  layer: Layer,
  opts: RenderOptions,
  state: { isSelected: boolean; isHovered: boolean; zoom: number }
) => {
  const color = e.color ?? layer.color;
  const lineWidth = (e.lineWidth ?? layer.lineWidth) * 1.0;
  const dash = e.lineDash ?? layer.lineDash;

  // Inverse-scale line width so it renders at constant pixel width-ish but still scales a bit
  const effectiveWidth = lineWidth;

  ctx.strokeStyle = state.isSelected ? SELECTION_COLOR : state.isHovered ? HOVER_COLOR : color;
  ctx.lineWidth = effectiveWidth;
  ctx.setLineDash(dash ?? []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (e.kind) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
      break;
    case 'polyline':
      if (e.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(e.points[0].x, e.points[0].y);
        for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
        if (e.closed) ctx.closePath();
        ctx.stroke();
      }
      break;
    case 'wire': {
      // wires get a slight glow on hover/selection and connection dots at junctions
      ctx.strokeStyle = state.isSelected
        ? SELECTION_COLOR
        : state.isHovered
        ? HOVER_COLOR
        : color || '#ff3a3a';
      if (e.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(e.points[0].x, e.points[0].y);
        for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
        ctx.stroke();
      }
      // wire number label
      if (e.wireNumber) {
        const mid = e.points[Math.floor(e.points.length / 2) - 1] ?? e.points[0];
        const next = e.points[Math.floor(e.points.length / 2)] ?? e.points[1];
        if (mid && next) {
          const cx = (mid.x + next.x) / 2;
          const cy = (mid.y + next.y) / 2;
          ctx.save();
          ctx.scale(1, -1);
          ctx.fillStyle = '#ffd84d';
          ctx.font = '3px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(e.wireNumber, cx, -cy + 2.5);
          ctx.restore();
        }
      }
      break;
    }
    case 'bus':
      if (e.points.length >= 2) {
        ctx.lineWidth = effectiveWidth * 3;
        ctx.beginPath();
        ctx.moveTo(e.points[0].x, e.points[0].y);
        for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
        ctx.stroke();
      }
      break;
    case 'rectangle': {
      const x = Math.min(e.a.x, e.b.x);
      const y = Math.min(e.a.y, e.b.y);
      const w = Math.abs(e.b.x - e.a.x);
      const h = Math.abs(e.b.y - e.a.y);
      if (e.fill) {
        ctx.fillStyle = e.fill;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle':
      ctx.beginPath();
      ctx.arc(e.center.x, e.center.y, e.radius, 0, Math.PI * 2);
      if (e.fill) {
        ctx.fillStyle = e.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    case 'arc':
      ctx.beginPath();
      ctx.arc(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle);
      ctx.stroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(e.center.x, e.center.y, e.rx, e.ry, e.rotation, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'text':
      // Canvas y-flip means text rendering needs to be flipped
      ctx.save();
      ctx.translate(e.position.x, e.position.y);
      ctx.scale(1, -1);
      ctx.rotate(-e.rotation);
      ctx.fillStyle = state.isSelected ? SELECTION_COLOR : color;
      ctx.font = `${e.fontSize}px sans-serif`;
      ctx.textAlign = (e.align ?? 'left') as CanvasTextAlign;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(e.text, 0, 0);
      ctx.restore();
      break;
    case 'symbol': {
      drawSymbol(ctx, e, opts, state, layer);
      break;
    }
    case 'dimension':
      drawDimension(ctx, e, color, effectiveWidth, state);
      break;
    case 'wire-label':
      ctx.save();
      ctx.translate(e.position.x, e.position.y);
      ctx.scale(1, -1);
      ctx.rotate(-e.rotation);
      ctx.fillStyle = state.isSelected ? SELECTION_COLOR : '#ffd84d';
      ctx.font = '3px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.text, 0, 0);
      ctx.restore();
      break;
    case 'containment':
      drawContainment(ctx, e, color, state);
      break;
    case 'wall':
      drawWall(ctx, e, color, state);
      break;
    case 'room':
      drawRoom(ctx, e, layer, color, state);
      break;
    case 'group':
      break;
  }

  // Selection bounding box
  if (state.isSelected) {
    drawSelectionBox(ctx, e, opts);
  }
};

const drawSymbol = (
  ctx: CanvasRenderingContext2D,
  sym: SymbolEntity,
  opts: RenderOptions,
  state: { isSelected: boolean; isHovered: boolean; zoom: number },
  layer: Layer
) => {
  const def = opts.symbolLookup(sym.symbolId);
  if (!def) {
    // missing symbol — draw placeholder
    ctx.save();
    ctx.translate(sym.position.x, sym.position.y);
    ctx.fillStyle = '#ff5d5d';
    ctx.font = '3px sans-serif';
    ctx.fillText('?', -1, 0);
    ctx.strokeStyle = '#ff5d5d';
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
    return;
  }
  const color = state.isSelected
    ? SELECTION_COLOR
    : state.isHovered
    ? HOVER_COLOR
    : sym.color ?? layer.color;

  drawSymbolPrimitives(ctx, def.primitives, sym, color, sym.lineWidth ?? layer.lineWidth);

  // Tag label (above symbol)
  if (sym.tag) {
    ctx.save();
    ctx.translate(sym.position.x, sym.position.y + def.bounds.maxY * sym.scale + 1.5);
    ctx.scale(1, -1);
    ctx.fillStyle = state.isSelected ? SELECTION_COLOR : '#9ad65a';
    ctx.font = 'bold 3px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(sym.tag, 0, 0);
    ctx.restore();
  }
  // Description label (below symbol)
  if (sym.description) {
    ctx.save();
    ctx.translate(sym.position.x, sym.position.y + def.bounds.minY * sym.scale - 1.5);
    ctx.scale(1, -1);
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '2.4px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(sym.description, 0, 0);
    ctx.restore();
  }

  // Pins (small dots)
  ctx.fillStyle = state.isSelected ? SELECTION_COLOR : PIN_COLOR;
  for (const p of def.pins) {
    const wp = transformSymbolPoint(sym, p.position);
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const drawSymbolPrimitives = (
  ctx: CanvasRenderingContext2D,
  primitives: SymbolPrimitive[],
  sym: Pick<SymbolEntity, 'position' | 'rotation' | 'scale' | 'mirror'>,
  color: string,
  lineWidth: number,
  ghost = false
): void => {
  ctx.save();
  ctx.translate(sym.position.x, sym.position.y);
  ctx.rotate(sym.rotation);
  ctx.scale(sym.scale * (sym.mirror ? -1 : 1), sym.scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (ghost) {
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([1, 1]);
  } else {
    ctx.setLineDash([]);
  }

  for (const p of primitives) {
    switch (p.kind) {
      case 'line':
        ctx.lineWidth = (p.lineWidth ?? lineWidth);
        ctx.beginPath();
        ctx.moveTo(p.a.x, p.a.y);
        ctx.lineTo(p.b.x, p.b.y);
        ctx.stroke();
        break;
      case 'circle':
        ctx.lineWidth = (p.lineWidth ?? lineWidth);
        ctx.beginPath();
        ctx.arc(p.c.x, p.c.y, p.r, 0, Math.PI * 2);
        if (p.fill) {
          const prev: string | CanvasGradient | CanvasPattern = ctx.fillStyle;
          ctx.fillStyle = p.fill;
          ctx.fill();
          ctx.fillStyle = prev;
        }
        ctx.stroke();
        break;
      case 'arc':
        ctx.lineWidth = (p.lineWidth ?? lineWidth);
        ctx.beginPath();
        ctx.arc(p.c.x, p.c.y, p.r, p.start, p.end);
        ctx.stroke();
        break;
      case 'rect': {
        const x = Math.min(p.a.x, p.b.x);
        const y = Math.min(p.a.y, p.b.y);
        const w = Math.abs(p.b.x - p.a.x);
        const h = Math.abs(p.b.y - p.a.y);
        ctx.lineWidth = (p.lineWidth ?? lineWidth);
        if (p.fill) {
          const prev: string | CanvasGradient | CanvasPattern = ctx.fillStyle;
          ctx.fillStyle = p.fill;
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = prev;
        }
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'polyline':
        ctx.lineWidth = (p.lineWidth ?? lineWidth);
        if (p.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(p.points[0].x, p.points[0].y);
          for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
          if (p.closed) ctx.closePath();
          if (p.fill) {
            const prev: string | CanvasGradient | CanvasPattern = ctx.fillStyle;
            ctx.fillStyle = p.fill;
            ctx.fill();
            ctx.fillStyle = prev;
          }
          ctx.stroke();
        }
        break;
      case 'text':
        ctx.save();
        ctx.translate(p.p.x, p.p.y);
        ctx.scale(1, -1);
        ctx.fillStyle = color;
        ctx.font = `${p.size}px sans-serif`;
        ctx.textAlign = (p.align ?? 'left') as CanvasTextAlign;
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        break;
    }
  }
  ctx.restore();
};

const drawDimension = (
  ctx: CanvasRenderingContext2D,
  e: import('../types').DimensionEntity,
  color: string,
  lineWidth: number,
  state: { isSelected: boolean }
) => {
  const dx = e.b.x - e.a.x;
  const dy = e.b.y - e.a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const nx = -dy / len;
  const ny = dx / len;
  const ax = e.a.x + nx * e.offset;
  const ay = e.a.y + ny * e.offset;
  const bx = e.b.x + nx * e.offset;
  const by = e.b.y + ny * e.offset;

  ctx.strokeStyle = state.isSelected ? SELECTION_COLOR : color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  // extension lines
  ctx.moveTo(e.a.x, e.a.y);
  ctx.lineTo(ax, ay);
  ctx.moveTo(e.b.x, e.b.y);
  ctx.lineTo(bx, by);
  // dimension line
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // arrowheads
  const arrSize = 1.5;
  const angle = Math.atan2(by - ay, bx - ax);
  drawArrowhead(ctx, ax, ay, angle, arrSize);
  drawArrowhead(ctx, bx, by, angle + Math.PI, arrSize);

  // text
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, -1);
  ctx.rotate(-angle);
  ctx.fillStyle = state.isSelected ? SELECTION_COLOR : color;
  ctx.font = '2.4px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(e.text ?? `${len.toFixed(1)}mm`, 0, -0.5);
  ctx.restore();
};

const drawArrowhead = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number
) => {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle - Math.PI + 0.4) * size, y + Math.sin(angle - Math.PI + 0.4) * size);
  ctx.lineTo(x + Math.cos(angle - Math.PI - 0.4) * size, y + Math.sin(angle - Math.PI - 0.4) * size);
  ctx.closePath();
  ctx.fill();
};

const drawSelectionBox = (ctx: CanvasRenderingContext2D, e: Entity, opts: RenderOptions) => {
  let bb = entityBounds(e);
  if (e.kind === 'symbol') {
    const def = opts.symbolLookup(e.symbolId);
    if (def) {
      const corners = [
        { x: def.bounds.minX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.maxY },
        { x: def.bounds.minX, y: def.bounds.maxY },
      ].map((c) => transformSymbolPoint(e, c));
      bb = corners.reduce(
        (b, c) => ({
          minX: Math.min(b.minX, c.x),
          minY: Math.min(b.minY, c.y),
          maxX: Math.max(b.maxX, c.x),
          maxY: Math.max(b.maxY, c.y),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      );
    }
  }
  if (!isFinite(bb.minX)) return;
  const pad = 1.5;
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 0.3;
  ctx.setLineDash([1.2, 1]);
  ctx.strokeRect(bb.minX - pad, bb.minY - pad, bb.maxX - bb.minX + pad * 2, bb.maxY - bb.minY + pad * 2);
  ctx.setLineDash([]);
  // grips at corners and midpoints
  const grips: Vec2[] = [
    { x: bb.minX, y: bb.minY },
    { x: bb.maxX, y: bb.minY },
    { x: bb.maxX, y: bb.maxY },
    { x: bb.minX, y: bb.maxY },
    { x: (bb.minX + bb.maxX) / 2, y: bb.minY },
    { x: bb.maxX, y: (bb.minY + bb.maxY) / 2 },
    { x: (bb.minX + bb.maxX) / 2, y: bb.maxY },
    { x: bb.minX, y: (bb.minY + bb.maxY) / 2 },
  ];
  ctx.fillStyle = SELECTION_COLOR;
  for (const g of grips) {
    ctx.fillRect(g.x - 0.6, g.y - 0.6, 1.2, 1.2);
  }
  ctx.restore();
};

// Render a containment run (trunking / basket / tray / conduit) as a thick
// band along its polyline. Different types layer on extra strokes to read
// distinctly in plan view.
const drawContainment = (
  ctx: CanvasRenderingContext2D,
  e: import('../types').ContainmentEntity,
  color: string,
  state: { isSelected: boolean; isHovered: boolean; zoom: number }
) => {
  if (e.points.length < 2) return;
  const w = e.width ?? 50;
  const stroke = state.isSelected
    ? SELECTION_COLOR
    : state.isHovered
    ? HOVER_COLOR
    : color;

  ctx.save();
  ctx.lineCap = e.containmentType === 'conduit' ? 'round' : 'butt';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // Build the polyline path.
  const path = new Path2D();
  path.moveTo(e.points[0].x, e.points[0].y);
  for (let i = 1; i < e.points.length; i++) {
    path.lineTo(e.points[i].x, e.points[i].y);
  }

  if (e.containmentType === 'conduit') {
    // Round tube — single thick line, plus a thin centerline highlight.
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = w;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(0.4, w * 0.06);
    ctx.stroke(path);
  } else {
    // Filled band for the cross-section.
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = e.containmentType === 'basket' ? 0.18 : 0.32;
    ctx.lineWidth = w;
    ctx.stroke(path);
    ctx.globalAlpha = 1;

    // Edge highlights — outline the band with thinner lines on either side
    // of the centerline by re-stroking with reduced width using a lighter
    // alpha, then a thin centerline.
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.stroke(path);

    // Type-specific overlay markings drawn as evenly-spaced ticks along the
    // path so the type is recognizable at a glance.
    drawContainmentTicks(ctx, e, w, stroke);
  }

  ctx.restore();
};

// Walk each segment of a containment run and draw short perpendicular
// "ticks" (the rungs of a basket, the perforations of a tray) at fixed
// world-space intervals.
const drawContainmentTicks = (
  ctx: CanvasRenderingContext2D,
  e: import('../types').ContainmentEntity,
  w: number,
  color: string
) => {
  if (e.containmentType === 'trunking') return; // smooth band, no ticks

  const spacing = e.containmentType === 'tray' ? Math.max(8, w * 0.4) : Math.max(6, w * 0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = e.containmentType === 'tray' ? 0.4 : 0.5;
  ctx.setLineDash([]);

  for (let i = 0; i < e.points.length - 1; i++) {
    const a = e.points[i];
    const b = e.points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy; // perpendicular
    const py = ux;
    const half = w / 2;

    for (let s = spacing / 2; s < len; s += spacing) {
      const cx = a.x + ux * s;
      const cy = a.y + uy * s;
      if (e.containmentType === 'basket') {
        // X-shaped crossings at each rung
        ctx.beginPath();
        ctx.moveTo(cx + ux * (spacing * 0.3) - px * half, cy + uy * (spacing * 0.3) - py * half);
        ctx.lineTo(cx - ux * (spacing * 0.3) + px * half, cy - uy * (spacing * 0.3) + py * half);
        ctx.moveTo(cx - ux * (spacing * 0.3) - px * half, cy - uy * (spacing * 0.3) - py * half);
        ctx.lineTo(cx + ux * (spacing * 0.3) + px * half, cy + uy * (spacing * 0.3) + py * half);
        ctx.stroke();
      } else if (e.containmentType === 'tray') {
        // Single perpendicular line — perforated tray rung
        ctx.beginPath();
        ctx.moveTo(cx - px * half, cy - py * half);
        ctx.lineTo(cx + px * half, cy + py * half);
        ctx.stroke();
      }
    }
  }
};

// Render a wall as the standard architectural double-line: a thick translucent
// band at the wall's true thickness with a thin centerline outline so corners
// read cleanly in plan view.
const drawWall = (
  ctx: CanvasRenderingContext2D,
  e: import('../types').WallEntity,
  color: string,
  state: { isSelected: boolean; isHovered: boolean; zoom: number }
) => {
  if (e.points.length < 2) return;
  const stroke = state.isSelected
    ? SELECTION_COLOR
    : state.isHovered
    ? HOVER_COLOR
    : color;
  const t = e.thickness ?? 200;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);

  const path = new Path2D();
  path.moveTo(e.points[0].x, e.points[0].y);
  for (let i = 1; i < e.points.length; i++) {
    path.lineTo(e.points[i].x, e.points[i].y);
  }

  // Thick translucent band at full wall thickness.
  ctx.strokeStyle = stroke;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = t;
  ctx.stroke(path);
  ctx.globalAlpha = 1;

  // Thin centerline outline so corners read cleanly.
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(0.4, t * 0.04);
  ctx.stroke(path);

  ctx.restore();
};

// Render a room as a translucent rectangular floor patch with a dashed
// boundary, plus an optional centered name label.
const drawRoom = (
  ctx: CanvasRenderingContext2D,
  e: import('../types').RoomEntity,
  layer: Layer,
  color: string,
  state: { isSelected: boolean; isHovered: boolean; zoom: number }
) => {
  const x = Math.min(e.a.x, e.b.x);
  const y = Math.min(e.a.y, e.b.y);
  const w = Math.abs(e.b.x - e.a.x);
  const h = Math.abs(e.b.y - e.a.y);
  if (w <= 0 || h <= 0) return;
  const stroke = state.isSelected
    ? SELECTION_COLOR
    : state.isHovered
    ? HOVER_COLOR
    : color;

  ctx.save();
  // Translucent floor fill.
  ctx.fillStyle = e.floorColor ?? layer.color;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;

  // Dashed boundary in the layer color.
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.4;
  ctx.setLineDash([2, 1.5]);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Centered room name label (unflipped — see text case for pattern).
  if (e.name) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const size = Math.max(3, Math.min(10, Math.min(w, h) * 0.08));
    ctx.save();
    ctx.scale(1, -1);
    ctx.fillStyle = state.isSelected ? SELECTION_COLOR : color;
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e.name, cx, -cy);
    ctx.restore();
  }
  ctx.restore();
};

const drawDrafting = (
  ctx: CanvasRenderingContext2D,
  editor: EditorState,
  _opts: RenderOptions
) => {
  const d = editor.drafting!;
  if (d.points.length === 0) return;
  const cur = editor.cursorSnap ?? editor.cursor;
  ctx.save();
  ctx.strokeStyle = '#5cdcff';
  ctx.fillStyle = '#5cdcff';
  ctx.lineWidth = 0.4;
  ctx.setLineDash([1, 1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (d.tool) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      break;
    case 'rectangle': {
      const a = d.points[0];
      ctx.strokeRect(
        Math.min(a.x, cur.x),
        Math.min(a.y, cur.y),
        Math.abs(cur.x - a.x),
        Math.abs(cur.y - a.y)
      );
      break;
    }
    case 'circle': {
      const a = d.points[0];
      const r = Math.hypot(cur.x - a.x, cur.y - a.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'arc': {
      if (d.points.length === 1) {
        // center -> radius
        const a = d.points[0];
        const r = Math.hypot(cur.x - a.x, cur.y - a.y);
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (d.points.length === 2) {
        const c = d.points[0];
        const start = Math.atan2(d.points[1].y - c.y, d.points[1].x - c.x);
        const end = Math.atan2(cur.y - c.y, cur.x - c.x);
        const r = Math.hypot(d.points[1].x - c.x, d.points[1].y - c.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, start, end);
        ctx.stroke();
      }
      break;
    }
    case 'polyline':
    case 'wire':
    case 'bus': {
      if (d.tool === 'bus') ctx.lineWidth = 1.2;
      if (d.tool === 'wire') ctx.strokeStyle = '#ff7a7a';
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      break;
    }
    case 'trunking':
    case 'basket':
    case 'tray':
    case 'conduit': {
      // Preview the band at its real width with a translucent fill so the
      // user can see the run's footprint while drafting.
      const widths: Record<string, number> = {
        trunking: 100,
        basket: 100,
        tray: 150,
        conduit: 25,
      };
      const w = widths[d.tool] ?? 50;
      ctx.save();
      ctx.lineCap = d.tool === 'conduit' ? 'round' : 'butt';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      // Centerline on top
      ctx.globalAlpha = 1;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1, 1]);
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'wall': {
      // Translucent band preview at the default wall thickness, plus a
      // dashed centerline overlay for the in-progress polyline.
      const t = 200;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = t;
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      // Centerline on top
      ctx.globalAlpha = 1;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1, 1]);
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'room': {
      const a = d.points[0];
      ctx.strokeRect(
        Math.min(a.x, cur.x),
        Math.min(a.y, cur.y),
        Math.abs(cur.x - a.x),
        Math.abs(cur.y - a.y)
      );
      break;
    }
    case 'dimension': {
      if (d.points.length === 1) {
        ctx.beginPath();
        ctx.moveTo(d.points[0].x, d.points[0].y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
      break;
    }
    case 'measure': {
      if (d.points.length === 1) {
        const a = d.points[0];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
};

const drawPinHighlights = (
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  editor: EditorState,
  opts: RenderOptions,
  layerVisible: (id: string) => boolean
) => {
  // pulse pin on hover
  const cursor = editor.cursorSnap ?? editor.cursor;
  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (!e || !e.visible || !layerVisible(e.layerId)) continue;
    if (e.kind !== 'symbol') continue;
    const def = opts.symbolLookup(e.symbolId);
    if (!def) continue;
    for (const pin of def.pins) {
      const wp = transformSymbolPoint(e, pin.position);
      const d = Math.hypot(wp.x - cursor.x, wp.y - cursor.y);
      if (d < 3) {
        ctx.save();
        ctx.strokeStyle = PIN_COLOR;
        ctx.fillStyle = 'rgba(59,163,255,0.2)';
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }
};

const drawSnapIndicator = (
  ctx: CanvasRenderingContext2D,
  editor: EditorState,
  opts: RenderOptions
) => {
  const v = editor.viewport;
  const w = opts.width;
  const h = opts.height;
  const sp = worldToScreen(editor.cursorSnap!, v, w, h);
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.fillStyle = SNAP_COLOR;
  ctx.lineWidth = 1.2;
  // marker varies with snap kind — for now draw a square + label
  ctx.beginPath();
  ctx.rect(sp.x - 5, sp.y - 5, 10, 10);
  ctx.stroke();
  // small inner cross
  ctx.beginPath();
  ctx.moveTo(sp.x - 2, sp.y);
  ctx.lineTo(sp.x + 2, sp.y);
  ctx.moveTo(sp.x, sp.y - 2);
  ctx.lineTo(sp.x, sp.y + 2);
  ctx.stroke();
  ctx.restore();
};

const drawCrosshair = (
  ctx: CanvasRenderingContext2D,
  editor: EditorState,
  opts: RenderOptions
) => {
  const v = editor.viewport;
  const c = editor.cursorSnap ?? editor.cursor;
  const sp = worldToScreen(c, v, opts.width, opts.height);
  ctx.save();
  ctx.strokeStyle = 'rgba(155, 200, 255, 0.4)';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(0, sp.y);
  ctx.lineTo(opts.width, sp.y);
  ctx.moveTo(sp.x, 0);
  ctx.lineTo(sp.x, opts.height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
};

export const getEntityIds = (sheet: Sheet): EntityId[] => sheet.entityOrder;
