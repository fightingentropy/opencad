// Multi-floor / multi-building 3D scene assembly.
//
// Walks the project's site / building / floor / zone hierarchy and emits
// one Group per floor, positioned at floor.ffl, populated by walls,
// rooms, containment, fittings, supports, equipment and risers. The
// returned SceneControls let the caller isolate a floor, filter by
// system, and tweak per-layer transparency.
//
// This module is independent of Panel3D — Panel3D continues to render
// the legacy panel/building scene; BuildingScene renders the new
// whole-site view. Both can co-exist.

import * as THREE from 'three';
import type {
  Project,
  Sheet,
  Entity,
  ContainmentEntity,
  FittingEntity,
  SupportEntity,
  EquipmentEntity,
  RiserEntity,
  WallEntity,
  RoomEntity,
} from '../types';
import type { Floor, Building, FloorId, SystemId } from '../models/site';
import {
  colourFor,
  renderContainment3D,
  type RenderOpts as ContainmentRenderOpts,
} from './ContainmentRender3D';
import { renderFitting3D } from './FittingRender3D';
import { renderSupport3D } from './SupportRender3D';
import { renderEquipment3D } from './EquipmentRender3D';
import { defaultElevation } from './elevations';
import { containmentTouchesPoint } from '../lib/fittings';

// ---------- Public API ------------------------------------------------------

export interface BuildSceneOptions {
  /** Material palette overrides (per-system colours, per-material look). */
  materials?: ContainmentRenderOpts['materials'];
  /** Skip rendering elements outside of these floors. */
  visibleFloors?: Set<FloorId>;
  /** Per-entity systemId resolver; lets the caller tag colours by system. */
  systemIdFor?: (e: Entity) => SystemId | undefined;
  /** Convert CAD-y to scene-y. Defaults to "no flip" — pass H if your
   *  entities use screen-down y like Panel3D. */
  flipY?: number;
  /** Render walls / rooms / equipment / containment etc. Default: all true. */
  layers?: Partial<Record<SceneLayer, boolean>>;
}

export type SceneLayer =
  | 'walls'
  | 'rooms'
  | 'containment'
  | 'fittings'
  | 'supports'
  | 'equipment'
  | 'risers'
  | 'floors'
  | 'labels';

export interface SceneControls {
  /** Show only one floor; pass null to show all. */
  isolateFloor(floorId: FloorId | null): void;
  /** Hide all containment runs not on the given system; null to show all. */
  filterSystem(systemId: SystemId | null): void;
  /** Set per-layer transparency 0..1. */
  setTransparency(layer: SceneLayer, opacity: number): void;
  /** Dispose all geometry / materials owned by the scene. */
  dispose(): void;
}

interface FloorGroupInfo {
  floor: Floor;
  group: THREE.Group;
  systemMap: Map<string, SystemId | undefined>; // entityId -> systemId
}

interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------- Helpers ---------------------------------------------------------

function tag(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => { child.userData.entityId = entityId; });
}

function gatherSheetEntities(project: Project, sheetIds: string[]): Entity[] {
  const out: Entity[] = [];
  for (const sid of sheetIds) {
    const sheet: Sheet | undefined = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e) out.push(e);
    }
  }
  return out;
}

function transformedY(y: number, flipY?: number): number {
  return flipY != null ? flipY - y : y;
}

function resolveSystemId(entity: Entity, options: BuildSceneOptions): SystemId | undefined {
  return options.systemIdFor?.(entity) ?? (entity as { systemId?: SystemId }).systemId;
}

function emptyBounds(): Bounds2D {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

function includePoint(bounds: Bounds2D, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function validBounds(bounds: Bounds2D): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY
  );
}

function floorShellBounds(
  rooms: RoomEntity[],
  walls: WallEntity[],
  flipY?: number,
): Bounds2D | null {
  const bounds = emptyBounds();
  for (const r of rooms) {
    includePoint(bounds, r.a.x, transformedY(r.a.y, flipY));
    includePoint(bounds, r.b.x, transformedY(r.b.y, flipY));
  }
  for (const w of walls) {
    for (const p of w.points) includePoint(bounds, p.x, transformedY(p.y, flipY));
  }
  return validBounds(bounds) ? bounds : null;
}

function floorContentBounds(
  containments: ContainmentEntity[],
  fittings: FittingEntity[],
  supports: SupportEntity[],
  equipment: EquipmentEntity[],
  flipY?: number,
): Bounds2D | null {
  const bounds = emptyBounds();
  for (const c of containments) {
    for (const p of c.points) includePoint(bounds, p.x, transformedY(p.y, flipY));
  }
  for (const f of fittings) {
    includePoint(bounds, f.position.x, transformedY(f.position.y, flipY));
  }
  for (const s of supports) {
    includePoint(bounds, s.position.x, transformedY(s.position.y, flipY));
  }
  for (const eq of equipment) {
    includePoint(bounds, eq.a.x, transformedY(eq.a.y, flipY));
    includePoint(bounds, eq.b.x, transformedY(eq.b.y, flipY));
  }
  return validBounds(bounds) ? bounds : null;
}

