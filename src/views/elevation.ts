// Elevation view: project containment entities that lie within a depth
// volume in front of a view-line onto a 2D side view.
//
// Cross-section answers "what does the cut look like at this slice".
// Elevation answers "what does the wall look like from across the room"
// — every containment passing through the depth-prism is shown as a
// band following its individual leg elevations and projected direction.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  Entity,
  Project,
  RectangleEntity,
  TextEntity,
  Vec2,
} from '../types';
import { interpolate3, routePath, type Point3 } from '../lib/route-path';

const LAYER_ANN = 'Annotation';
const LAYER_CONT = 'Containment';

const newId = () => nanoid(10);

export interface ElevationOpts {
  project: Project;
  sheetId: string;
  viewLine: { from: Vec2; to: Vec2; depth: number };
  viewName: string;
  originX?: number;
  originY?: number;
}

const DEFAULT_FFL = 0;
const DEFAULT_CEILING = 2700;

// Project a world point onto the view line. Returns the s-value (mm
// along the line, 0 at "from") plus the perpendicular offset (mm in
// front of the line; positive = in front).
const projectOnto = (
  p: Vec2,
  from: Vec2,
  to: Vec2,
): { s: number; perp: number; len: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { s: 0, perp: 0, len: 0 };
  const ux = dx / len;
  const uy = dy / len;
  // Perp vector points to the right of the view line.
  const px = -uy;
  const py = ux;
  const s = (p.x - from.x) * ux + (p.y - from.y) * uy;
  const perp = (p.x - from.x) * px + (p.y - from.y) * py;
  return { s, perp, len };
};

// Clip each leg against the view prism, preserving its interpolated height.
const clipLeg = (a: Point3, b: Point3, from: Vec2, to: Vec2, depth: number): [Point3, Point3] | null => {
  const pa = projectOnto(a, from, to), pb = projectOnto(b, from, to);
  let enter = 0, leave = 1;
  for (const [start, end, min, max] of [[pa.s, pb.s, 0, pa.len], [pa.perp, pb.perp, -25, depth]]) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return null; continue; }
    const t0 = (min - start) / delta, t1 = (max - start) / delta;
    enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1));
    if (enter > leave) return null;
  }
  return [interpolate3(a, b, enter), interpolate3(a, b, leave)];
};

const allEntities = (project: Project): Entity[] => {
  const out: Entity[] = [];
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e && e.visible !== false) out.push(e);
    }
  }
  return out;
};

export const generateElevationView = (opts: ElevationOpts): Entity[] => {
  const { project, viewLine, viewName } = opts;
  const ox = opts.originX ?? 0;
  const oy = opts.originY ?? 0;
  const { from, to, depth } = viewLine;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1) return [];

  const entities = allEntities(project);
  const out: Entity[] = [];

  // Floor & ceiling reference lines.
  out.push(line(ox, oy + DEFAULT_FFL, ox + len, oy + DEFAULT_FFL));
  out.push(line(ox, oy + DEFAULT_CEILING, ox + len, oy + DEFAULT_CEILING));
  out.push(text('FFL', ox - 8, oy + DEFAULT_FFL, 'right', 2.4));
  out.push(text('CEILING', ox - 8, oy + DEFAULT_CEILING, 'right', 2.4));

  // Track tier elevations to label them at the end.
  const tiers = new Set<number>();

  // Containment runs.
  for (const e of entities) {
    if (e.kind !== 'containment') continue;
    const c = e as ContainmentEntity;
    const sourceSheet = Object.values(project.sheets).find(sheet => sheet.entities[c.id] === c);
    const path = routePath(c, project.floors?.[sourceSheet?.floorId ?? '']);
    const ch = c.containmentType === 'conduit' ? c.width ?? 25 : c.height ?? 50;
    let labelled = false;
    for (let i = 1; i < path.length; i++) {
      const clipped = clipLeg(path[i - 1], path[i], from, to, depth);
      if (!clipped) continue;
      const [a, b] = clipped;
      const x0 = ox + projectOnto(a, from, to).s, x1 = ox + projectOnto(b, from, to).s;
      const y0 = oy + a.z, y1 = oy + b.z;
      if (Math.abs(x1 - x0) < 1) {
        if (Math.abs(y1 - y0) < 1) continue;
        const halfWidth = (c.width ?? 100) / 2;
        out.push(rect(x0 - halfWidth, Math.min(y0, y1), x0 + halfWidth, Math.max(y0, y1) + ch, LAYER_CONT));
      } else if (Math.abs(y1 - y0) < 0.01) out.push(rect(Math.min(x0, x1), y0, Math.max(x0, x1), y0 + ch, LAYER_CONT));
      else out.push({ id: newId(), kind: 'polyline', layerId: LAYER_CONT, visible: true, locked: false, closed: true,
        points: [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x1, y: y1 + ch }, { x: x0, y: y0 + ch }] });
      if (!labelled && Math.abs(x1 - x0) > 100) {
        out.push(text(c.label ?? c.containmentType.toUpperCase(), (x0 + x1) / 2, (y0 + y1 + ch) / 2, 'center', Math.min(2.4, ch * 0.6)));
        labelled = true;
      }
      tiers.add(a.z); tiers.add(b.z);
    }
  }

  // Tier labels along the right edge.
  const sortedTiers = [...tiers].sort((a, b) => b - a);
  for (const t of sortedTiers) {
    out.push(
      text(
        `${t >= 0 ? '+' : ''}${Math.round(t)} TIER`,
        ox + len + 10,
        oy + t,
        'left',
        2.4,
      ),
    );
    // Dotted tier line spanning the view for clarity.
    out.push(line(ox, oy + t, ox + len, oy + t));
  }

  // View title.
  out.push(
    text(
      `ELEVATION ${viewName}`,
      ox + len / 2,
      oy + DEFAULT_CEILING + 80,
      'center',
      6,
    ),
  );

  return out;
};

// --- helpers --------------------------------------------------------------

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layerId: string = LAYER_ANN,
): RectangleEntity => ({
  id: newId(),
  kind: 'rectangle',
  layerId,
  visible: true,
  locked: false,
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});

const line = (x0: number, y0: number, x1: number, y1: number): Entity => ({
  id: newId(),
  kind: 'line',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});

const text = (
  s: string,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right' = 'left',
  size = 3,
): TextEntity => ({
  id: newId(),
  kind: 'text',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  position: { x, y },
  text: s,
  fontSize: size,
  rotation: 0,
  align,
});
