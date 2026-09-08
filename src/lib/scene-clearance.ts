import type { ContainmentEntity, Entity, EquipmentEntity, Project } from '../types';
import { distance3, equipmentPorts, routePath, type Point3 } from './route-path';

export const DEFAULT_CLEARANCE_MM = 150;
export const DEFAULT_ACCESS_MM = 600;
export interface ClearanceBox {
  center: Point3; axes: [Point3, Point3, Point3]; half: [number, number, number];
  entityId: string; segment: number; access?: boolean;
}
export interface ClearanceIssue {
  id: string; sourceId: string; targetId: string; targetLabel: string;
  kind: 'overlap' | 'clearance' | 'access'; gap: number; limit: number;
  from: Point3; to: Point3; sourceBox: ClearanceBox; targetBox: ClearanceBox;
}
const add = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Point3, n: number): Point3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Point3): Point3 => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const Z = { x: 0, y: 0, z: 1 };
const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function boxCorners(box: ClearanceBox): Point3[] {
  return Array.from({ length: 8 }, (_, index) => box.axes.reduce((p, axis, i) =>
    add(p, mul(axis, box.half[i] * (index & (1 << i) ? 1 : -1))), box.center));
}
const edges = (box: ClearanceBox): [Point3, Point3][] => {
  const corners = boxCorners(box);
  return corners.flatMap((p, i) => [0, 1, 2].filter(axis => !(i & (1 << axis))).map(axis => [p, corners[i | (1 << axis)]] as [Point3, Point3]));
};
const closestPoint = (p: Point3, box: ClearanceBox) => box.axes.reduce((out, axis, i) =>
  add(out, mul(axis, clamp(dot(sub(p, box.center), axis), -box.half[i], box.half[i]))), box.center);

function nearestEdges(a: Point3, b: Point3, c: Point3, d: Point3): [Point3, Point3] {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), uw = dot(u, w), vw = dot(v, w);
  const denominator = uu * vv - uv * uv;
  let s = denominator > 1e-9 ? clamp((uv * vw - vv * uw) / denominator, 0, 1) : 0;
  let t = vv > 1e-9 ? (uv * s + vw) / vv : 0;
  if (t < 0) { t = 0; s = uu ? clamp(-uw / uu, 0, 1) : 0; }
  else if (t > 1) { t = 1; s = uu ? clamp((uv - uw) / uu, 0, 1) : 0; }
  return [add(a, mul(u, s)), add(c, mul(v, t))];
}

/** SAT for overlap; vertex/face and edge/edge distances for separated solids. */
export function boxSeparation(a: ClearanceBox, b: ClearanceBox, maximum = Infinity): { gap: number; from: Point3; to: Point3 } | null {
  const delta = sub(b.center, a.center);
  const radius = (box: ClearanceBox, axis: Point3) => box.axes.reduce((sum, v, i) => sum + Math.abs(dot(v, axis)) * box.half[i], 0);
  for (const axis of [X, Y, Z]) if (Math.abs(dot(delta, axis)) - radius(a, axis) - radius(b, axis) > maximum) return null;
  const axes = [...a.axes, ...b.axes, ...a.axes.flatMap(u => b.axes.map(v => cross(u, v)))].filter(v => dot(v, v) > 1e-9).map(norm);
  let separation = -Infinity;
  for (const axis of axes) separation = Math.max(separation, Math.abs(dot(delta, axis)) - radius(a, axis) - radius(b, axis));
  if (separation <= 0) {
    const point = closestPoint(closestPoint(b.center, a), b);
    return { gap: separation, from: point, to: point };
  }
  if (separation > maximum) return null;
  let best = { gap: Infinity, from: a.center, to: b.center };
  const consider = (from: Point3, to: Point3) => {
    const gap = distance3(from, to);
    if (gap < best.gap) best = { gap, from, to };
  };
  for (const p of boxCorners(a)) consider(p, closestPoint(p, b));
  for (const p of boxCorners(b)) consider(closestPoint(p, a), p);
  for (const ae of edges(a)) for (const be of edges(b)) consider(...nearestEdges(...ae, ...be));
  return best.gap <= maximum ? best : null;
}

