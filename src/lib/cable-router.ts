// Cable router — find the shortest, fill-aware path through a
// containment graph for a given Cable.
//
// The router uses a classic Dijkstra shortest-path with edge weights
// derived from physical length plus penalty terms for category mis-match
// (e.g. a power cable through a data tray) and for elevated fill levels.
// Edges already at or above the fill target are skipped entirely so
// the router prefers a longer compliant path over a shorter overstuffed
// one.
//
// Pure function — does not mutate the graph or the cable.
import type { Cable } from '../models/cable';
import type {
  ContainmentEntity,
  ContainmentType,
  Vec2,
} from '../types';
import type { ContainmentGraph, GraphEdge } from './containment-graph';
import { buildAdjacency, nearestNode } from './containment-graph';

export interface RouteOptions {
  // Maximum acceptable fill ratio (0..1). Edges where adding the cable
  // would exceed this are skipped. Default 0.45 (BS 7671 trunking limit).
  fillTarget?: number;
  // If true, edges whose containment cableCategory conflicts with the
  // cable's circuitType are dropped from the graph entirely. If false
  // (the default) they are kept but heavily penalised so the router can
  // fall back when no compliant route exists.
  avoidIncompatible?: boolean;
  // Optional snap tolerance when locating the start / end nodes.
  snapTolerance?: number;
}

export interface RoutingResult {
  found: boolean;
  // Ordered list of containment entities the cable passes through.
  // Adjacent edges that share a containmentId collapse into a single
  // entry so the route reads naturally as "tray A → riser B → conduit C".
  path: ContainmentEntity[];
  // Total physical length of the route in mm.
  length: number;
  // Sum of (cable CSA / containment inner CSA) over all edges.
  // Closer to 0 is better.
  totalFillImpact: number;
  // Human-readable warnings for the UI.
  warnings: string[];
}

// Outer cross-section area of the cable in mm² (used for fill).
function cableOuterCsa(cable: Cable): number {
  const od = cable.outerDiameter;
  return Math.PI * (od / 2) * (od / 2);
}

// Compute the per-edge fill increment caused by adding a cable.
// Returns Infinity if the edge has zero inner CSA (degenerate).
function edgeFillImpact(edge: GraphEdge, cableCsa: number): number {
  if (edge.innerCsa <= 0) return Infinity;
  return cableCsa / edge.innerCsa;
}

// Compatibility heuristic — does the cable's circuit type belong on
// this kind of containment? We don't enforce strict segregation here
// (that's a separate analysis); we just provide a soft preference so
// the router naturally avoids forcing power into a data-only tray.
function categoryCompatible(
  edge: GraphEdge,
  cable: Cable,
  containmentMap: Map<string, ContainmentEntity>
): boolean {
  const c = containmentMap.get(edge.containmentId);
  if (!c) return true;
  if (!c.cableCategory || c.cableCategory === 'mixed') return true;
  // Direct equality
  if (c.cableCategory === cable.circuitType) return true;
  // Allow control on power containment
  if (c.cableCategory === 'power' && cable.circuitType === 'control') return true;
  // Allow comms on data
  if (c.cableCategory === 'data' && cable.circuitType === 'comms') return true;
  if (c.cableCategory === 'comms' && cable.circuitType === 'data') return true;
  return false;
}

// Containment type ranks — used as a tiebreaker so the router prefers
// large permanent infrastructure (ladder/tray) over conduit when both
// are available.
const TYPE_PREFERENCE: Record<ContainmentType, number> = {
  ladder: 0,
  tray: 0,
  basket: 0,
  duct: 0,
  busbar: 0,
  trunking: 1,
  conduit: 2,
};

// Penalty multiplier for an edge whose category doesn't match the cable
// circuit (used when avoidIncompatible is false).
const INCOMPATIBLE_PENALTY = 5;

// Penalty multiplier added per percentage of remaining fill consumed
// (gentle gradient so nearly-full edges get nudged but not banned).
const FILL_PENALTY = 0.5;

// Min-priority queue using a binary heap. Specialised to <string,number>
// keyed entries to avoid pulling in a generic heap dependency.
class MinHeap {
  private items: Array<{ id: string; key: number }> = [];

  push(id: string, key: number): void {
    this.items.push({ id, key });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): { id: string; key: number } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[i].key < this.items[parent].key) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let smallest = i;
      if (l < n && this.items[l].key < this.items[smallest].key) smallest = l;
      if (r < n && this.items[r].key < this.items[smallest].key) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

