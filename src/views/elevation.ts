// Elevation view: project containment entities that lie within a depth
// volume in front of a view-line onto a 2D side view.
//
// Cross-section answers "what does the cut look like at this slice".
// Elevation answers "what does the wall look like from across the room"
// — every containment passing through the depth-prism is shown as a
// horizontal band at its elevation, length = its projected length onto
// the view direction.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  Entity,
  Project,
  RectangleEntity,
  TextEntity,
  Vec2,
} from '../types';
import { distToSegment } from '../lib/math';

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

// For an N-point polyline, return the [minS, maxS] range covered when
// projected onto the view line, or null if the polyline doesn't lie
// within the depth prism.
const polylineSRange = (
  points: Vec2[],
  from: Vec2,
  to: Vec2,
  depth: number,
): { sMin: number; sMax: number; len: number } | null => {
  if (points.length < 2) return null;
  let sMin = Infinity;
  let sMax = -Infinity;
  let any = false;
  let len = 0;
  for (const p of points) {
    const proj = projectOnto(p, from, to);
    len = proj.len;
    // Inside depth prism: 0..depth in front, and within 0..len along.
    if (proj.perp < -25 || proj.perp > depth) continue;
    if (proj.s < -25 || proj.s > len + 25) continue;
    sMin = Math.min(sMin, proj.s);
    sMax = Math.max(sMax, proj.s);
    any = true;
  }
  // Also consider segments that pass through the prism but no vertex
  // is inside — sample midpoint for robustness on long runs.
  if (!any) {
    for (let i = 0; i < points.length - 1; i++) {
      const mid = {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      };
      const proj = projectOnto(mid, from, to);
      if (
        proj.perp >= -25 &&
        proj.perp <= depth &&
        proj.s >= -25 &&
        proj.s <= proj.len + 25
      ) {
        sMin = Math.min(sMin, proj.s);
        sMax = Math.max(sMax, proj.s);
        any = true;
        // Approximate range by ±half-segment length.
        const segLen =
          distToSegment(points[i], points[i], points[i + 1]) +
          distToSegment(points[i + 1], points[i], points[i + 1]);
        sMin = Math.min(sMin, proj.s - segLen / 2);
        sMax = Math.max(sMax, proj.s + segLen / 2);
      }
    }
  }
  if (!any) return null;
  return { sMin, sMax, len };
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

const defaultContainmentElevation = (c: ContainmentEntity): number => {
  switch (c.containmentType) {
    case 'busbar':
    case 'tray':
    case 'ladder':
    case 'basket':
      return 2400;
    case 'trunking':
      return 2200;
    case 'conduit':
      return 2300;
    case 'duct':
      return -300;
    default:
      return 2200;
  }
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
    const range = polylineSRange(c.points, from, to, depth);
    if (!range) continue;
    const elevation = c.elevation ?? defaultContainmentElevation(c);
    const ch = c.height ?? 50;
    const sMin = Math.max(0, Math.min(range.sMin, range.sMax));
    const sMax = Math.max(range.sMin, range.sMax);
    const x0 = ox + sMin;
    const x1 = ox + Math.min(len, sMax);
    if (x1 - x0 < 1) continue;
    const y0 = oy + elevation;
    const y1 = y0 + ch;
    out.push(rect(x0, y0, x1, y1, LAYER_CONT));

    // Container ref label inside the band when it fits.
    const refLabel = c.label ?? c.containmentType.toUpperCase();
    out.push(
      text(
        refLabel,
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        'center',
        Math.min(2.4, (y1 - y0) * 0.6),
      ),
    );
    tiers.add(elevation);
  }

  // Tier labels along the right edge.
  const sortedTiers = [...tiers].sort((a, b) => b - a);
  for (const t of sortedTiers) {
    out.push(
      text(
        `+${t} TIER`,
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