function routeBoxes(route: ContainmentEntity, project: Project): ClearanceBox[] {
  const sheet = project.sheets[project.activeSheetId];
  const points = routePath(route, project.floors?.[sheet.floorId ?? '']);
  const width = route.width ?? 100, height = route.containmentType === 'conduit' ? width : route.height ?? 50;
  const boxes: ClearanceBox[] = [];
  let previous: Point3 | null = null, side = Y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = distance3(a, b);
    if (length < 0.01) continue;
    const tangent = norm(sub(b, a));
    if (!previous) side = Math.hypot(tangent.x, tangent.y) > 0.01 ? norm(cross(Z, tangent)) : Y;
    else {
      const v = cross(previous, tangent), cosine = dot(previous, tangent);
      if (cosine > -0.9999) side = add(add(side, cross(v, side)), mul(cross(v, cross(v, side)), 1 / (1 + cosine)));
      side = norm(sub(side, mul(tangent, dot(side, tangent))));
    }
    // Horizontal straight sections are always open upwards, including after a rise.
    const sectionSide = Math.hypot(tangent.x, tangent.y) > 0.9999 ? norm(cross(Z, tangent)) : side;
    const up = norm(cross(tangent, sectionSide));
    boxes.push({ center: add(mul(add(a, b), 0.5), { x: 0, y: 0, z: height / 2 }),
      axes: [tangent, sectionSide, up], half: [length / 2, width / 2, height / 2], entityId: route.id, segment: i - 1 });
    previous = tangent;
  }
  return boxes;
}

export function entityClearanceBoxes(entity: Entity, project: Project, includeAccess = true): ClearanceBox[] {
  if (entity.kind === 'containment') return routeBoxes(entity, project);
  if (entity.kind === 'wall') return entity.points.slice(1).map((b, i) => {
    const a = entity.points[i], height = entity.height ?? 3000;
    const tangent = norm({ x: b.x - a.x, y: b.y - a.y, z: 0 });
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (entity.elevation ?? 0) + height / 2 },
      axes: [tangent, cross(Z, tangent), Z], half: [Math.hypot(b.x - a.x, b.y - a.y) / 2, entity.thickness / 2, height / 2], entityId: entity.id, segment: i };
  });
  if (entity.kind !== 'equipment') return [];
  const angle = entity.rotation ?? 0, height = entity.height ?? 1000;
  const axes: ClearanceBox['axes'] = [{ x: Math.cos(angle), y: Math.sin(angle), z: 0 }, { x: -Math.sin(angle), y: Math.cos(angle), z: 0 }, Z];
  const box: ClearanceBox = { center: { x: (entity.a.x + entity.b.x) / 2, y: (entity.a.y + entity.b.y) / 2, z: (entity.elevation ?? 0) + height / 2 },
    axes, half: [Math.abs(entity.b.x - entity.a.x) / 2, Math.abs(entity.b.y - entity.a.y) / 2, height / 2], entityId: entity.id, segment: 0 };
  const access = entity.accessDepth ?? project.coordination?.equipmentAccessMm ?? DEFAULT_ACCESS_MM;
  // The equipment renderers place doors on local -Y.
  return includeAccess && access > 0 ? [box, { ...box, center: add(box.center, mul(axes[1], -box.half[1] - access / 2)),
    half: [box.half[0], access / 2, box.half[2]], access: true }] : [box];
}

const label = (entity: Entity) => entity.kind === 'equipment' ? entity.tag : entity.kind === 'wall'
  ? entity.label || (entity.structuralRole === 'beam' ? 'Beam' : 'Wall') : entity.kind === 'containment' ? entity.label || entity.containmentType : entity.kind;
