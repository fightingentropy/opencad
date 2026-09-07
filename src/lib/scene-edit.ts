import type { ContainmentEntity, Entity, Project, Sheet, Vec2 } from '../types';
import { defaultElevation } from '../three/elevations';
import { polylineLength } from './fittings';

export type PhysicalEntity = Extract<Entity, { kind: 'containment' | 'equipment' | 'support' }>;
export const isPhysicalEntity = (entity: Entity | undefined): entity is PhysicalEntity =>
  !!entity && ['containment', 'equipment', 'support'].includes(entity.kind);

export function hasSpatialWorkspace(project: Project, sheet = project.sheets[project.activeSheetId]): boolean {
  return sheet?.sceneStyle === 'containment' || sheet?.sceneStyle === 'site'
    || (!!sheet?.floorId && Object.keys(project.sites ?? {}).length > 0);
}

export function physicalAnchor(entity: PhysicalEntity): Vec2 {
  if (entity.kind === 'support') return { ...entity.position };
  const points = entity.kind === 'equipment' ? [entity.a, entity.b] : entity.points;
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2,
    y: (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2,
  };
}

export function physicalElevation(entity: PhysicalEntity, project: Project, sheetId = project.activeSheetId): number {
  const sheet = project.sheets[sheetId];
  return entity.kind === 'containment' ? defaultElevation(entity, sheet?.floorId ? project.floors?.[sheet.floorId] : undefined)
    : entity.elevation ?? 0;
}

export function physicalHeading(entity: PhysicalEntity): number {
  if (entity.kind !== 'containment') return entity.rotation ?? 0;
  const [a, b] = entity.points;
  return a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
}

export function transformPhysicalEntity(entity: PhysicalEntity, anchor: Vec2, rotation = 0): PhysicalEntity {
  const from = physicalAnchor(entity);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const point = (p: Vec2): Vec2 => ({
    x: anchor.x + (p.x - from.x) * cos - (p.y - from.y) * sin,
    y: anchor.y + (p.x - from.x) * sin + (p.y - from.y) * cos,
  });
  if (entity.kind === 'containment') return { ...entity, points: entity.points.map(point) };
  if (entity.kind === 'support') return { ...entity, position: { ...anchor }, rotation: entity.rotation + rotation };
  const dx = anchor.x - from.x, dy = anchor.y - from.y;
  return {
    ...entity, a: { x: entity.a.x + dx, y: entity.a.y + dy }, b: { x: entity.b.x + dx, y: entity.b.y + dy },
    rotation: (entity.rotation ?? 0) + rotation,
    ...(entity.connections ? { connections: entity.connections.map(connection => ({ ...connection, position: point(connection.position) })) } : {}),
  };
}

/** Change total route length while keeping its first end and bend angles fixed. */
export function resizeRoute(entity: ContainmentEntity, length: number): ContainmentEntity {
  const previous = polylineLength(entity.points);
  if (!Number.isFinite(length) || length < 10 || length > 1_000_000 || previous < 1) throw new Error('Enter a route length between 10 and 1,000,000 mm.');
  const start = entity.points[0];
  return { ...entity, points: entity.points.map(p => ({ x: start.x + (p.x - start.x) * length / previous, y: start.y + (p.y - start.y) * length / previous })) };
}

export interface ConnectionSnap { position: Vec2; target: Vec2; entityId: string; label: 'Endpoint' | 'Route'; }
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const closestOnSegment = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + dx * t, y: a.y + dy * t };
};

/** Snap in saved sheet coordinates. Elevation, section and visibility all matter. */
export function snapPhysicalConnection(
  entity: PhysicalEntity, position: Vec2, project: Project, tolerance: number,
  options: { pointOnly?: boolean; excludeId?: string; sheet?: Sheet } = {},
): ConnectionSnap | null {
  const sheet = options.sheet ?? project.sheets[project.activeSheetId];
  if (!sheet || entity.kind === 'equipment') return null;
  const candidates = entity.kind === 'containment' && !options.pointOnly
    ? [entity.points[0], entity.points.at(-1)!] : [position];
  let best: ConnectionSnap | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const other of Object.values(sheet.entities)) {
    if (other.kind !== 'containment' || other.id === options.excludeId || other.visible === false
      || project.layers[other.layerId]?.visible === false || other.points.length < 2) continue;
    if (entity.kind === 'containment' && (other.containmentType !== entity.containmentType
      || Math.abs((other.width ?? 0) - (entity.width ?? 0)) > 0.1
      || Math.abs((other.height ?? 0) - (entity.height ?? 0)) > 0.1)) continue;
    if (Math.abs(physicalElevation(other, project, sheet.id) - physicalElevation(entity, project, sheet.id)) > 1) continue;
    for (const candidate of candidates) {
      const targets: { target: Vec2; label: ConnectionSnap['label'] }[] = [
        { target: other.points[0], label: 'Endpoint' }, { target: other.points.at(-1)!, label: 'Endpoint' },
        ...other.points.slice(1).map((p, i) => ({ target: closestOnSegment(candidate, other.points[i], p), label: 'Route' as const })),
      ];
      for (const { target, label } of targets) {
        const d = distance(candidate, target);
        // An endpoint within the cursor tolerance wins over a nearby point
        // on the same segment, so a joint cannot land a few mm short.
        const score = d + (label === 'Endpoint' ? 0 : tolerance);
        if (d >= tolerance || score >= bestScore) continue;
        bestScore = score;
        best = { position: { x: position.x + target.x - candidate.x, y: position.y + target.y - candidate.y }, target, entityId: other.id, label };
      }
    }
  }
  return best;
}

/** Nearby 45° axes are magnetic; Shift locks the closest axis at any angle. */
export function alignRoutePoint(point: Vec2, anchor: Vec2, force = false): Vec2 {
  const length = distance(point, anchor);
  const angle = Math.atan2(point.y - anchor.y, point.x - anchor.x);
  const snapped = Math.round(angle / (Math.PI / 4)) * Math.PI / 4;
  return force || Math.abs(angle - snapped) < Math.PI / 45
    ? { x: anchor.x + Math.cos(snapped) * length, y: anchor.y + Math.sin(snapped) * length } : point;
}
