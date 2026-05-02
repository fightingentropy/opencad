import type { Vec2, Bounds, Entity } from '../types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b));
export const distSq = (a: Vec2, b: Vec2): number => lenSq(sub(a, b));
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const angle = (a: Vec2, b: Vec2): number => Math.atan2(b.y - a.y, b.x - a.x);
export const rotate = (p: Vec2, c: Vec2, theta: number): Vec2 => {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * ct - dy * st, y: c.y + dx * st + dy * ct };
};

export const snapToGrid = (p: Vec2, grid: number): Vec2 => ({
  x: Math.round(p.x / grid) * grid,
  y: Math.round(p.y / grid) * grid,
});

export const snapAngle = (from: Vec2, to: Vec2, step = Math.PI / 4): Vec2 => {
  const a = angle(from, to);
  const snapped = Math.round(a / step) * step;
  const d = dist(from, to);
  return { x: from.x + Math.cos(snapped) * d, y: from.y + Math.sin(snapped) * d };
};

export const orthoConstrain = (from: Vec2, to: Vec2): Vec2 => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx > dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
};

// Distance from point to line segment
export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const l2 = lenSq(ab);
  if (l2 < 1e-9) return len(ap);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / l2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
};

// Closest point on segment
export const closestOnSegment = (p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } => {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const l2 = lenSq(ab);
  if (l2 < 1e-9) return { point: a, t: 0 };
  const t = Math.max(0, Math.min(1, dot(ap, ab) / l2));
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
};

// Line-line intersection (returns null if parallel or out-of-range)
export const segIntersect = (
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2
): Vec2 | null => {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
};

export const pointInRect = (p: Vec2, a: Vec2, b: Vec2): boolean => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
};

export const rectsOverlap = (a: Bounds, b: Bounds): boolean =>
  a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;

export const expandBounds = (b: Bounds, p: Vec2): Bounds => ({
  minX: Math.min(b.minX, p.x),
  minY: Math.min(b.minY, p.y),
  maxX: Math.max(b.maxX, p.x),
  maxY: Math.max(b.maxY, p.y),
});

export const emptyBounds = (): Bounds => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export const boundsOf = (points: Vec2[]): Bounds => {
  let b = emptyBounds();
  for (const p of points) b = expandBounds(b, p);
  return b;
};

export const boundsCenter = (b: Bounds): Vec2 => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

export const boundsSize = (b: Bounds): Vec2 => ({
  x: b.maxX - b.minX,
  y: b.maxY - b.minY,
});

// Compute axis-aligned bounding box for any entity
export const entityBounds = (e: Entity): Bounds => {
  switch (e.kind) {
    case 'line':
      return boundsOf([e.a, e.b]);
    case 'polyline':
    case 'wire':
    case 'bus':
      return boundsOf(e.points);
    case 'rectangle':
      return boundsOf([e.a, e.b]);
    case 'circle':
      return {
        minX: e.center.x - e.radius,
        minY: e.center.y - e.radius,
        maxX: e.center.x + e.radius,
        maxY: e.center.y + e.radius,
      };
    case 'arc':
      return {
        minX: e.center.x - e.radius,
        minY: e.center.y - e.radius,
        maxX: e.center.x + e.radius,
        maxY: e.center.y + e.radius,
      };
    case 'ellipse':
      return {
        minX: e.center.x - e.rx,
        minY: e.center.y - e.ry,
        maxX: e.center.x + e.rx,
        maxY: e.center.y + e.ry,
      };
    case 'text':
      return {
        minX: e.position.x,
        minY: e.position.y - e.fontSize,
        maxX: e.position.x + e.text.length * e.fontSize * 0.6,
        maxY: e.position.y,
      };
    case 'symbol': {
      // approximate; the engine refines this against the symbol def
      const r = 30 * e.scale;
      return {
        minX: e.position.x - r,
        minY: e.position.y - r,
        maxX: e.position.x + r,
        maxY: e.position.y + r,
      };
    }
    case 'dimension':
      return boundsOf([e.a, e.b]);
    case 'wire-label':
      return {
        minX: e.position.x - 10,
        minY: e.position.y - 5,
        maxX: e.position.x + 10,
        maxY: e.position.y + 5,
      };
    case 'group':
      return emptyBounds();
  }
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