function joinedLegs(a: Entity, ai: number, b: Entity, bi: number, project: Project): boolean {
  if (a.kind !== 'containment' || b.kind !== 'containment' || a.containmentType !== b.containmentType || a.width !== b.width || a.height !== b.height) return false;
  const floor = project.floors?.[project.sheets[project.activeSheetId].floorId ?? ''];
  const ap = routePath(a, floor), bp = routePath(b, floor);
  const direction = norm(sub(ap[ai + 1], ap[ai]));
  const otherDirection = norm(sub(bp[bi + 1], bp[bi]));
  if (Math.abs(dot(direction, otherDirection)) > .9999) {
    const values = [dot(sub(bp[bi], ap[ai]), direction), dot(sub(bp[bi + 1], ap[ai]), direction)];
    const overlap = Math.min(distance3(ap[ai], ap[ai + 1]), Math.max(...values)) - Math.max(0, Math.min(...values));
    if (overlap > 1) return false;
  }
  const nearest = (p: Point3, c: Point3, d: Point3) => {
    const v = sub(d, c), t = clamp(dot(sub(p, c), v) / Math.max(1e-9, dot(v, v)), 0, 1);
    return distance3(p, add(c, mul(v, t))) < 1;
  };
  return [0, ap.length - 1].some(i => (i === ai || i === ai + 1) && nearest(ap[i], bp[bi], bp[bi + 1]))
    || [0, bp.length - 1].some(i => (i === bi || i === bi + 1) && nearest(bp[i], ap[ai], ap[ai + 1]));
}
function portJoint(route: ContainmentEntity, segment: number, equipment: EquipmentEntity, at: Point3, project: Project): boolean {
  const path = routePath(route, project.floors?.[project.sheets[project.activeSheetId].floorId ?? '']);
  return [0, path.length - 1].some(i => (i === segment || i === segment + 1) && equipmentPorts(equipment).some(port =>
    distance3(port.position, path[i]) < 1 && distance3(at, port.position) <= Math.max(route.width ?? 100, route.height ?? 50)));
}

export function analyzeSceneClearance(project: Project, source: Entity): ClearanceIssue[] {
  const sheet = project.sheets[project.activeSheetId];
  if (!sheet) return [];
  const limit = project.coordination?.clearanceMm ?? DEFAULT_CLEARANCE_MM;
  const sourceBoxes = entityClearanceBoxes(source, project);
  const issues = new Map<string, ClearanceIssue>();
  for (const target of [...Object.values(sheet.entities).filter(e => e.id !== source.id), source]) {
    if (target.visible === false || project.layers[target.layerId]?.visible === false) continue;
    const targetBoxes = entityClearanceBoxes(target, project);
    for (const a of sourceBoxes) for (const b of targetBoxes) {
      if (a.access && b.access || source.id === target.id && (source.kind !== 'containment' || b.segment <= a.segment + 1)) continue;
      if (joinedLegs(source, a.segment, target, b.segment, project)) continue;
      const access = a.access || b.access;
      const hit = boxSeparation(a, b, access ? 0 : limit);
      if (!hit || access && hit.gap >= -0.01 || !access && hit.gap >= limit) continue;
      if (!access && source.kind === 'containment' && target.kind === 'equipment' && portJoint(source, a.segment, target, hit.from, project)) continue;
      if (!access && source.kind === 'equipment' && target.kind === 'containment' && portJoint(target, b.segment, source, hit.to, project)) continue;
      const kind = access ? 'access' : hit.gap < -0.01 ? 'overlap' : 'clearance';
      const key = target.id + ':' + kind;
      const issue: ClearanceIssue = { id: source.id + ':' + key, sourceId: source.id, targetId: target.id, targetLabel: label(target),
        kind, gap: hit.gap, limit, from: hit.from, to: hit.to, sourceBox: a, targetBox: b };
      if (!issues.has(key) || hit.gap < issues.get(key)!.gap) issues.set(key, issue);
    }
  }
  return [...issues.values()].sort((a, b) => a.gap - b.gap || a.targetLabel.localeCompare(b.targetLabel));
}
