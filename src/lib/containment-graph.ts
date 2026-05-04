// Containment-as-a-graph.
//
// The containment network in a project is fundamentally a connected
// graph: junctions / endpoints are nodes, straight runs between them
// are edges. A graph view enables shortest-path cable routing, fill
// analysis, segregation checks and consistency reporting.
//
// Construction is purely geometric — we collapse coincident vertices
// (within a tolerance) into shared graph nodes so two containments
// that touch at the same physical point are linked in the graph.
import type {
  ContainmentEntity,
  ContainmentType,
  EquipmentEntity,
  EntityId,
  Vec2,
} from '../types';
import { dist } from './math';

// Coincidence tolerance (mm) — vertices within this distance are
// considered the same graph node.
const NODE_MERGE_TOLERANCE_MM = 10;

export type GraphNodeKind = 'endpoint' | 'junction' | 'equipment';

export interface GraphNode {
  id: string;
  position: Vec2;
  kind: GraphNodeKind;
  // The containment / equipment entities that meet at this node
  containmentIds: EntityId[];
  // Optional link if this node is an equipment connection
  equipmentId?: EntityId;
  equipmentConnectionName?: string;
}

export interface GraphEdge {
  id: string;
  fromId: string; // GraphNode.id
  toId: string;
  containmentId: EntityId;
  // Polyline segment index within the containment's `points` array
  // (the edge goes from points[segmentIndex] to points[segmentIndex + 1]).
  segmentIndex: number;
  // Length in mm
  length: number;
  // Internal cross-section area in mm²
  innerCsa: number;
  // Containment type (drives compatibility / segregation)
  type: ContainmentType;
}

export interface ContainmentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Estimate inner cross-section area from outer dims when innerCsaMm2
// is not explicitly stored. Subtract a small wall-thickness allowance.
function estimateInnerCsa(c: ContainmentEntity): number {
  if (c.innerCsaMm2 != null) return c.innerCsaMm2;
  const w = c.width ?? 0;
  const h = c.height ?? 0;
  if (c.containmentType === 'conduit') {
    // For round conduit, width is OD; assume 1.5 mm wall thickness.
    const wall = 1.5;
    const innerR = Math.max(0, w / 2 - wall);
    return Math.PI * innerR * innerR;
  }
  // Generic deduction for sheet-metal / plastic containment: 2 mm wall.
  const wall = 2;
  const innerW = Math.max(0, w - wall * 2);
  const innerH = Math.max(0, h - wall * 2);
  return innerW * innerH;
}

function makeNodeId(): string {
  // Deterministic-ish id; doesn't need to be globally unique outside
  // the graph itself, but stable within a single buildContainmentGraph
  // call.
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

function makeEdgeId(): string {
  return `e_${Math.random().toString(36).slice(2, 10)}`;
}

// Merge a vertex into the existing node list, returning the matched node
// (creating a new one if no match within tolerance).
function attachOrCreate(
  nodes: GraphNode[],
  pos: Vec2,
  containmentId: EntityId,
  isEndpoint: boolean
): GraphNode {
  for (const n of nodes) {
    if (dist(n.position, pos) <= NODE_MERGE_TOLERANCE_MM) {
      if (!n.containmentIds.includes(containmentId)) {
        n.containmentIds.push(containmentId);
      }
      // Promote endpoint to junction if more than one containment now meets here
      if (n.containmentIds.length > 1) n.kind = 'junction';
      return n;
    }
  }
  const node: GraphNode = {
    id: makeNodeId(),
    position: { x: pos.x, y: pos.y },
    kind: isEndpoint ? 'endpoint' : 'junction',
    containmentIds: [containmentId],
  };
  nodes.push(node);
  return node;
}

// Build a containment graph from a flat list of containments and
// (optionally) equipment items. Equipment connection points become
// 'equipment' nodes that the router can treat as endpoints.
export function buildContainmentGraph(
  containments: ContainmentEntity[],
  equipment: EquipmentEntity[] = []
): ContainmentGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // First pass: equipment connection points seed graph nodes.
  for (const eq of equipment) {
    if (!eq.connections) continue;
    for (const conn of eq.connections) {
      const node: GraphNode = {
        id: makeNodeId(),
        position: { x: conn.position.x, y: conn.position.y },
        kind: 'equipment',
        containmentIds: [],
        equipmentId: eq.id,
        equipmentConnectionName: conn.name,
      };
      nodes.push(node);
    }
  }

  // Second pass: build a graph node per polyline vertex, merging
  // coincident vertices.
  for (const c of containments) {
    if (!c.points || c.points.length < 2) continue;
    const innerCsa = estimateInnerCsa(c);
    let prevNode: GraphNode | null = null;
    for (let i = 0; i < c.points.length; i++) {
      const isEndpoint = i === 0 || i === c.points.length - 1;
      const node = attachOrCreate(nodes, c.points[i], c.id, isEndpoint);
      if (prevNode && prevNode.id !== node.id) {
        const a = prevNode.position;
        const b = node.position;
        const length = dist(a, b);
        edges.push({
          id: makeEdgeId(),
          fromId: prevNode.id,
          toId: node.id,
          containmentId: c.id,
          segmentIndex: i - 1,
          length,
          innerCsa,
          type: c.containmentType,
        });
      }
      prevNode = node;
    }
  }

  return { nodes, edges };
}

// Find graph nodes within `tolerance` mm of a point.
export function nearbyNodes(
  graph: ContainmentGraph,
  point: Vec2,
  tolerance = 10
): GraphNode[] {
  const out: GraphNode[] = [];
  for (const n of graph.nodes) {
    if (dist(n.position, point) <= tolerance) out.push(n);
  }
  return out;
}

// Convenience: find the single closest node, preferring exact endpoint
// matches over interior junctions.
export function nearestNode(
  graph: ContainmentGraph,
  point: Vec2,
  tolerance = Infinity
): GraphNode | undefined {
  let best: GraphNode | undefined;
  let bestDist = Infinity;
  for (const n of graph.nodes) {
    const d = dist(n.position, point);
    if (d <= tolerance && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

// Helper — adjacency list for graph traversal.
export function buildAdjacency(
  graph: ContainmentGraph
): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.fromId)) adj.set(e.fromId, []);
    if (!adj.has(e.toId)) adj.set(e.toId, []);
    adj.get(e.fromId)!.push(e);
    adj.get(e.toId)!.push(e);
  }
  return adj;
}
