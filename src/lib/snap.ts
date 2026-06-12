import type { Bounds, Entity, Vec2, Sheet, SnapSettings, SnapKind, SymbolEntity, SymbolDef } from '../types';
import { dist, distToSegment, snapToGrid, closestOnSegment, segIntersect } from './math';
import { transformSymbolPoint } from './hittest';
import { getSpatialIndex } from './spatial-index';

export type { SnapKind };

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  // optional source entity id this snap came from
  entityId?: string;
}

export interface SnapOptions {
  pixelsPerMm: number;
  toleranceScreenPx: number;
  symbolLookup: (id: string) => SymbolDef | undefined;
}

const collectEndpoints = (e: Entity, lookup: SnapOptions['symbolLookup']): Vec2[] => {
  switch (e.kind) {
    case 'line':
      return [e.a, e.b];
    case 'polyline':
    case 'wire':
    case 'bus':
      return e.points.slice();
    case 'rectangle':
      return [
        e.a,
        { x: e.b.x, y: e.a.y },
        e.b,
        { x: e.a.x, y: e.b.y },
      ];
    case 'circle':
      return [
        { x: e.center.x + e.radius, y: e.center.y },
        { x: e.center.x - e.radius, y: e.center.y },
        { x: e.center.x, y: e.center.y + e.radius },
        { x: e.center.x, y: e.center.y - e.radius },
      ];
    case 'arc':
      return [
        { x: e.center.x + e.radius * Math.cos(e.startAngle), y: e.center.y + e.radius * Math.sin(e.startAngle) },
        { x: e.center.x + e.radius * Math.cos(e.endAngle), y: e.center.y + e.radius * Math.sin(e.endAngle) },
      ];
    case 'ellipse':
      return [
        { x: e.center.x + e.rx, y: e.center.y },
        { x: e.center.x - e.rx, y: e.center.y },
        { x: e.center.x, y: e.center.y + e.ry },
        { x: e.center.x, y: e.center.y - e.ry },
      ];
    case 'symbol': {
      const def = lookup(e.symbolId);
      if (!def) return [e.position];
      return def.pins.map((p) => transformSymbolPoint(e as SymbolEntity, p.position));
    }
    case 'dimension':
      return [e.a, e.b];
    case 'text':
      return [e.position];
    case 'wire-label':
      return [e.position];
    case 'containment':
    case 'wall':
      return e.points.slice();
    case 'room':
      return [
        e.a,
        { x: e.b.x, y: e.a.y },
        e.b,
        { x: e.a.x, y: e.b.y },
      ];
    default:
      return [];
  }
};

const collectMidpoints = (e: Entity): Vec2[] => {
  switch (e.kind) {
    case 'line':
      return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
    case 'polyline':
    case 'wire':
    case 'bus': {
      const out: Vec2[] = [];
      for (let i = 0; i < e.points.length - 1; i++) {
        out.push({
          x: (e.points[i].x + e.points[i + 1].x) / 2,
          y: (e.points[i].y + e.points[i + 1].y) / 2,
        });
      }
      return out;
    }
    case 'rectangle':
      return [
        { x: (e.a.x + e.b.x) / 2, y: e.a.y },
        { x: e.b.x, y: (e.a.y + e.b.y) / 2 },
        { x: (e.a.x + e.b.x) / 2, y: e.b.y },
        { x: e.a.x, y: (e.a.y + e.b.y) / 2 },
      ];
    case 'dimension':
      return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
    case 'containment':
    case 'wall': {
      const out: Vec2[] = [];
      for (let i = 0; i < e.points.length - 1; i++) {
        out.push({
          x: (e.points[i].x + e.points[i + 1].x) / 2,
          y: (e.points[i].y + e.points[i + 1].y) / 2,
        });
      }
      return out;
    }
    case 'room':
      return [
        { x: (e.a.x + e.b.x) / 2, y: e.a.y },
        { x: e.b.x, y: (e.a.y + e.b.y) / 2 },
        { x: (e.a.x + e.b.x) / 2, y: e.b.y },
        { x: e.a.x, y: (e.a.y + e.b.y) / 2 },
      ];
    default:
      return [];
  }
};

const collectCenters = (e: Entity): Vec2[] => {
  switch (e.kind) {
    case 'circle':
    case 'arc':
    case 'ellipse':
      return [e.center];
    case 'rectangle':
      return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
    case 'room':
      return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
    case 'symbol':
      return [e.position];
    default:
      return [];
  }
};

