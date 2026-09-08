// Generate cross-section view entities by cutting through a plan with a
// straight section line and projecting each crossed entity into a 2D
// side view: x = distance along the cut, y = elevation above datum.
//
// The view is rendered in mm world coordinates so it can be inserted
// directly onto a section sheet alongside title-block furniture.
//
// Tradeoff: only entities whose 2D footprint intersects the cut line
// are included. Containment crosses the cut as a rectangle the size of
// its cross-section at the interpolated crossing height. Vertical legs
// within the cut are shown over their full height.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  DimensionEntity,
  Entity,
  EquipmentEntity,
  LeaderEntity,
  Project,
  RectangleEntity,
  TextEntity,
  Vec2,
  WallEntity,
} from '../types';
import { distToSegment, segIntersect } from '../lib/math';
import { routePath } from '../lib/route-path';

const LAYER_ANN = 'Annotation';
const LAYER_DIM = 'Dimensions';
const LAYER_WALL = 'Walls';
const LAYER_CONT = 'Containment';

const newId = () => nanoid(10);

export interface CrossSectionOpts {
  project: Project;
  sheetId: string;
  cutA: Vec2;
  cutB: Vec2;
  viewName: string;
  // Optional draw origin on the section sheet (defaults to (0,0)).
  originX?: number;
  originY?: number;
}

// Defaults used when an entity doesn't specify its elevation.
const DEFAULT_FFL = 0;
const DEFAULT_CEILING = 2700; // typical 2.7m ceiling
// How close (mm) a polyline segment must come to the cut line to count
// as crossed. Keeps tolerance forgiving for hand-drawn routes.
const CUT_TOLERANCE = 50;

// Project a world point onto the cut line, returning its distance along
// the cut (0 at cutA, |cutA-cutB| at cutB). Negative values lie behind
// cutA — those are filtered out.
const distanceAlong = (p: Vec2, a: Vec2, b: Vec2): number | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
  if (t < -0.01 || t > 1.01) return null;
  return t * len;
};

// Find the s-value (mm along cut) where the cut crosses a polyline
// containment / wall. Returns null if no crossing.
const polylineCrossingS = (
  points: Vec2[],
  a: Vec2,
  b: Vec2,
): number | null => {
  if (points.length < 2) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const hit = segIntersect(a, b, p1, p2);
    if (hit) {
      const s = distanceAlong(hit, a, b);
      if (s !== null) return s;
    }
    // Allow near-misses for tolerance.
    const d1 = distToSegment(p1, a, b);
    if (d1 < CUT_TOLERANCE) {
      const s = distanceAlong(p1, a, b);
      if (s !== null) return s;
    }
  }
  return null;
};

// Iterate every sheet's entities. Section views typically pull from the
// floor plan that the cut originates on, but for whole-site projects we
// scan all entities so risers and equipment from other floors show up
// at their correct elevation. Sheets with no useful entities are
// silently skipped.
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