// Find an optimal route for a cable through the containment graph.
export function routeCableThroughGraph(
  graph: ContainmentGraph,
  fromPos: Vec2,
  toPos: Vec2,
  cable: Cable,
  containments: ContainmentEntity[],
  options: RouteOptions = {}
): RoutingResult {
  const fillTarget = options.fillTarget ?? 0.45;
  const avoidIncompatible = options.avoidIncompatible ?? false;
  const snapTolerance = options.snapTolerance ?? 50;

  const containmentMap = new Map<string, ContainmentEntity>();
  for (const c of containments) containmentMap.set(c.id, c);

  const startNode = nearestNode(graph, fromPos, snapTolerance);
  const endNode = nearestNode(graph, toPos, snapTolerance);

  if (!startNode || !endNode) {
    return {
      found: false,
      path: [],
      length: 0,
      totalFillImpact: 0,
      warnings: !startNode
        ? ['No containment node near cable start point']
        : ['No containment node near cable end point'],
    };
  }
  if (startNode.id === endNode.id) {
    return {
      found: true,
      path: [],
      length: 0,
      totalFillImpact: 0,
      warnings: ['Start and end points are at the same node'],
    };
  }

  const adj = buildAdjacency(graph);
  const cableCsa = cableOuterCsa(cable);

  // Dijkstra
  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; edge: GraphEdge }>();
  const heap = new MinHeap();
  dist.set(startNode.id, 0);
  heap.push(startNode.id, 0);

  while (heap.size > 0) {
    const top = heap.pop()!;
    const u = top.id;
    if (u === endNode.id) break;
    const known = dist.get(u);
    if (known === undefined || top.key > known) continue;
    const edges = adj.get(u) ?? [];
    for (const e of edges) {
      const v = e.fromId === u ? e.toId : e.fromId;
      // Skip edges that would push fill over the target
      const fillIncrement = edgeFillImpact(e, cableCsa);
      if (!isFinite(fillIncrement) || fillIncrement > fillTarget) continue;
      // Compatibility check
      const compatible = categoryCompatible(e, cable, containmentMap);
      if (!compatible && avoidIncompatible) continue;
      // Edge weight = length × (compatibility penalty) × (fill penalty) × (type preference)
      let weight = e.length;
      if (!compatible) weight *= INCOMPATIBLE_PENALTY;
      weight *= 1 + fillIncrement * FILL_PENALTY;
      // Add a tiny bias for less-preferred types
      weight *= 1 + TYPE_PREFERENCE[e.type] * 0.05;
      const alt = (known ?? 0) + weight;
      const existing = dist.get(v);
      if (existing === undefined || alt < existing) {
        dist.set(v, alt);
        prev.set(v, { from: u, edge: e });
        heap.push(v, alt);
      }
    }
  }

  if (!dist.has(endNode.id)) {
    return {
      found: false,
      path: [],
      length: 0,
      totalFillImpact: 0,
      warnings: [
        `No fill-compliant route from ${cable.from} to ${cable.to} (fill target ${(fillTarget * 100).toFixed(0)}%)`,
      ],
    };
  }

  // Reconstruct path
  const edgePath: GraphEdge[] = [];
  let cur = endNode.id;
  while (cur !== startNode.id) {
    const step = prev.get(cur);
    if (!step) break;
    edgePath.unshift(step.edge);
    cur = step.from;
  }

  // Collapse consecutive edges with the same containment id into a
  // single entry — that's how engineers describe the route.
  const path: ContainmentEntity[] = [];
  let lastContainmentId: string | null = null;
  let totalLength = 0;
  let totalFill = 0;
  const warnings: string[] = [];
  for (const e of edgePath) {
    totalLength += e.length;
    totalFill += edgeFillImpact(e, cableCsa);
    if (e.containmentId !== lastContainmentId) {
      const c = containmentMap.get(e.containmentId);
      if (c) path.push(c);
      lastContainmentId = e.containmentId;
    }
    if (!categoryCompatible(e, cable, containmentMap)) {
      const c = containmentMap.get(e.containmentId);
      warnings.push(
        `Cable ${cable.reference} (${cable.circuitType}) routed through ${c?.cableCategory ?? 'mixed'} containment ${c?.label ?? e.containmentId}`
      );
    }
  }

  // Deduplicate warnings
  const uniqueWarnings = Array.from(new Set(warnings));

  return {
    found: true,
    path,
    length: totalLength,
    totalFillImpact: totalFill,
    warnings: uniqueWarnings,
  };
}