const collectSegments = (e: Entity): [Vec2, Vec2][] => {
  switch (e.kind) {
    case 'line':
      return [[e.a, e.b]];
    case 'polyline':
    case 'wire':
    case 'bus': {
      const out: [Vec2, Vec2][] = [];
      for (let i = 0; i < e.points.length - 1; i++) out.push([e.points[i], e.points[i + 1]]);
      return out;
    }
    case 'rectangle':
      return [
        [e.a, { x: e.b.x, y: e.a.y }],
        [{ x: e.b.x, y: e.a.y }, e.b],
        [e.b, { x: e.a.x, y: e.b.y }],
        [{ x: e.a.x, y: e.b.y }, e.a],
      ];
    case 'dimension':
      return [[e.a, e.b]];
    case 'containment':
    case 'wall': {
      const out: [Vec2, Vec2][] = [];
      for (let i = 0; i < e.points.length - 1; i++) out.push([e.points[i], e.points[i + 1]]);
      return out;
    }
    case 'room':
      return [
        [e.a, { x: e.b.x, y: e.a.y }],
        [{ x: e.b.x, y: e.a.y }, e.b],
        [e.b, { x: e.a.x, y: e.b.y }],
        [{ x: e.a.x, y: e.b.y }, e.a],
      ];
    default:
      return [];
  }
};

export const computeSnap = (
  cursor: Vec2,
  sheet: Sheet,
  settings: SnapSettings,
  opts: SnapOptions,
  layerVisible: (layerId: string) => boolean
): SnapResult => {
  if (!settings.enabled) {
    return { point: cursor, kind: 'none' };
  }
  const tol = opts.toleranceScreenPx / opts.pixelsPerMm;

  let best: SnapResult | null = null;
  const consider = (point: Vec2, kind: SnapKind, entityId?: string, weight = 1) => {
    const d = dist(cursor, point);
    if (d > tol) return;
    if (
      !best ||
      d * weight < dist(cursor, best.point) * (best.kind === 'grid' ? 0.5 : 1)
    ) {
      best = { point, kind, entityId };
    }
  };

  // Object snap types — all gated by the master osnap toggle (F3)
  if (settings.osnap) {
    // One spatial query bounds all the loops below: every snap point an
    // entity can produce (endpoint, midpoint, center, pin, on-segment)
    // lies within its indexed bounds, so entities farther than tol from
    // the cursor can never pass `consider` and are skipped wholesale.
    const region: Bounds = {
      minX: cursor.x - tol,
      minY: cursor.y - tol,
      maxX: cursor.x + tol,
      maxY: cursor.y + tol,
    };
    const nearby: { id: string; e: Entity }[] = [];
    for (const id of getSpatialIndex(sheet, opts.symbolLookup).query(region)) {
      const e = sheet.entities[id];
      if (!e || !e.visible || !layerVisible(e.layerId)) continue;
      nearby.push({ id, e });
    }

    // Pin snaps (highest priority)
    if (settings.pin) {
      for (const { id, e } of nearby) {
        if (e.kind !== 'symbol') continue;
        const def = opts.symbolLookup(e.symbolId);
        if (!def) continue;
        for (const pin of def.pins) {
          const wp = transformSymbolPoint(e as SymbolEntity, pin.position);
          consider(wp, 'pin', id, 0.4);
        }
      }
    }

    if (settings.endpoint) {
      for (const { id, e } of nearby) {
        for (const p of collectEndpoints(e, opts.symbolLookup)) {
          consider(p, 'endpoint', id, 0.5);
        }
      }
    }

    if (settings.midpoint) {
      for (const { id, e } of nearby) {
        for (const p of collectMidpoints(e)) consider(p, 'midpoint', id, 0.6);
        for (const p of collectCenters(e)) consider(p, 'center', id, 0.6);
      }
    }

    if (settings.intersection) {
      // Pairwise intersection over only the segments that pass within tol
      // of the cursor. A crossing is accepted by `consider` only when the
      // intersection point is within tol — and that point lies on both
      // segments, so segments farther than tol can never contribute.
      const candidates: [Vec2, Vec2][] = [];
      for (const { e } of nearby) {
        for (const seg of collectSegments(e)) {
          if (distToSegment(cursor, seg[0], seg[1]) <= tol) candidates.push(seg);
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const x = segIntersect(candidates[i][0], candidates[i][1], candidates[j][0], candidates[j][1]);
          if (x) consider(x, 'intersection', undefined, 0.55);
        }
      }
    }

    // Nearest-on-segment fallback
    for (const { id, e } of nearby) {
      for (const seg of collectSegments(e)) {
        const { point } = closestOnSegment(cursor, seg[0], seg[1]);
        if (dist(cursor, point) < tol) consider(point, 'perpendicular', id, 0.85);
      }
    }
  }

  if (best) return best;

  if (settings.grid && settings.gridSize > 0) {
    return { point: snapToGrid(cursor, settings.gridSize), kind: 'grid' };
  }

  return { point: cursor, kind: 'none' };
};
