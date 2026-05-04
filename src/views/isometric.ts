// 30° isometric projection of containment runs.
//
// Standard isometric matrix (right-handed, +X to lower-right, +Y to
// lower-left, +Z up):
//   x' = (x - y) * cos(30°)
//   y' = (x + y) * sin(30°) + z
//
// Containment polylines are 2D in the floor plan; we use entity.elevation
// as the Z input. Output entities are flat polylines / labels in the
// projected coordinate space, ready to drop onto a 3D-style isometric
// sheet. Only containment, equipment, and risers are projected — anything
// architectural is left out so the iso reads as a services-only view.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  Entity,
  EquipmentEntity,
  PolylineEntity,
  Project,
  RectangleEntity,
  RiserEntity,
  TextEntity,
  Vec2,
  Vec3,
} from '../types';

const LAYER_ANN = 'Annotation';
const LAYER_CONT = 'Containment';
const LAYER_PANEL = 'Panel Layout';

const newId = () => nanoid(10);

const COS30 = Math.cos(Math.PI / 6); // ≈ 0.8660
const SIN30 = Math.sin(Math.PI / 6); // 0.5

// Project a 3D world point to 2D iso. Z reads upward.
const isoProject = (
  p: Vec3,
  scale: number,
  ox: number,
  oy: number,
): Vec2 => ({
  x: ox + (p.x - p.y) * COS30 * scale,
  y: oy + (p.x + p.y) * SIN30 * scale + p.z * scale,
});

export interface IsometricOpts {
  project: Project;
  sheetId: string;
  originX: number;
  originY: number;
  // Drawing scale. 1 = 1mm world → 1mm projected. Typical iso views use
  // 0.5 or smaller to fit a building on a single sheet.
  scale: number;
  // Optional: only project entities from these source sheet IDs. When
  // omitted, every sheet's containment is included.
  sourceSheetIds?: string[];
}

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

export const generateIsometric = (opts: IsometricOpts): Entity[] => {
  const { project, originX, originY, scale } = opts;
  const out: Entity[] = [];

  const sheetIds = opts.sourceSheetIds ?? project.sheetOrder;

  // Containment: project every polyline point to iso and emit a single
  // polyline entity per containment run.
  for (const sid of sheetIds) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (!e || e.visible === false) continue;

      if (e.kind === 'containment') {
        const c = e as ContainmentEntity;
        const z = c.elevation ?? defaultContainmentElevation(c);
        const projected = c.points.map((p) =>
          isoProject({ x: p.x, y: p.y, z }, scale, originX, originY),
        );
        if (projected.length < 2) continue;
        const poly: PolylineEntity = {
          id: newId(),
          kind: 'polyline',
          layerId: LAYER_CONT,
          visible: true,
          locked: false,
          points: projected,
          closed: false,
        };
        out.push(poly);

        // Label at the run midpoint.
        if (c.label || c.containmentType) {
          const mid = projected[Math.floor(projected.length / 2)];
          out.push(
            text(
              c.label ?? c.containmentType.toUpperCase(),
              mid.x,
              mid.y + 3,
              'center',
              2.4,
            ),
          );
        }
      }

      if (e.kind === 'equipment') {
        const eq = e as EquipmentEntity;
        const z = eq.elevation ?? 0;
        const ax = Math.min(eq.a.x, eq.b.x);
        const bx = Math.max(eq.a.x, eq.b.x);
        const ay = Math.min(eq.a.y, eq.b.y);
        const by = Math.max(eq.a.y, eq.b.y);
        const h = eq.height ?? 1800;

        // Eight corners of the equipment box in 3D, projected.
        const corners3 = [
          { x: ax, y: ay, z },
          { x: bx, y: ay, z },
          { x: bx, y: by, z },
          { x: ax, y: by, z },
          { x: ax, y: ay, z: z + h },
          { x: bx, y: ay, z: z + h },
          { x: bx, y: by, z: z + h },
          { x: ax, y: by, z: z + h },
        ].map((p) => isoProject(p, scale, originX, originY));

        // Visible iso edges — the front three faces. Drawn as a closed
        // polyline that traces around the silhouette.
        const silhouette: PolylineEntity = {
          id: newId(),
          kind: 'polyline',
          layerId: LAYER_PANEL,
          visible: true,
          locked: false,
          points: [
            corners3[0],
            corners3[1],
            corners3[5],
            corners3[6],
            corners3[7],
            corners3[3],
          ],
          closed: true,
        };
        out.push(silhouette);

        // Top face outline — a closed quad.
        const topFace: PolylineEntity = {
          id: newId(),
          kind: 'polyline',
          layerId: LAYER_PANEL,
          visible: true,
          locked: false,
          points: [corners3[4], corners3[5], corners3[6], corners3[7]],
          closed: true,
        };
        out.push(topFace);

        // Tag label on top-right corner.
        out.push(
          text(eq.tag, corners3[5].x + 3, corners3[5].y, 'left', 2.6),
        );
      }

      if (e.kind === 'riser') {
        const r = e as RiserEntity;
        // Resolve riser endpoints in 3D.
        const z0 =
          r.fromElevation ??
          (r.fromFloorId
            ? project.floors?.[r.fromFloorId]?.ffl ?? 0
            : 0);
        const z1 =
          r.toElevation ??
          (r.toFloorId
            ? project.floors?.[r.toFloorId]?.ffl ?? z0 + 3000
            : z0 + 3000);
        const half = Math.max(r.width, r.height) / 2;
        const p0 = isoProject(
          { x: r.position.x, y: r.position.y, z: z0 },
          scale,
          originX,
          originY,
        );
        const p1 = isoProject(
          { x: r.position.x, y: r.position.y, z: z1 },
          scale,
          originX,
          originY,
        );
        const w = half * scale;
        const riserBox: RectangleEntity = {
          id: newId(),
          kind: 'rectangle',
          layerId: LAYER_CONT,
          visible: true,
          locked: false,
          a: { x: p0.x - w, y: p0.y },
          b: { x: p1.x + w, y: p1.y },
        };
        out.push(riserBox);
        if (r.label) {
          out.push(text(r.label, p1.x, p1.y + 4, 'left', 2.4));
        }
      }
    }
  }

  // Origin marker triad — small XYZ axes so the reader knows the
  // projection orientation.
  const ax = isoProject({ x: 0, y: 0, z: 0 }, scale, originX, originY);
  const xx = isoProject({ x: 1000, y: 0, z: 0 }, scale, originX, originY);
  const yy = isoProject({ x: 0, y: 1000, z: 0 }, scale, originX, originY);
  const zz = isoProject({ x: 0, y: 0, z: 1000 }, scale, originX, originY);
  out.push(line(ax, xx, '#ff5d5d'));
  out.push(text('X', xx.x + 2, xx.y, 'left', 2.4));
  out.push(line(ax, yy, '#9ad65a'));
  out.push(text('Y', yy.x - 4, yy.y, 'right', 2.4));
  out.push(line(ax, zz, '#5cdcff'));
  out.push(text('Z', zz.x, zz.y + 3, 'left', 2.4));

  return out;
};

// --- helpers --------------------------------------------------------------

const line = (a: Vec2, b: Vec2, color?: string): Entity => ({
  id: newId(),
  kind: 'line',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  a,
  b,
  ...(color ? { color } : {}),
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