function expandBounds(bounds: Bounds2D, margin: number): Bounds2D {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

function boundsOverlap(a: Bounds2D, b: Bounds2D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointBounds(x: number, y: number): Bounds2D {
  return { minX: x, minY: y, maxX: x, maxY: y };
}

function containmentBounds(c: ContainmentEntity, flipY?: number): Bounds2D | null {
  const bounds = emptyBounds();
  for (const p of c.points) includePoint(bounds, p.x, transformedY(p.y, flipY));
  return validBounds(bounds) ? bounds : null;
}

function fittingBounds(f: FittingEntity, flipY?: number): Bounds2D {
  return pointBounds(f.position.x, transformedY(f.position.y, flipY));
}

function supportBounds(s: SupportEntity, flipY?: number): Bounds2D {
  return pointBounds(s.position.x, transformedY(s.position.y, flipY));
}

function equipmentBounds(eq: EquipmentEntity, flipY?: number): Bounds2D {
  const bounds = emptyBounds();
  includePoint(bounds, eq.a.x, transformedY(eq.a.y, flipY));
  includePoint(bounds, eq.b.x, transformedY(eq.b.y, flipY));
  return bounds;
}

function supportRotationForContainment(
  support: SupportEntity,
  containment: ContainmentEntity,
  flipY?: number,
): number | undefined {
  if (!containment.points || containment.points.length < 2) return undefined;
  const px = support.position.x;
  const py = transformedY(support.position.y, flipY);
  let bestDistSq = Infinity;
  let bestHeading: number | undefined;

  for (let i = 0; i < containment.points.length - 1; i++) {
    const a = containment.points[i];
    const b = containment.points[i + 1];
    const ax = a.x;
    const ay = transformedY(a.y, flipY);
    const bx = b.x;
    const by = transformedY(b.y, flipY);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const distSq = (px - cx) ** 2 + (py - cy) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestHeading = Math.atan2(dy, dx);
    }
  }

  return bestHeading == null ? undefined : bestHeading + Math.PI / 2;
}

function supportForRender(
  support: SupportEntity,
  parentContainment: ContainmentEntity | undefined,
  flipY?: number,
): SupportEntity {
  if (!parentContainment || support.autoGenerated === false) return support;
  const supportKind =
    parentContainment.containmentType === 'conduit'
      ? support.supportKind
      : 'trapeze-hanger';
  return {
    ...support,
    supportKind,
    rotation:
      supportRotationForContainment(support, parentContainment, flipY) ??
      support.rotation,
  };
}

function connectedContainmentAt(
  position: FittingEntity['position'],
  parentId: string,
  containments: ContainmentEntity[],
): boolean {
  return containments.some((c) => c.id !== parentId && containmentTouchesPoint(c, position));
}

function isOpenJunctionContainment(containment: ContainmentEntity): boolean {
  return (
    containment.containmentType === 'tray' ||
    containment.containmentType === 'basket' ||
    containment.containmentType === 'ladder'
  );
}

function shouldSkipFitting3D(
  fitting: FittingEntity,
  parent: ContainmentEntity | undefined,
  containments: ContainmentEntity[],
): boolean {
  if (!parent) return fitting.autoGenerated === true;
  if (parent.containmentType === 'conduit') return true;
  if (!fitting.autoGenerated) return false;

  const isAutoBend =
    fitting.fittingKind === 'flat-bend' ||
    fitting.fittingKind === 'inside-riser' ||
    fitting.fittingKind === 'outside-riser';
  if (isAutoBend) return true;

  const isEndCap = fitting.fittingKind === 'end-cap' || fitting.fittingKind === 'end-plate';
  if (isEndCap && isOpenJunctionContainment(parent)) return true;

  const isConnectedEnd =
    isEndCap &&
    connectedContainmentAt(fitting.position, parent.id, containments);
  if (isConnectedEnd) return true;

  const isOpenJunction =
    (fitting.fittingKind === 'tee' || fitting.fittingKind === 'cross') &&
    isOpenJunctionContainment(parent);
  return isOpenJunction;
}

interface ContainmentEndpoint {
  x: number;
  y: number;
  heading: number;
}

function containmentEndpoints(
  containment: ContainmentEntity,
  flipY?: number,
): ContainmentEndpoint[] {
  const points = containment.points;
  if (!points || points.length < 2) return [];
  const first = points[0];
  const second = points[1];
  const last = points[points.length - 1];
  const penultimate = points[points.length - 2];
  const firstY = transformedY(first.y, flipY);
  const secondY = transformedY(second.y, flipY);
  const lastY = transformedY(last.y, flipY);
  const penultimateY = transformedY(penultimate.y, flipY);

  return [
    {
      x: first.x,
      y: firstY,
      heading: Math.atan2(secondY - firstY, second.x - first.x),
    },
    {
      x: last.x,
      y: lastY,
      heading: Math.atan2(lastY - penultimateY, last.x - penultimate.x),
    },
  ];
}

function equipmentFootprintContains(
  equipment: EquipmentEntity,
  x: number,
  y: number,
  flipY?: number,
): boolean {
  const ax = equipment.a.x;
  const bx = equipment.b.x;
  const ay = transformedY(equipment.a.y, flipY);
  const by = transformedY(equipment.b.y, flipY);
  const margin = 150;
  return (
    x >= Math.min(ax, bx) - margin &&
    x <= Math.max(ax, bx) + margin &&
    y >= Math.min(ay, by) - margin &&
    y <= Math.max(ay, by) + margin
  );
}

function equipmentTopZ(equipment: EquipmentEntity): number {
  return (equipment.elevation ?? 0) + (equipment.height ?? 1800);
}

const LOW_LEVEL_DROP_SUBTYPES = new Set<string>([
  'floor',
  'skirting',
  'dado',
  'underground-duct',
  'cable-trench',
]);

function isLowLevelDropContainment(containment: ContainmentEntity): boolean {
  return (
    containment.containmentType === 'duct' ||
    LOW_LEVEL_DROP_SUBTYPES.has(containment.subType ?? '')
  );
}

function buildEquipmentDrop(
  containment: ContainmentEntity,
  endpoint: ContainmentEndpoint,
  equipment: EquipmentEntity,
  floor: Floor,
  systemId: SystemId | undefined,
  options: BuildSceneOptions,
): THREE.Object3D | null {
  const bottomZ = defaultElevation(containment, floor);
  const targetZ = equipmentTopZ(equipment);
  const dropH = bottomZ - targetZ;
  if (dropH < 150) return null;

  const width = containment.width ?? 100;
  const height = containment.height ?? 50;
  const color = colourFor(containment, {
    materials: options.materials,
    systemId,
    floor,
  });
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.75,
    roughness: 0.4,
  });
  const root = new THREE.Group();
  root.name = `equipment-drop:${containment.id}:${equipment.id}`;
  root.position.set(endpoint.x, endpoint.y, targetZ + dropH / 2);
  root.rotation.z = endpoint.heading;

  const isOpen =
    containment.containmentType === 'tray' ||
    containment.containmentType === 'basket' ||
    containment.containmentType === 'ladder';

  if (isOpen) {
    const rail = 8;
    const depth = Math.max(80, Math.min(180, height * 1.5));
    for (const sy of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(rail, rail, dropH), mat);
      side.position.y = sy * (width / 2 - rail / 2);
      side.castShadow = true;
      side.receiveShadow = true;
      root.add(side);
    }
    for (const sz of [-1, 1]) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(depth, width, rail), mat);
      tie.position.z = sz * (dropH / 2 - rail / 2);
      tie.castShadow = true;
      tie.receiveShadow = true;
      root.add(tie);
    }
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(40, height), width, dropH),
      mat,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
  }

  tag(root, containment.id);
  root.userData.systemId = systemId;
  root.userData.equipmentId = equipment.id;
  return root;
}