export const generateCrossSection = (opts: CrossSectionOpts): Entity[] => {
  const { project, cutA, cutB, viewName } = opts;
  const ox = opts.originX ?? 0;
  const oy = opts.originY ?? 0;

  const cutLength = Math.hypot(cutB.x - cutA.x, cutB.y - cutA.y);
  if (cutLength < 1) return [];

  const entities = allEntities(project);
  const out: Entity[] = [];

  // ---------- Frame ---------------------------------------------------
  // Ground line + ceiling line — gives the reader vertical context.
  out.push(line(ox, oy + DEFAULT_FFL, ox + cutLength, oy + DEFAULT_FFL));
  out.push(
    text(
      `±0 FFL`,
      ox - 8,
      oy + DEFAULT_FFL,
      'right',
      2.4,
    ),
  );

  // ---------- Walls ---------------------------------------------------
  // Walls crossed by the cut line are drawn as vertical bands at full
  // floor-to-ceiling height (or wall.height if specified).
  for (const e of entities) {
    if (e.kind !== 'wall') continue;
    const w = e as WallEntity;
    const s = polylineCrossingS(w.points, cutA, cutB);
    if (s === null) continue;
    const wallHeight = w.height ?? DEFAULT_CEILING;
    const x = ox + s - w.thickness / 2;
    out.push(
      rect(
        x,
        oy + (w.elevation ?? DEFAULT_FFL),
        x + w.thickness,
        oy + (w.elevation ?? DEFAULT_FFL) + wallHeight,
        LAYER_WALL,
      ),
    );
  }

  // ---------- Containment --------------------------------------------
  // Each crossed run becomes a small rectangle at its elevation. The
  // vertical face of the rectangle is the run's height (defaults to a
  // tray-ish 50mm); the horizontal face is the run's width.
  for (const e of entities) {
    if (e.kind !== 'containment') continue;
    const c = e as ContainmentEntity;
    const sourceSheet = Object.values(project.sheets).find(sheet => sheet.entities[c.id] === c);
    const path = routePath(c, project.floors?.[sourceSheet?.floorId ?? '']);
    const cw = c.width ?? 100, ch = c.containmentType === 'conduit' ? cw : c.height ?? 50;
    const seen = new Set<string>();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const hit = segIntersect(cutA, cutB, a, b) ?? (distToSegment(a, cutA, cutB) < CUT_TOLERANCE ? a : null);
      if (!hit) continue;
      const s = distanceAlong(hit, cutA, cutB);
      if (s === null) continue;
      const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = length2 > 1e-9 ? Math.max(0, Math.min(1, ((hit.x - a.x) * (b.x - a.x) + (hit.y - a.y) * (b.y - a.y)) / length2)) : 0;
      const elevation = length2 < 1e-9 ? Math.min(a.z, b.z) : a.z + (b.z - a.z) * t;
      const height = length2 < 1e-9 ? Math.abs(b.z - a.z) + ch : ch;
      const key = `${Math.round(s)}:${Math.round(elevation)}:${Math.round(height)}`;
      if (seen.has(key)) continue; seen.add(key);
      const x = ox + s - cw / 2, y = oy + elevation;
      out.push(rect(x, y, x + cw, y + height, LAYER_CONT));
      out.push(leader({ x: x + cw / 2, y: y + height }, { x: x + cw / 2 + 30, y: y + height + 80 },
        { x: x + cw / 2 + 90, y: y + height + 80 }, `${c.label ?? c.containmentType.toUpperCase()} ${cw}×${ch}`));
      out.push(text(`${elevation >= 0 ? '+' : ''}${Math.round(elevation)}`, ox - 8, y + height / 2, 'right', 2));
    }
  }

  // ---------- Equipment ----------------------------------------------
  // Equipment is shown when its footprint overlaps the cut line within
  // tolerance. Drawn at base elevation extending up to its height.
  for (const e of entities) {
    if (e.kind !== 'equipment') continue;
    const eq = e as EquipmentEntity;
    // Equipment footprint as four corners.
    const ax = Math.min(eq.a.x, eq.b.x);
    const bx = Math.max(eq.a.x, eq.b.x);
    const ay = Math.min(eq.a.y, eq.b.y);
    const by = Math.max(eq.a.y, eq.b.y);
    const corners: Vec2[] = [
      { x: ax, y: ay },
      { x: bx, y: ay },
      { x: bx, y: by },
      { x: ax, y: by },
    ];
    const s = polylineCrossingS([...corners, corners[0]], cutA, cutB);
    if (s === null) continue;
    const baseEl = eq.elevation ?? DEFAULT_FFL;
    const eqHeight = eq.height ?? 1800;
    const eqWidth = Math.min(bx - ax, by - ay);
    const x = ox + s - eqWidth / 2;
    out.push(
      rect(
        x,
        oy + baseEl,
        x + eqWidth,
        oy + baseEl + eqHeight,
        LAYER_ANN,
      ),
    );
    out.push(
      text(eq.tag, x + eqWidth / 2, oy + baseEl + eqHeight + 5, 'center', 3),
    );
  }

  // ---------- Frame closure: dimension across the cut --------------
  out.push(
    dim(
      { x: ox, y: oy + DEFAULT_FFL - 30 },
      { x: ox + cutLength, y: oy + DEFAULT_FFL - 30 },
      -10,
      `${Math.round(cutLength)}`,
    ),
  );

  // View title above the section.
  out.push(
    text(
      `SECTION ${viewName}`,
      ox + cutLength / 2,
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

const leader = (
  tip: Vec2,
  elbow: Vec2,
  end: Vec2,
  s: string,
): LeaderEntity => ({
  id: newId(),
  kind: 'leader',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  points: [tip, elbow, end],
  text: s,
  fontSize: 2.4,
  arrowStyle: 'arrow',
});

const dim = (
  a: Vec2,
  b: Vec2,
  offset: number,
  t?: string,
): DimensionEntity => ({
  id: newId(),
  kind: 'dimension',
  layerId: LAYER_DIM,
  visible: true,
  locked: false,
  a,
  b,
  offset,
  text: t,
});
