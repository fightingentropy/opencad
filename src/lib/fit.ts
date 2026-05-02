import type { Sheet, Viewport, Bounds } from '../types';
import { entityBounds, emptyBounds, expandBounds } from './math';
import { transformSymbolPoint } from './hittest';
import { getSymbol } from '../symbols';

// Compute the viewport that fits all visible entities on a sheet to a canvas
// of the given pixel size. Falls back to fitting the page if there are no
// entities. Adds a fixed padding around the content.
export const fitViewportToSheet = (
  sheet: Sheet,
  canvasW: number,
  canvasH: number,
  paddingPx = 40
): Viewport => {
  let bounds: Bounds = emptyBounds();
  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (!e || !e.visible) continue;
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
        continue;
      }
    }
    const eb = entityBounds(e);
    if (isFinite(eb.minX)) {
      bounds = expandBounds(bounds, { x: eb.minX, y: eb.minY });
      bounds = expandBounds(bounds, { x: eb.maxX, y: eb.maxY });
    }
  }

  if (!isFinite(bounds.minX)) {
    bounds = { minX: 0, minY: 0, maxX: sheet.width, maxY: sheet.height };
  }

  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const zx = (canvasW - paddingPx * 2) / w;
  const zy = (canvasH - paddingPx * 2) / h;
  const zoom = Math.max(0.1, Math.min(50, Math.min(zx, zy)));
  return { x: cx, y: cy, zoom };
};