function buildEquipmentDropGroup(
  containments: ContainmentEntity[],
  equipment: EquipmentEntity[],
  floor: Floor,
  options: BuildSceneOptions,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'equipment-drops';

  for (const containment of containments) {
    if (containment.containmentType === 'conduit') continue;
    if (isLowLevelDropContainment(containment)) continue;
    const systemId = resolveSystemId(containment, options);
    for (const endpoint of containmentEndpoints(containment, options.flipY)) {
      const target = equipment.find((item) => equipmentFootprintContains(
        item,
        endpoint.x,
        endpoint.y,
        options.flipY,
      ));
      if (!target) continue;
      const drop = buildEquipmentDrop(containment, endpoint, target, floor, systemId, options);
      if (drop) root.add(drop);
    }
  }

  return root;
}

interface WallOpeningRun {
  points: ContainmentEntity['points'];
  width: number;
  height: number;
  baseZ: number;
}

interface WallOpeningSpan {
  left: number;
  right: number;
  zBottom: number;
  zTop: number;
}

const WALL_OPENING_CLEARANCE = 120;
const WALL_OPENING_MERGE_GAP = 30;

function segmentIntersect2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { t: number; s: number } | null {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = dx - cx;
  const vy = dy - cy;
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-6) return null;

  const wx = ax - cx;
  const wy = ay - cy;
  const t = (vx * wy - vy * wx) / cross;
  const s = (ux * wy - uy * wx) / cross;
  if (t < -0.001 || t > 1.001 || s < -0.001 || s > 1.001) return null;

  return {
    t: Math.max(0, Math.min(1, t)),
    s: Math.max(0, Math.min(1, s)),
  };
}

