import type { ContainmentEntity, EquipmentEntity, RoutePoint, Vec2 } from '../types';
import type { Floor } from '../models/site';
import { defaultElevation } from '../three/elevations';

export type Point3 = Vec2 & { z: number };
export const distance3 = (a: RoutePoint, b: RoutePoint): number =>
  Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
export const interpolate3 = (a: Point3, b: Point3, t: number): Point3 => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
export const routePath = (route: ContainmentEntity, floor?: Floor): Point3[] => {
  const base = defaultElevation(route, floor);
  return route.points.map(p => ({ x: p.x, y: p.y, z: p.z ?? base }));
};
export const pathLength = (points: RoutePoint[]): number =>
  points.reduce((sum, p, i) => sum + (i ? distance3(points[i - 1], p) : 0), 0);
export const routeLength = (route: ContainmentEntity, floor?: Floor): number => pathLength(routePath(route, floor));
export const hasHeightChanges = (route: ContainmentEntity): boolean => {
  const points = routePath(route);
  return points.some(p => Math.abs(p.z - points[0].z) > 0.01);
};
export function pointAlongPath(points: Point3[], fraction: number): Point3 {
  let remaining = Math.max(0, Math.min(1, fraction)) * pathLength(points);
  for (let i = 1; i < points.length; i++) {
    const length = distance3(points[i - 1], points[i]);
    if (remaining <= length && length > 0) return interpolate3(points[i - 1], points[i], remaining / length);
    remaining -= length;
  }
  return { ...points.at(-1)! };
}
export function closestOnPath(point: Point3, points: Point3[]): { point: Point3; distance: number; fraction: number; segment: number } | null {
  let best: ReturnType<typeof closestOnPath> = null;
  let walked = 0;
  const total = pathLength(points);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const length = distance3(a, b);
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / length ** 2));
    const candidate = interpolate3(a, b, t);
    const distance = distance3(point, candidate);
    if (!best || distance < best.distance) best = { point: candidate, distance, fraction: (walked + t * length) / total, segment: i - 1 };
    walked += length;
  }
  return best;
}

/** Normalise new spatial routes, retaining the base elevation for older consumers. */
export function withRoutePath(route: ContainmentEntity, points: Point3[]): ContainmentEntity {
  return { ...route, elevation: points[0]?.z ?? route.elevation, points: points.map(p => ({ ...p })) };
}

export function equipmentPorts(equipment: EquipmentEntity): { name: string; position: Point3 }[] {
  const base = equipment.elevation ?? 0;
  const height = equipment.height ?? 1000;
  if (equipment.connections?.length) return equipment.connections.map(connection => ({
    name: connection.name, position: { ...connection.position,
      z: connection.elevation ?? base + (connection.type === 'bottom' ? 0 : connection.type === 'side' ? height / 2 : height) },
  }));
  const centre = { x: (equipment.a.x + equipment.b.x) / 2, y: (equipment.a.y + equipment.b.y) / 2 };
  return [{ name: 'Top', position: { ...centre, z: base + height } }, { name: 'Bottom', position: { ...centre, z: base } }];
}

/** Horizontal sections eligible for the existing horizontal-support rules. */
export function horizontalRouteSections(route: ContainmentEntity): { route: ContainmentEntity; distanceAlong: number }[] {
  const points = routePath(route);
  const sections: { route: ContainmentEntity; distanceAlong: number }[] = [];
  let walked = 0;
  let current: Point3[] = [];
  let start = 0;
  const flush = () => {
    if (current.length > 1) sections.push({ route: withRoutePath(route, current), distanceAlong: start });
    current = [];
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (Math.abs(a.z - b.z) < 0.01 && distance3(a, b) > 0.01) {
      if (!current.length) { current = [a]; start = walked; }
      current.push(b);
    } else flush();
    walked += distance3(a, b);
  }
  flush();
  return sections;
}
