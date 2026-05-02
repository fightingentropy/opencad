import type { Vec2, Viewport, Bounds } from '../types';
import { clamp } from './math';

// Convert screen pixel coordinates to world (mm) coordinates
export const screenToWorld = (
  screen: Vec2,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): Vec2 => ({
  x: (screen.x - canvasWidth / 2) / viewport.zoom + viewport.x,
  y: -(screen.y - canvasHeight / 2) / viewport.zoom + viewport.y,
});

export const worldToScreen = (
  world: Vec2,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): Vec2 => ({
  x: (world.x - viewport.x) * viewport.zoom + canvasWidth / 2,
  y: -(world.y - viewport.y) * viewport.zoom + canvasHeight / 2,
});

export const zoomAtPoint = (
  viewport: Viewport,
  screenPoint: Vec2,
  canvasWidth: number,
  canvasHeight: number,
  factor: number
): Viewport => {
  const newZoom = clamp(viewport.zoom * factor, 0.05, 200);
  const ratio = newZoom / viewport.zoom;
  // Keep the world point under the cursor stationary
  const wx = (screenPoint.x - canvasWidth / 2) / viewport.zoom + viewport.x;
  const wy = -(screenPoint.y - canvasHeight / 2) / viewport.zoom + viewport.y;
  const newWx = (screenPoint.x - canvasWidth / 2) / newZoom + viewport.x;
  const newWy = -(screenPoint.y - canvasHeight / 2) / newZoom + viewport.y;
  return {
    zoom: newZoom,
    x: viewport.x + (wx - newWx),
    y: viewport.y + (wy - newWy),
  };
};

export const fitBounds = (
  b: Bounds,
  canvasWidth: number,
  canvasHeight: number,
  padding = 40
): Viewport => {
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const zx = (canvasWidth - padding * 2) / w;
  const zy = (canvasHeight - padding * 2) / h;
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    zoom: Math.min(zx, zy),
  };
};