function wallOpeningRunsFor(
  containments: ContainmentEntity[],
  floor: Floor,
): WallOpeningRun[] {
  return containments
    .filter((c) => c.containmentType !== 'conduit' && c.points.length >= 2)
    .map((c) => ({
      points: c.points,
      width: c.width ?? 100,
      height: c.height ?? 50,
      baseZ: defaultElevation(c, floor),
    }));
}

function mergeWallOpenings(
  spans: WallOpeningSpan[],
  wallLen: number,
  wallHeight: number,
): WallOpeningSpan[] {
  const minLocal = -wallLen / 2;
  const maxLocal = wallLen / 2;
  const clamped = spans
    .map((span) => ({
      left: Math.max(minLocal, Math.min(maxLocal, span.left)),
      right: Math.max(minLocal, Math.min(maxLocal, span.right)),
      zBottom: Math.max(0, Math.min(wallHeight, span.zBottom)),
      zTop: Math.max(0, Math.min(wallHeight, span.zTop)),
    }))
    .filter((span) => span.right - span.left > 1 && span.zTop - span.zBottom > 1)
    .sort((a, b) => a.left - b.left);

  const merged: WallOpeningSpan[] = [];
  for (const span of clamped) {
    const prev = merged[merged.length - 1];
    if (!prev || span.left > prev.right + WALL_OPENING_MERGE_GAP) {
      merged.push({ ...span });
      continue;
    }
    prev.right = Math.max(prev.right, span.right);
    prev.zBottom = Math.min(prev.zBottom, span.zBottom);
    prev.zTop = Math.max(prev.zTop, span.zTop);
  }

  return merged;
}

function wallOpeningsForSegment(
  wallAx: number,
  wallAy: number,
  wallBx: number,
  wallBy: number,
  runs: WallOpeningRun[],
  wallHeight: number,
  flipY?: number,
): WallOpeningSpan[] {
  const wallLen = Math.hypot(wallBx - wallAx, wallBy - wallAy);
  if (wallLen < 1) return [];

  const wdx = (wallBx - wallAx) / wallLen;
  const wdy = (wallBy - wallAy) / wallLen;
  const spans: WallOpeningSpan[] = [];

  for (const run of runs) {
    for (let i = 0; i < run.points.length - 1; i++) {
      const a = run.points[i];
      const b = run.points[i + 1];
      const ay = transformedY(a.y, flipY);
      const by = transformedY(b.y, flipY);
      const hit = segmentIntersect2D(
        wallAx,
        wallAy,
        wallBx,
        wallBy,
        a.x,
        ay,
        b.x,
        by,
      );
      if (!hit) continue;

      const cdx = b.x - a.x;
      const cdy = by - ay;
      const contLen = Math.hypot(cdx, cdy);
      if (contLen < 1) continue;

      const sinAngle = Math.abs((cdx * wdy - cdy * wdx) / contLen);
      if (sinAngle < 0.05) continue;

      const holeW = Math.min(
        run.width / sinAngle + WALL_OPENING_CLEARANCE * 2,
        wallLen * 0.9,
      );
      const center = hit.t * wallLen - wallLen / 2;
      spans.push({
        left: center - holeW / 2,
        right: center + holeW / 2,
        zBottom: run.baseZ - WALL_OPENING_CLEARANCE,
        zTop: run.baseZ + run.height + WALL_OPENING_CLEARANCE,
      });
    }
  }

  return mergeWallOpenings(spans, wallLen, wallHeight);
}

