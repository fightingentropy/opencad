import type { Entity, EntityId, Vec2, Sheet, SymbolEntity, Bounds } from '../types';
import {
  distToSegment,
  dist,
  pointInRect,
  rectsOverlap,
  entityBounds,
} from './math';
import type { SymbolDef } from '../types';
import { getSpatialIndex, symbolWorldBounds, transformSymbolPoint } from './spatial-index';

export interface HitOptions {
  // pixel tolerance in screen space
  tolerance: number;
  // pixels per mm (zoom)
  pixelsPerMm: number;
  symbolLookup: (id: string) => SymbolDef | undefined;
}

const tolMm = (opts: HitOptions): number => opts.tolerance / opts.pixelsPerMm;

export const hitTestEntity = (e: Entity, p: Vec2, opts: HitOptions): boolean => {
  const tol = tolMm(opts);
  switch (e.kind) {
    case 'line':
      return distToSegment(p, e.a, e.b) <= tol;
    case 'polyline':
    case 'wire':
    case 'bus':
      for (let i = 0; i < e.points.length - 1; i++) {
        if (distToSegment(p, e.points[i], e.points[i + 1]) <= tol) return true;
      }
      if ((e as any).closed && e.points.length > 2) {
        return distToSegment(p, e.points[e.points.length - 1], e.points[0]) <= tol;
      }
      return false;
    case 'containment': {
      // Hit anywhere within the containment band's half-width, not just the centerline.
      const half = Math.max(2, (e.width ?? 50) / 2);
      const bandTol = tol + half;
      for (let i = 0; i < e.points.length - 1; i++) {
        if (distToSegment(p, e.points[i], e.points[i + 1]) <= bandTol) return true;
      }
      return false;
    }
    case 'wall': {
      // Walls have thickness — accept hits within thickness/2 + tol of any segment.
      const bandTol = tol + Math.max(2, (e.thickness ?? 100) / 2);
      for (let i = 0; i < e.points.length - 1; i++) {
        if (distToSegment(p, e.points[i], e.points[i + 1]) <= bandTol) return true;
      }
      return false;
    }
    case 'room': {
      // Rooms hit-test like a filled rectangle so users can grab them anywhere.
      return pointInRect(p, e.a, e.b);
    }
    case 'rectangle': {
      // hit on the rectangle outline
      const a = e.a;
      const b = e.b;
      const c1 = { x: a.x, y: a.y };
      const c2 = { x: b.x, y: a.y };
      const c3 = { x: b.x, y: b.y };
      const c4 = { x: a.x, y: b.y };
      return (
        distToSegment(p, c1, c2) <= tol ||
        distToSegment(p, c2, c3) <= tol ||
        distToSegment(p, c3, c4) <= tol ||
        distToSegment(p, c4, c1) <= tol ||
        ((e as any).fill && pointInRect(p, a, b))
      );
    }
    case 'circle': {
      const d = dist(p, e.center);
      if ((e as any).fill) return d <= e.radius + tol;
      return Math.abs(d - e.radius) <= tol;
    }
    case 'arc': {
      const d = dist(p, e.center);
      if (Math.abs(d - e.radius) > tol) return false;
      const a = Math.atan2(p.y - e.center.y, p.x - e.center.x);
      let s = e.startAngle;
      let en = e.endAngle;
      const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const aa = norm(a);
      const ss = norm(s);
      const ee = norm(en);
      if (ss < ee) return aa >= ss && aa <= ee;
      return aa >= ss || aa <= ee;
    }
    case 'ellipse': {
      const dx = (p.x - e.center.x) / e.rx;
      const dy = (p.y - e.center.y) / e.ry;
      const v = dx * dx + dy * dy;
      return Math.abs(v - 1) < (tol / Math.max(e.rx, e.ry)) * 2;
    }
    case 'text': {
      const b = entityBounds(e);
      return pointInRect(p, { x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    }
    case 'symbol': {
      const def = opts.symbolLookup(e.symbolId);
      if (!def) {
        return dist(p, e.position) <= 10 * e.scale;
      }
      // transform the bounds and check
      const bb = symbolWorldBounds(e, def);
      return pointInRect(p, { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.maxY });
    }
    case 'dimension':
      return distToSegment(p, e.a, e.b) <= tol;
    case 'wire-label': {
      const b = entityBounds(e);
      return pointInRect(p, { x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    }
    case 'group':
      return false;
    // New entity kinds — bounds-based hit test as a sane default.
    case 'fitting':
    case 'support':
    case 'penetration':
    case 'level-marker':
    case 'north-arrow':
    case 'scale-bar':
    case 'section-marker':
    case 'equipment':
    case 'riser':
    case 'grid-line':
    case 'underlay': {
      const b = entityBounds(e);
      return pointInRect(p, { x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    }
    case 'fire-barrier':
    case 'leader':
    case 'revision-cloud':
    case 'cloud': {
      const pts = (e as any).points as Vec2[];
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
      }
      return false;
    }
  }
};

// Find the topmost entity under the cursor on the active sheet
export const findEntityAt = (
  sheet: Sheet,
  p: Vec2,
  opts: HitOptions,
  layerVisible: (layerId: string) => boolean
): EntityId | null => {
  // The spatial index narrows the scan to entities near the cursor. Index
  // bounds already include each kind's hit band (containment width, wall
  // thickness), so inflating by the pixel tolerance makes the query a
  // superset of every possible hit.
  const tol = tolMm(opts);
  const candidates = getSpatialIndex(sheet, opts.symbolLookup).query({
    minX: p.x - tol,
    minY: p.y - tol,
    maxX: p.x + tol,
    maxY: p.y + tol,
  });
  // Iterate in reverse for top-most-first
  for (let i = candidates.length - 1; i >= 0; i--) {
    const id = candidates[i];
    const e = sheet.entities[id];
    if (!e || !e.visible || !layerVisible(e.layerId)) continue;
    if (hitTestEntity(e, p, opts)) return id;
  }
  return null;
};

// Find all entities whose bounds overlap with a rectangular region
export const findEntitiesInRect = (
  sheet: Sheet,
  a: Vec2,
  b: Vec2,
  opts: HitOptions,
  layerVisible: (layerId: string) => boolean,
  // window selection (must be fully enclosed) vs crossing (any overlap)
  fullyEnclosed: boolean
): EntityId[] => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const region: Bounds = { minX, minY, maxX, maxY };
  const out: EntityId[] = [];
  // Spatial query instead of a full sheet scan — results come back in
  // draw order, so `out` keeps the same ordering the linear scan had.
  for (const id of getSpatialIndex(sheet, opts.symbolLookup).query(region)) {
    const e = sheet.entities[id];
    if (!e || !e.visible || !layerVisible(e.layerId)) continue;
    const eb = entityBounds(e);
    if (e.kind === 'symbol') {
      const def = opts.symbolLookup(e.symbolId);
      if (def) {
        const bb = symbolWorldBounds(e, def);
        if (fullyEnclosed) {
          if (
            bb.minX >= region.minX &&
            bb.maxX <= region.maxX &&
            bb.minY >= region.minY &&
            bb.maxY <= region.maxY
          )
            out.push(id);
        } else if (rectsOverlap(bb, region)) {
          out.push(id);
        }
        continue;
      }
    }
    if (fullyEnclosed) {
      if (
        eb.minX >= region.minX &&
        eb.maxX <= region.maxX &&
        eb.minY >= region.minY &&
        eb.maxY <= region.maxY
      )
        out.push(id);
    } else if (rectsOverlap(eb, region)) {
      out.push(id);
    }
  }
  return out;
};

// Compute pin world positions for a placed symbol
export const symbolPinWorldPositions = (
  sym: SymbolEntity,
  def: SymbolDef
): { id: string; name: string; pos: Vec2 }[] => {
  return def.pins.map((p) => ({
    id: p.id,
    name: p.name,
    pos: transformSymbolPoint(sym, p.position),
  }));
};

export { transformSymbolPoint };
