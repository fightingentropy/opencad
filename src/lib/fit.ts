import type { Sheet, Viewport, Bounds, Entity } from '../types';
import { entityBounds, emptyBounds, expandBounds } from './math';
import { transformSymbolPoint } from './hittest';
import { getSymbol } from '../symbols';

const accumulateBounds = (
  bounds: Bounds,
  e: Entity
): Bounds => {
  if (e.kind === 'symbol') {
    const def = getSymbol(e.symbolId);
    if (def) {
      const corners = [
        { x: def.bounds.minX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.maxY },
        { x: def.bounds.minX, y: def.bounds.maxY },
      ].map((c) => transformSymbolPoint(e, c));
      for (const c of corners) bounds = expandBounds(bounds, c);
      return bounds;
    }
  }
  const eb = entityBounds(e);
  if (isFinite(eb.minX)) {
    bounds = expandBounds(bounds, { x: eb.minX, y: eb.minY });
    bounds = expandBounds(bounds, { x: eb.maxX, y: eb.maxY });
  }
  return bounds;
};

// Compute the viewport that fits all visible entities on a sheet to a canvas
// of the given pixel size. Annotation entities (text, dimensions, wire labels)
// are excluded from the primary fit so a long title or label can't bloat the
// bounding box and shrink the actual schematic. They still appear, just
// outside the tight crop. Falls back to including everything, then to the
// page bounds, if nothing else is visible.
export const fitViewportToSheet = (
  sheet: Sheet,
  canvasW: number,
  canvasH: number,
  paddingPx = 30
): Viewport => {
  let bounds: Bounds = emptyBounds();

  // Pass 1: schematic geometry only
  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (!e || !e.visible) continue;
    if (e.kind === 'text' || e.kind === 'dimension' || e.kind === 'wire-label') continue;
    bounds = accumulateBounds(bounds, e);
  }

  // Pass 2: include annotations if no geometry found
  if (!isFinite(bounds.minX)) {
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e || !e.visible) continue;
      bounds = accumulateBounds(bounds, e);
    }
  }

  // Pass 3: page fallback
  if (!isFinite(bounds.minX)) {
    bounds = { minX: 0, minY: 0, maxX: sheet.width, maxY: sheet.height };
  }

  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const zx = (canvasW - paddingPx * 2) / w;
  const zy = (canvasH - paddingPx * 2) / h;
  const zoom = Math.max(0.1, Math.min(80, Math.min(zx, zy)));
  return { x: cx, y: cy, zoom };
};
