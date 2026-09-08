import type { ContainmentEntity, Entity, Project, RouteConnection, RoutePoint, Sheet, Vec2 } from '../types';
import { defaultElevation } from '../three/elevations';
import { polylineLength } from './fittings';
import { closestOnPath, distance3, equipmentPorts, routePath, withRoutePath, type Point3 } from './route-path';

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
  const point = (p: RoutePoint): RoutePoint => ({
    ...p,
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
  if (entity.points.some(p => p.z != null)) {
    const path = routePath(entity), origin = path[0];
    return withRoutePath(entity, path.map(p => ({ x: origin.x + (p.x - origin.x) * length / previous,
      y: origin.y + (p.y - origin.y) * length / previous, z: origin.z + (p.z - origin.z) * length / previous })));
  }
  return { ...entity, points: entity.points.map(p => ({ x: start.x + (p.x - start.x) * length / previous, y: start.y + (p.y - start.y) * length / previous })) };
}

export interface ConnectionSnap {
  position: RoutePoint; target: Point3; entityId: string; label: 'Endpoint' | 'Route' | 'Equipment';
  sourceEnd: 'start' | 'end'; attachment: RouteConnection['target'];
}

/** Snap in saved sheet coordinates. Elevation, section and visibility all matter. */
export function snapPhysicalConnection(
  entity: PhysicalEntity, position: RoutePoint, project: Project, tolerance: number,
  options: { pointOnly?: boolean; sourceEnd?: 'start' | 'end'; excludeId?: string; sheet?: Sheet } = {},
): ConnectionSnap | null {
  const sheet = options.sheet ?? project.sheets[project.activeSheetId];
  if (!sheet || entity.kind === 'equipment') return null;
  const floor = sheet.floorId ? project.floors?.[sheet.floorId] : undefined;
  const path = entity.kind === 'containment' ? routePath(entity, floor) : [];
  const candidates: { point: Point3; end: 'start' | 'end' }[] = entity.kind === 'containment' && !options.pointOnly
    ? [{ point: path[0], end: 'start' }, { point: path.at(-1)!, end: 'end' }]
    : [{ point: { ...position, z: position.z ?? physicalElevation(entity, project, sheet.id) }, end: options.sourceEnd ?? 'end' }];
  let best: ConnectionSnap | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const other of Object.values(sheet.entities)) {
    if ((other.kind !== 'containment' && other.kind !== 'equipment') || other.id === options.excludeId || other.visible === false
      || project.layers[other.layerId]?.visible === false) continue;
    if (other.kind === 'equipment' && entity.kind !== 'containment') continue;
    if (other.kind === 'containment' && other.points.length < 2) continue;
    if (entity.kind === 'containment' && other.kind === 'containment' && (other.containmentType !== entity.containmentType
      || Math.abs((other.width ?? 0) - (entity.width ?? 0)) > 0.1
      || Math.abs((other.height ?? 0) - (entity.height ?? 0)) > 0.1)) continue;
    for (const { point: candidate, end } of candidates) {
      const otherPath = other.kind === 'containment' ? routePath(other, floor) : [];
      const closest = closestOnPath(candidate, otherPath);
      const targets: { target: Point3; label: ConnectionSnap['label']; attachment: RouteConnection['target'] }[] = other.kind === 'equipment'
        ? equipmentPorts(other).map(port => ({ target: port.position, label: 'Equipment', attachment: { kind: 'equipment', port: port.name } }))
        : [{ target: otherPath[0], label: 'Endpoint', attachment: { kind: 'route', anchor: 'start' } },
          { target: otherPath.at(-1)!, label: 'Endpoint', attachment: { kind: 'route', anchor: 'end' } },
          ...(closest ? [{ target: closest.point, label: 'Route' as const,
            attachment: { kind: 'route' as const, anchor: 'fraction' as const, fraction: closest.fraction } }] : [])];
      for (const { target, label, attachment } of targets) {
        if (Math.abs(candidate.z - target.z) > 1) continue;
        const d = distance3(candidate, target);
        // An endpoint within the cursor tolerance wins over a nearby point
        // on the same segment, so a joint cannot land a few mm short.
        const score = d + (label === 'Route' ? tolerance : 0);
        if (d >= tolerance || score >= bestScore) continue;
        bestScore = score;
        best = { position: { ...position, x: position.x + target.x - candidate.x, y: position.y + target.y - candidate.y },
          target, entityId: other.id, label, sourceEnd: end, attachment };
      }
    }
  }
  return best;
}

/** Nearby 45° axes are magnetic; Shift locks the closest axis at any angle. */
export function alignRoutePoint(point: Vec2, anchor: Vec2, force = false): Vec2 {
  const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
  const angle = Math.atan2(point.y - anchor.y, point.x - anchor.x);
  const snapped = Math.round(angle / (Math.PI / 4)) * Math.PI / 4;
  return force || Math.abs(angle - snapped) < Math.PI / 45
    ? { x: anchor.x + Math.cos(snapped) * length, y: anchor.y + Math.sin(snapped) * length } : point;
}

/** Cursor-space endpoint/port snap can change the workplane height. */
export function snapProjectedConnection(
  route: ContainmentEntity, cursor: Vec2, project: Project, projectPoint: (point: Point3) => Vec2 | null,
  options: { excludeId?: string; sourceEnd?: 'start' | 'end'; tolerancePx?: number } = {},
): ConnectionSnap | null {
  const sheet = project.sheets[project.activeSheetId];
  if (!sheet) return null;
  let best: ConnectionSnap | null = null;
  let nearest = options.tolerancePx ?? 14;
  for (const entity of Object.values(sheet.entities)) {
    if (entity.id === options.excludeId || entity.visible === false || project.layers[entity.layerId]?.visible === false) continue;
    const targets: { point: Point3; attachment: RouteConnection['target'] }[] = [];
    if (entity.kind === 'equipment') targets.push(...equipmentPorts(entity).map(port => ({ point: port.position,
      attachment: { kind: 'equipment' as const, port: port.name } })));
    if (entity.kind === 'containment' && entity.points.length >= 2 && entity.containmentType === route.containmentType
      && entity.width === route.width && entity.height === route.height) {
      const path = routePath(entity, project.floors?.[sheet.floorId ?? '']);
      targets.push({ point: path[0], attachment: { kind: 'route', anchor: 'start' } },
        { point: path.at(-1)!, attachment: { kind: 'route', anchor: 'end' } });
    }
    for (const { point, attachment } of targets) {
      const projected = projectPoint(point);
      if (!projected) continue;
      const distance = Math.hypot(projected.x - cursor.x, projected.y - cursor.y);
      if (distance >= nearest) continue;
      nearest = distance;
      best = { position: { ...point }, target: point, entityId: entity.id,
        label: entity.kind === 'equipment' ? 'Equipment' : 'Endpoint', attachment, sourceEnd: options.sourceEnd ?? 'end' };
    }
  }
  return best;
}