function buildWallGroup(
  walls: WallEntity[],
  containmentRuns: WallOpeningRun[] = [],
  flipY?: number,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'walls';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xeceeef,
    metalness: 0.0,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  for (const w of walls) {
    if (!w.points || w.points.length < 2) continue;
    const thickness = w.thickness ?? 200;
    const wallH = w.height ?? 3000;
    const grp = new THREE.Group();
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      const ay = transformedY(a.y, flipY);
      const by = transformedY(b.y, flipY);
      const dx = b.x - a.x;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const cx = (a.x + b.x) / 2;
      const cy = (ay + by) / 2;
      const heading = Math.atan2(dy, dx);
      const openings = wallOpeningsForSegment(
        a.x,
        ay,
        b.x,
        by,
        containmentRuns,
        wallH,
        flipY,
      );

      if (openings.length === 0) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, wallH), mat);
        seg.position.set(cx, cy, wallH / 2);
        seg.rotation.z = heading;
        seg.castShadow = true;
        seg.receiveShadow = true;
        grp.add(seg);
        continue;
      }

      const segGroup = new THREE.Group();
      segGroup.position.set(cx, cy, 0);
      segGroup.rotation.z = heading;

      const addBox = (boxX: number, boxZ: number, boxW: number, boxH: number): void => {
        if (boxW < 1 || boxH < 1) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxW, thickness, boxH), mat);
        mesh.position.set(boxX, 0, boxZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        segGroup.add(mesh);
      };

      let cursor = -len / 2;
      for (const opening of openings) {
        if (opening.left > cursor) {
          addBox((cursor + opening.left) / 2, wallH / 2, opening.left - cursor, wallH);
        }

        const openingW = opening.right - opening.left;
        const openingCenter = (opening.left + opening.right) / 2;
        if (opening.zBottom > 1) {
          addBox(openingCenter, opening.zBottom / 2, openingW, opening.zBottom);
        }
        const aboveH = wallH - opening.zTop;
        if (aboveH > 1) {
          addBox(openingCenter, opening.zTop + aboveH / 2, openingW, aboveH);
        }

        cursor = Math.max(cursor, opening.right);
      }

      if (cursor < len / 2) {
        addBox((cursor + len / 2) / 2, wallH / 2, len / 2 - cursor, wallH);
      }

      grp.add(segGroup);
    }
    tag(grp, w.id);
    root.add(grp);
  }
  return root;
}

function buildRoomGroup(rooms: RoomEntity[], flipY?: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rooms';
  for (const r of rooms) {
    const xMin = Math.min(r.a.x, r.b.x);
    const xMax = Math.max(r.a.x, r.b.x);
    const yMin = Math.min(r.a.y, r.b.y);
    const yMax = Math.max(r.a.y, r.b.y);
    const w = xMax - xMin;
    const d = yMax - yMin;
    if (w < 1e-3 || d < 1e-3) continue;
    const colour = r.floorColor ? new THREE.Color(r.floorColor).getHex() : 0xb6c1cc;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, d, 6),
      new THREE.MeshStandardMaterial({ color: colour, metalness: 0.0, roughness: 0.85 }),
    );
    const cy = flipY != null ? flipY - (yMin + yMax) / 2 : (yMin + yMax) / 2;
    slab.position.set((xMin + xMax) / 2, cy, 3);
    slab.receiveShadow = true;
    tag(slab, r.id);
    root.add(slab);
  }
  return root;
}

function buildFloorSlab(floor: Floor, bounds: Bounds2D | null): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd6dadf, metalness: 0.0, roughness: 0.85,
  });
  const margin = 450;
  const slabBounds = bounds ?? {
    minX: -10000,
    minY: -10000,
    maxX: 10000,
    maxY: 10000,
  };
  const width = Math.max(1000, slabBounds.maxX - slabBounds.minX + margin * 2);
  const depth = Math.max(1000, slabBounds.maxY - slabBounds.minY + margin * 2);
  const centerX = (slabBounds.minX + slabBounds.maxX) / 2;
  const centerY = (slabBounds.minY + slabBounds.maxY) / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, floor.slabThickness ?? 150),
    mat,
  );
  slab.position.set(centerX, centerY, -((floor.slabThickness ?? 150) / 2));
  slab.receiveShadow = true;
  slab.userData.layer = 'floors';
  return slab;
}

