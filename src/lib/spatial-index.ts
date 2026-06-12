// Uniform-grid spatial index over entity bounds.
//
// Snap and hit-testing previously scanned every entity on the sheet per
// mousemove (and the intersection snap paired every segment with every
// other — O(n^2)). The index buckets entities into a coarse grid keyed by
// their padded AABBs, so cursor-sized queries touch only a handful of
// cells and return just the entities that could possibly hit or snap.
//
// Invalidation is by object identity: every store mutation replaces the
// Sheet immutably (state/store.ts) and remote collab updates replace the
// whole project (collab/sync.ts), so caching one index per Sheet object in
// a WeakMap is always fresh and needs no explicit bookkeeping. A rebuild
// is a single O(n) pass — no worse than the full scan each query used to
// cost, and only paid on the first query after an edit.

import type {
  Bounds,
  Entity,
  EntityId,
  Sheet,
  SymbolDef,
  SymbolEntity,
  Vec2,
} from '../types';
import { entityBounds, rectsOverlap } from './math';

export type SymbolLookup = (id: string) => SymbolDef | undefined;

// Transform a point from symbol-local space to world space (scale, mirror,
// rotate, translate). Canonical implementation — hittest.ts re-exports it
// so existing import sites keep working.
export const transformSymbolPoint = (sym: SymbolEntity, p: Vec2): Vec2 => {
  const x = p.x * sym.scale * (sym.mirror ? -1 : 1);
  const y = p.y * sym.scale;
  const c = Math.cos(sym.rotation);
  const s = Math.sin(sym.rotation);
  return { x: sym.position.x + x * c - y * s, y: sym.position.y + x * s + y * c };
};

// World-space AABB of a symbol's def bounds — the exact box hitTestEntity
// tests against, so indexing with it can never miss a hit.
export const symbolWorldBounds = (sym: SymbolEntity, def: SymbolDef): Bounds => {
  const corners = [
    { x: def.bounds.minX, y: def.bounds.minY },
    { x: def.bounds.maxX, y: def.bounds.minY },
    { x: def.bounds.maxX, y: def.bounds.maxY },
    { x: def.bounds.minX, y: def.bounds.maxY },
  ].map((c) => transformSymbolPoint(sym, c));
  return corners.reduce(
    (b, c) => ({
      minX: Math.min(b.minX, c.x),
      minY: Math.min(b.minY, c.y),
      maxX: Math.max(b.maxX, c.x),
      maxY: Math.max(b.maxY, c.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
};

// Bounds used for indexing: entityBounds plus each kind's hit band, so a
// query inflated by the pixel tolerance alone is a superset of everything
// that can hit-test true or contribute a snap point. Returns null for
// extent-less entities (groups) which never hit-test true anyway.
const indexBounds = (e: Entity, symbolLookup: SymbolLookup): Bounds | null => {
  let b: Bounds;
  if (e.kind === 'symbol') {
    const def = symbolLookup(e.symbolId);
    // With a def: the transformed def bounds hit-testing uses. Without:
    // entityBounds' 30·scale box, which covers both the 10·scale fallback
    // hit radius and the position snap point.
    b = def ? symbolWorldBounds(e, def) : entityBounds(e);
  } else {
    b = entityBounds(e);
  }
  if (
    !Number.isFinite(b.minX) ||
    !Number.isFinite(b.minY) ||
    !Number.isFinite(b.maxX) ||
    !Number.isFinite(b.maxY)
  ) {
    return null;
  }
  // Band pads mirror hitTestEntity: containments hit within width/2 of the
  // centerline, walls within thickness/2.
  let pad = 0;
  if (e.kind === 'containment') pad = Math.max(2, (e.width ?? 50) / 2);
  else if (e.kind === 'wall') pad = Math.max(2, (e.thickness ?? 100) / 2);
  if (pad === 0) return b;
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
};

interface IndexEntry {
  id: EntityId;
  // Position in sheet.entityOrder — query results sort by this so callers
  // keep the draw-order semantics of the old full scans.
  order: number;
  bounds: Bounds;
}

export interface SheetSpatialIndex {
  // Ids of entities whose indexed bounds overlap `region`, ascending draw
  // order. Callers still apply visibility/layer filters and exact tests.
  query: (region: Bounds) => EntityId[];
}

// Grid resolution along the larger axis of the sheet extents. Coarse
// enough that builds stay cheap, fine enough that a tolerance-sized query
// touches only a few cells.
const GRID_DIM = 64;
// Entries that would land in more cells than this (huge underlays, sheet-
// spanning rectangles) go to an always-scanned broad list instead.
const MAX_CELLS_PER_ENTRY = 256;

export const buildSpatialIndex = (
  sheet: Sheet,
  symbolLookup: SymbolLookup
): SheetSpatialIndex => {
  const entries: IndexEntry[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let order = 0; order < sheet.entityOrder.length; order++) {
    const id = sheet.entityOrder[order];
    const e = sheet.entities[id];
    if (!e) continue;
    const b = indexBounds(e, symbolLookup);
    if (!b) continue;
    entries.push({ id, order, bounds: b });
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  const extent = Math.max(maxX - minX, maxY - minY);
  // Degenerate sheets (single point, empty) collapse to one 1mm cell.
  const cellSize = Math.max(extent / GRID_DIM, 1);
  const cellOf = (v: number) => Math.floor(v / cellSize);
  // Occupied cell range — queries clamp to it so an oversized marquee
  // doesn't walk empty space.
  const minCx = cellOf(minX);
  const minCy = cellOf(minY);
  const maxCx = cellOf(maxX);
  const maxCy = cellOf(maxY);

  const cells = new Map<string, number[]>();
  const broad: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const b = entries[i].bounds;
    const x0 = cellOf(b.minX);
    const x1 = cellOf(b.maxX);
    const y0 = cellOf(b.minY);
    const y1 = cellOf(b.maxY);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_ENTRY) {
      broad.push(i);
      continue;
    }
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        const cell = cells.get(key);
        if (cell) cell.push(i);
        else cells.set(key, [i]);
      }
    }
  }

  const query = (region: Bounds): EntityId[] => {
    if (entries.length === 0) return [];
    const hits: number[] = [];
    for (const i of broad) {
      if (rectsOverlap(entries[i].bounds, region)) hits.push(i);
    }
    const x0 = Math.max(minCx, cellOf(region.minX));
    const x1 = Math.min(maxCx, cellOf(region.maxX));
    const y0 = Math.max(minCy, cellOf(region.minY));
    const y1 = Math.min(maxCy, cellOf(region.maxY));
    const seen = new Set<number>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cells.get(`${cx},${cy}`);
        if (!cell) continue;
        for (const i of cell) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (rectsOverlap(entries[i].bounds, region)) hits.push(i);
        }
      }
    }
    hits.sort((a, b) => entries[a].order - entries[b].order);
    return hits.map((i) => entries[i].id);
  };

  return { query };
};

interface CachedIndex {
  symbolLookup: SymbolLookup;
  index: SheetSpatialIndex;
}

const indexCache = new WeakMap<Sheet, CachedIndex>();

// Cached accessor — rebuilds when the Sheet object identity changes (every
// store mutation creates a new one) or a different symbol lookup is passed.
export const getSpatialIndex = (
  sheet: Sheet,
  symbolLookup: SymbolLookup
): SheetSpatialIndex => {
  const cached = indexCache.get(sheet);
  if (cached && cached.symbolLookup === symbolLookup) return cached.index;
  const index = buildSpatialIndex(sheet, symbolLookup);
  indexCache.set(sheet, { symbolLookup, index });
  return index;
};
