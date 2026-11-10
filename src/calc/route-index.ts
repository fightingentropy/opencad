// Containment id -> the cables routed through it. Cable records are replaced,
// never mutated, when the schedule changes, so the index is cached per cables
// record and shared by the compliance run and the 2D fill overlay.
import type { Cable } from '../models/cable';
import type { EntityId } from '../types';

const cache = new WeakMap<object, Map<EntityId, Cable[]>>();

export const cablesByContainment = (
  cableMap: Record<string, Cable>,
): Map<EntityId, Cable[]> => {
  const hit = cache.get(cableMap);
  if (hit) return hit;
  const index = new Map<EntityId, Cable[]>();
  for (const cable of Object.values(cableMap)) {
    for (const id of new Set(cable.route ?? [])) {
      const list = index.get(id);
      if (list) list.push(cable);
      else index.set(id, [cable]);
    }
  }
  cache.set(cableMap, index);
  return index;
};