function formatLevelMm(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toLocaleString('en-GB')}`;
}

function makeDatumLabelSprite(text: string, opacity = 0.72): THREE.Sprite {
  if (typeof document === 'undefined') {
    const fallback = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0 }));
    fallback.scale.set(900, 220, 1);
    fallback.userData.layer = 'labels';
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(16, 24, 34, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = '#f3f7fb';
    ctx.font = '700 58px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
  }));
  sprite.scale.set(900, 220, 1);
  sprite.renderOrder = 6;
  sprite.userData.layer = 'labels';
  return sprite;
}

function buildFflMarker(floor: Floor, bounds: Bounds2D | null): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ffl-markers';
  root.userData.layer = 'labels';

  const markerBounds = bounds ?? {
    minX: -10000,
    minY: -10000,
    maxX: 10000,
    maxY: 10000,
  };
  const x = markerBounds.minX + 700;
  const y = markerBounds.minY + 700;
  const maxZ = Math.max(1000, Math.min(3000, floor.floorHeight ?? 3000));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x1677ff,
    transparent: true,
    opacity: 0.38,
    depthTest: true,
  });
  const tickMat = new THREE.LineBasicMaterial({
    color: 0xf6f8fb,
    transparent: true,
    opacity: 0.58,
    depthTest: true,
  });

  const addLine = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    mat: THREE.LineBasicMaterial,
    name: string,
  ): void => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, mat);
    line.name = name;
    line.renderOrder = 6;
    line.userData.layer = 'labels';
    root.add(line);
  };

  addLine(new THREE.Vector3(x, y, 0), new THREE.Vector3(x + 1600, y, 0), lineMat, 'ffl-baseline');
  addLine(new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, maxZ), lineMat, 'ffl-ruler');

  const datumInset = 120;
  const px0 = markerBounds.minX + datumInset;
  const py0 = markerBounds.minY + datumInset;
  const px1 = markerBounds.maxX - datumInset;
  const py1 = markerBounds.maxY - datumInset;
  if (px1 - px0 > 1000 && py1 - py0 > 1000) {
    const datumZ = 12;
    const perimeter = [
      [new THREE.Vector3(px0, py0, datumZ), new THREE.Vector3(px1, py0, datumZ)],
      [new THREE.Vector3(px1, py0, datumZ), new THREE.Vector3(px1, py1, datumZ)],
      [new THREE.Vector3(px1, py1, datumZ), new THREE.Vector3(px0, py1, datumZ)],
      [new THREE.Vector3(px0, py1, datumZ), new THREE.Vector3(px0, py0, datumZ)],
    ] as const;
    perimeter.forEach(([a, b], index) => addLine(a, b, lineMat, `ffl-perimeter:${index}`));
  }

  const floorLabel = makeDatumLabelSprite(`FFL ${formatLevelMm(0)} mm`);
  floorLabel.position.set(x + 2050, y, 110);
  root.add(floorLabel);

  const datumLabel = makeDatumLabelSprite(`site ${formatLevelMm(floor.ffl)} mm`);
  datumLabel.position.set(x + 2050, y, 360);
  datumLabel.scale.set(760, 180, 1);
  root.add(datumLabel);

  for (let z = 1000; z <= maxZ; z += 1000) {
    addLine(new THREE.Vector3(x - 250, y, z), new THREE.Vector3(x + 250, y, z), tickMat, `ffl-tick:${z}`);
    const label = makeDatumLabelSprite(`+${z.toLocaleString('en-GB')} FFL`);
    label.position.set(x + 850, y, z);
    label.scale.set(720, 180, 1);
    root.add(label);
  }

  return root;
}

// ---------- Riser builder ---------------------------------------------------

function buildRiser(
  r: RiserEntity,
  fromZ: number,
  toZ: number,
  flipY?: number,
): THREE.Object3D {
  const grp = new THREE.Group();
  grp.name = `riser:${r.id}`;
  const w = r.width || 100;
  const h = r.height || 100;
  const span = Math.max(50, Math.abs(toZ - fromZ));
  const isConduit = r.containmentType === 'conduit';
  const colour = r.color ? new THREE.Color(r.color).getHex() : 0x8a8e94;
  const mat = new THREE.MeshStandardMaterial({
    color: colour, metalness: 0.6, roughness: 0.4,
  });
  const py = flipY != null ? flipY - r.position.y : r.position.y;
  if (isConduit) {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(w / 2, w / 2, span, 16),
      mat,
    );
    tube.position.set(r.position.x, py, (fromZ + toZ) / 2);
    tube.castShadow = true;
    grp.add(tube);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, span), mat);
    box.position.set(r.position.x, py, (fromZ + toZ) / 2);
    box.castShadow = true;
    grp.add(box);
  }
  tag(grp, r.id);
  return grp;
}

// ---------- Floor renderer --------------------------------------------------

function renderFloor(
  project: Project,
  floor: Floor,
  options: BuildSceneOptions,
): FloorGroupInfo {
  const grp = new THREE.Group();
  grp.name = `floor:${floor.id}`;
  grp.position.z = floor.ffl;
  grp.userData.floorId = floor.id;

  const layers = options.layers ?? {};
  const wantWalls = layers.walls !== false;
  const wantRooms = layers.rooms !== false;
  const wantContainment = layers.containment !== false;
  const wantFittings = layers.fittings !== false;
  const wantSupports = layers.supports !== false;
  const wantEquipment = layers.equipment !== false;
  const wantFloor = layers.floors !== false;
  const wantLabels = layers.labels !== false;

  const entities = gatherSheetEntities(project, floor.sheetIds);
  const walls: WallEntity[] = [];
  const rooms: RoomEntity[] = [];
  const containments: ContainmentEntity[] = [];
  const fittings: FittingEntity[] = [];
  const supports: SupportEntity[] = [];
  const equipment: EquipmentEntity[] = [];
  const risers: RiserEntity[] = [];

  for (const e of entities) {
    if (!e.visible) continue;
    switch (e.kind) {
      case 'wall': walls.push(e); break;
      case 'room': rooms.push(e); break;
      case 'containment': containments.push(e); break;
      case 'fitting': fittings.push(e); break;
      case 'support': supports.push(e); break;
      case 'equipment': equipment.push(e); break;
      case 'riser': risers.push(e); break;
      default: break;
    }
  }

  const shellBounds = floorShellBounds(rooms, walls, options.flipY);
  const clipBounds = shellBounds ? expandBounds(shellBounds, 350) : null;
  const visibleContainments = clipBounds
    ? containments.filter((c) => {
        const bounds = containmentBounds(c, options.flipY);
        return bounds ? boundsOverlap(bounds, clipBounds) : false;
      })
    : containments;
  const visibleFittings = clipBounds
    ? fittings.filter((f) => boundsOverlap(fittingBounds(f, options.flipY), clipBounds))
    : fittings;
  const visibleSupports = clipBounds
    ? supports.filter((s) => boundsOverlap(supportBounds(s, options.flipY), clipBounds))
    : supports;
  const visibleEquipment = clipBounds
    ? equipment.filter((eq) => boundsOverlap(equipmentBounds(eq, options.flipY), clipBounds))
    : equipment;

  const containmentMap = new Map<string, ContainmentEntity>();
  for (const c of visibleContainments) containmentMap.set(c.id, c);
  const floorBounds = shellBounds ?? floorContentBounds(
    visibleContainments,
    visibleFittings,
    visibleSupports,
    visibleEquipment,
    options.flipY,
  );

  // Build each layer as a sub-group so SceneControls can toggle them.
  if (wantFloor) {
    grp.add(buildFloorSlab(floor, floorBounds));
  }
  if (wantLabels) {
    grp.add(buildFflMarker(floor, floorBounds));
  }
  if (wantWalls) {
    grp.add(buildWallGroup(
      walls,
      wallOpeningRunsFor(visibleContainments, floor),
      options.flipY,
    ));
  }
  if (wantRooms) grp.add(buildRoomGroup(rooms, options.flipY));

  const systemMap = new Map<string, SystemId | undefined>();
  if (wantContainment) {
    const cgrp = new THREE.Group();
    cgrp.name = 'containment';
    for (const c of visibleContainments) {
      if (c.containmentType === 'conduit') continue;
      const systemId = resolveSystemId(c, options);
      systemMap.set(c.id, systemId);
      const obj = renderContainment3D(c, {
        materials: options.materials,
        systemId,
        floor,
        flipY: options.flipY,
      });
      obj.userData.systemId = systemId;
      cgrp.add(obj);
    }
    const equipmentDrops = buildEquipmentDropGroup(
      visibleContainments,
      visibleEquipment,
      floor,
      options,
    );
    for (const drop of [...equipmentDrops.children]) cgrp.add(drop);
    grp.add(cgrp);
  }

  if (wantFittings) {
    const fgrp = new THREE.Group();
    fgrp.name = 'fittings';
    for (const f of visibleFittings) {
      const parent = containmentMap.get(f.containmentId);
      if (shouldSkipFitting3D(f, parent, visibleContainments)) continue;
      const baseZ = parent
        ? defaultElevation(parent, floor) + (parent.height ?? 50) / 2
        : 2400;
      const obj = renderFitting3D(f, {
        parent,
        materials: options.materials,
        systemId: parent ? resolveSystemId(parent, options) : undefined,
      });
      obj.position.z = baseZ;
      // Adjust position from fitting.position with optional Y flip
      const fy = options.flipY != null ? options.flipY - f.position.y : f.position.y;
      obj.position.set(f.position.x, fy, baseZ);
      obj.userData.systemId = parent ? resolveSystemId(parent, options) : undefined;
      fgrp.add(obj);
    }
    grp.add(fgrp);
  }

  if (wantSupports) {
    const sgrp = new THREE.Group();
    sgrp.name = 'supports';
    for (const s of visibleSupports) {
      // Find the containment this support carries to know the bottom-Z.
      let bottomZ: number | undefined;
      let parentContainment: ContainmentEntity | undefined;
      const cid = s.supportingContainmentIds?.[0];
      if (cid) {
        const c = containmentMap.get(cid);
        if (c) {
          parentContainment = c;
          bottomZ = defaultElevation(c, floor);
        }
      }
      const renderSupport = supportForRender(s, parentContainment, options.flipY);
      if (!parentContainment && s.autoGenerated) continue;
      if (parentContainment?.containmentType === 'conduit' && s.autoGenerated) continue;
      const hideAutoRouteRods =
        s.autoGenerated === true && parentContainment?.containmentType !== 'conduit';
      const obj = renderSupport3D(renderSupport, {
        containmentBottomZ: bottomZ ?? 2400,
        containmentWidth: parentContainment?.width,
        hideHangerRods: hideAutoRouteRods,
      });
      const sy = options.flipY != null ? options.flipY - s.position.y : s.position.y;
      obj.position.set(s.position.x, sy, 0);
      obj.userData.systemId = parentContainment ? resolveSystemId(parentContainment, options) : undefined;
      sgrp.add(obj);
    }
    grp.add(sgrp);
  }

  if (wantEquipment) {
    const egrp = new THREE.Group();
    egrp.name = 'equipment';
    for (const eq of visibleEquipment) {
      egrp.add(renderEquipment3D(eq, { flipY: options.flipY }));
    }
    grp.add(egrp);
  }

  if ((options.layers?.risers ?? true) && risers.length > 0) {
    const rgrp = new THREE.Group();
    rgrp.name = 'risers';
    for (const r of risers) {
      if (clipBounds && !boundsOverlap(pointBounds(r.position.x, transformedY(r.position.y, options.flipY)), clipBounds)) {
        continue;
      }
      const fromFloor = r.fromFloorId ? project.floors?.[r.fromFloorId] : undefined;
      const toFloor = r.toFloorId ? project.floors?.[r.toFloorId] : undefined;
      const fromZ = (r.fromElevation ?? fromFloor?.ffl ?? floor.ffl) - floor.ffl;
      const toZ = (r.toElevation ?? toFloor?.ffl ?? floor.ffl + 3000) - floor.ffl;
      rgrp.add(buildRiser(r, fromZ, toZ, options.flipY));
    }
    grp.add(rgrp);
  }

  return { floor, group: grp, systemMap };
}

// ---------- Public entry point ---------------------------------------------

/**
 * Build the whole-site 3D scene from a project. Returns a Group for
 * adding to the scene plus a SceneControls handle for runtime toggles.
 */
export function buildBuildingScene(
  project: Project,
  options: BuildSceneOptions = {},
): { group: THREE.Group; controls: SceneControls } {
  const root = new THREE.Group();
  root.name = 'site';

  const floorInfos: FloorGroupInfo[] = [];

  // Build each building as a sub-group, positioned at gridOriginX/Y.
  const buildings: Record<string, Building> = project.buildings ?? {};
  const buildingIds = project.activeSiteId
    ? project.sites?.[project.activeSiteId]?.buildingOrder ?? Object.keys(buildings)
    : Object.keys(buildings);

  for (const bid of buildingIds) {
    const b = buildings[bid];
    if (!b) continue;
    const bgrp = new THREE.Group();
    bgrp.name = `building:${bid}`;
    bgrp.position.set(b.gridOriginX ?? 0, b.gridOriginY ?? 0, 0);
    for (const fid of b.floorOrder) {
      const floor = project.floors?.[fid];
      if (!floor) continue;
      if (options.visibleFloors && !options.visibleFloors.has(fid)) continue;
      const info = renderFloor(project, floor, options);
      floorInfos.push(info);
      bgrp.add(info.group);
    }
    root.add(bgrp);
  }

  // ---------- Controls ----------
  const layerOpacity = new Map<SceneLayer, number>();

  const setLayerOpacity = (layer: SceneLayer, opacity: number): void => {
    layerOpacity.set(layer, opacity);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Identify the layer by walking up the parent chain
        let p: THREE.Object3D | null = obj;
        let foundLayer: SceneLayer | null = null;
        while (p) {
          if (p.name === layer) { foundLayer = layer; break; }
          if (p.userData.layer === layer) { foundLayer = layer; break; }
          p = p.parent;
        }
        if (foundLayer === layer) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (m && 'opacity' in m) {
              (m as THREE.Material).transparent = opacity < 1;
              (m as THREE.Material).opacity = opacity;
              (m as THREE.Material).needsUpdate = true;
            }
          }
        }
      }
    });
  };

  const isolateFloor = (floorId: FloorId | null): void => {
    for (const info of floorInfos) {
      info.group.visible = floorId == null || info.floor.id === floorId;
    }
  };

  const filterSystem = (systemId: SystemId | null): void => {
    for (const info of floorInfos) {
      const cgrp = info.group.getObjectByName('containment');
      const fgrp = info.group.getObjectByName('fittings');
      const sgrp = info.group.getObjectByName('supports');
      for (const grp of [cgrp, fgrp, sgrp]) {
        if (!grp) continue;
        for (const child of grp.children) {
          const sid = child.userData.systemId as SystemId | undefined;
          child.visible = systemId == null || sid === systemId;
        }
      }
    }
  };

  const dispose = (): void => {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose?.();
      } else if (obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.SpriteMaterial | undefined;
        mat?.map?.dispose?.();
        mat?.dispose?.();
      } else if (obj instanceof THREE.Line) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose?.();
      }
    });
  };

  return {
    group: root,
    controls: {
      isolateFloor,
      filterSystem,
      setTransparency: setLayerOpacity,
      dispose,
    },
  };
}
