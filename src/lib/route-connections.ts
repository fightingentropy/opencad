import type { ContainmentEntity, Entity, Project, RouteConnection, Sheet } from '../types';
import { closestOnPath, distance3, equipmentPorts, pointAlongPath, routePath, withRoutePath, type Point3 } from './route-path';

export const endpointKey = (id: string, end: 'start' | 'end') => id + ':' + end;
const ends = ['start', 'end'] as const;
export const routeEnd = (route: ContainmentEntity, end: 'start' | 'end', project: Project): Point3 => {
  const sheet = project.sheets[project.activeSheetId];
  const path = routePath(route, project.floors?.[sheet?.floorId ?? '']);
  return path[end === 'start' ? 0 : path.length - 1];
};
const visible = (entity: Entity, project: Project) => entity.visible !== false && project.layers[entity.layerId]?.visible !== false;
export function connectionTarget(connection: RouteConnection, sheet: Sheet, project: Project): Point3 | null {
  const target = sheet.entities[connection.targetId];
  if (!target) return null;
  if (target.kind === 'equipment' && connection.target.kind === 'equipment') {
    const name = connection.target.port;
    return equipmentPorts(target).find(port => port.name === name)?.position ?? null;
  }
  if (target.kind !== 'containment' || connection.target.kind !== 'route' || target.points.length < 2) return null;
  if (connection.target.anchor !== 'fraction') return routeEnd(target, connection.target.anchor, project);
  return pointAlongPath(routePath(target, project.floors?.[sheet.floorId ?? '']), connection.target.fraction ?? 0);
}

/** Discover only physical joints, respecting section, elevation and visible reference layers. */
export function discoverRouteConnections(route: ContainmentEntity, project: Project, tolerance = 10): RouteConnection[] {
  const sheet = project.sheets[project.activeSheetId];
  if (!sheet || route.points.length < 2) return [];
  const output: RouteConnection[] = [];
  for (const end of ends) {
    const point = routeEnd(route, end, project);
    let best: { connection: RouteConnection; score: number } | null = null;
    for (const other of Object.values(sheet.entities)) {
      if (other.id === route.id || !visible(other, project)) continue;
      if (other.kind === 'containment') {
        if (other.containmentType !== route.containmentType || Math.abs((other.width ?? 0) - (route.width ?? 0)) > 0.1
          || Math.abs((other.height ?? 0) - (route.height ?? 0)) > 0.1) continue;
        const path = routePath(other, project.floors?.[sheet.floorId ?? '']);
        const hit = closestOnPath(point, path);
        if (!hit || hit.distance > tolerance) continue;
        const anchor = distance3(point, path[0]) <= tolerance ? 'start'
          : distance3(point, path.at(-1)!) <= tolerance ? 'end' : 'fraction';
        const score = hit.distance + (anchor === 'fraction' ? tolerance : 0);
        if (!best || score < best.score) best = { score, connection: { end, targetId: other.id,
          target: { kind: 'route', anchor, ...(anchor === 'fraction' ? { fraction: hit.fraction } : {}) } } };
      } else if (other.kind === 'equipment') {
        for (const port of equipmentPorts(other)) {
          const distance = distance3(point, port.position);
          if (distance <= tolerance && (!best || distance < best.score)) best = { score: distance,
            connection: { end, targetId: other.id, target: { kind: 'equipment', port: port.name } } };
        }
      }
    }
    if (best) output.push(best.connection);
  }
  return output;
}

export function routeEndStates(route: ContainmentEntity, project: Project): {
  end: 'start' | 'end'; point: Point3; connected: boolean; locked: boolean; broken: boolean;
}[] {
  if (route.points.length < 2) return [];
  const sheet = project.sheets[project.activeSheetId];
  const discovered = discoverRouteConnections(route, project, 1);
  return ends.map(end => {
    const point = routeEnd(route, end, project);
    const saved = route.connections?.find(connection => connection.end === end);
    const target = saved ? connectionTarget(saved, sheet, project) : null;
    const matches = !!target && distance3(target, point) < 1;
    return { end, point, connected: matches || discovered.some(connection => connection.end === end),
      locked: !!route.connectionsLocked && matches, broken: !!route.connectionsLocked && !!saved && !matches };
  });
}

/** Stage all joined endpoints before the caller records one history entry. */
export function keepRouteConnections(previous: Project, next: Project, changedIds: Iterable<string>): { project: Project; changedIds: string[] } {
  const sheet = next.sheets[next.activeSheetId];
  const oldSheet = previous.sheets[next.activeSheetId];
  if (!sheet || !oldSheet) return { project: next, changedIds: [] };
  const entities = { ...sheet.entities };
  const primary = new Set(changedIds);
  const preferred = new Map<string, Point3>();
  const touched = new Set<string>();
  for (const id of primary) {
    const entity = entities[id], old = oldSheet.entities[id];
    if (entity?.kind !== 'containment' || entity.points.length < 2) continue;
    for (const end of ends) {
      const point = routeEnd(entity, end, next);
      if (old?.kind !== 'containment' || distance3(point, routeEnd(old, end, previous)) > 0.01) preferred.set(endpointKey(id, end), point);
    }
  }
  const setEndpoint = (id: string, end: 'start' | 'end', point: Point3): boolean => {
    const route = entities[id];
    if (route?.kind !== 'containment' || distance3(routeEnd(route, end, next), point) <= 0.01) return false;
    if (route.locked || next.layers[route.layerId]?.locked || !visible(route, next)) {
      throw new Error('A joined route is locked or hidden. Unlock it or release the connection before moving this part.');
    }
    const path = routePath(route, next.floors?.[sheet.floorId ?? '']);
    const index = end === 'start' ? 0 : path.length - 1;
    const adjacent = index === 0 ? 1 : index - 1;
    // Preserve the vertical drop into a moved board. The horizontal lead
    // stretches while the terminal leg remains directly above its port.
    if (path.length > 2 && Math.hypot(path[index].x - path[adjacent].x, path[index].y - path[adjacent].y) < 0.01) {
      path[adjacent] = { ...path[adjacent], x: point.x, y: point.y };
    }
    path[index] = { ...point };
    if (path.some((p, i) => i > 0 && distance3(path[i - 1], p) < 1)) throw new Error('This move would collapse a connected leg. Adjust the route first.');
    entities[id] = withRoutePath(route, path); touched.add(id); return true;
  };
  // Fractional branch anchors can depend on another adjusted endpoint. Iterate
  // to a fixed point; failure leaves the entire proposed edit uncommitted.
  for (let iteration = 0; iteration <= Object.keys(entities).length + 1; iteration++) {
    const graph = new Map<string, Set<string>>();
    const nodes = new Map<string, { id: string; end: 'start' | 'end' }>();
    const fixed = new Map<string, { point: Point3; targetId: string }[]>();
    const node = (id: string, end: 'start' | 'end') => {
      const key = endpointKey(id, end); nodes.set(key, { id, end });
      if (!graph.has(key)) graph.set(key, new Set()); return key;
    };
    for (const entity of Object.values(entities)) {
      if (entity.kind !== 'containment' || !entity.connectionsLocked) continue;
      for (const connection of entity.connections ?? []) {
        const target = entities[connection.targetId];
        if (!target) continue; // A deleted target remains visibly disconnected.
        const a = node(entity.id, connection.end);
        if (target.kind === 'containment' && connection.target.kind === 'route' && connection.target.anchor !== 'fraction') {
          const b = node(target.id, connection.target.anchor);
          graph.get(a)!.add(b); graph.get(b)!.add(a);
        } else {
          const point = connectionTarget(connection, { ...sheet, entities }, next);
          if (point) fixed.set(a, [...(fixed.get(a) ?? []), { point, targetId: target.id }]);
        }
      }
    }
    const visited = new Set<string>();
    let changed = false;
    for (const key of nodes.keys()) {
      if (visited.has(key)) continue;
      const component: string[] = [], queue = [key];
      while (queue.length) {
        const current = queue.pop()!;
        if (visited.has(current)) continue;
        visited.add(current); component.push(current); queue.push(...graph.get(current)!);
      }
      const fixedLinks = component.flatMap(id => fixed.get(id) ?? []);
      const affected = component.some(id => primary.has(nodes.get(id)!.id) || touched.has(nodes.get(id)!.id))
        || fixedLinks.some(link => primary.has(link.targetId) || touched.has(link.targetId));
      if (!affected) continue;
      const anchors = fixedLinks.map(link => link.point);
      if (anchors.some(p => distance3(p, anchors[0]) > 0.01)) throw new Error('The locked connections require different positions. Release a connection before making this edit.');
      const moving = component.flatMap(id => preferred.has(id) ? [preferred.get(id)!] : []);
      if (!anchors.length && moving.some(p => distance3(p, moving[0]) > 0.01)) throw new Error('The joined ends would move to different positions. Release their connection before this edit.');
      const chosen = anchors[0] ?? moving[0];
      if (!chosen) continue;
      for (const id of component) { const entry = nodes.get(id)!; changed = setEndpoint(entry.id, entry.end, chosen) || changed; }
    }
    if (!changed) return { project: touched.size ? { ...next, sheets: { ...next.sheets, [sheet.id]: { ...sheet, entities } } } : next,
      changedIds: [...touched] };
  }
  throw new Error('These connection constraints cannot settle. Release a connection and try again.');
}
