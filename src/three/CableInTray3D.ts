// Visualize cables routed inside a containment run.
//
// For each cable assigned to the segment we render a thin tube that
// follows the containment centre line. Cables are stacked side-by-side
// and then up by their OD — a basic "spread on the floor of the tray"
// packing that's enough to read at a glance. Cable colour is driven by
// circuitType.

import * as THREE from 'three';
import type { ContainmentEntity } from '../types';
import type { Cable, CableCircuitType } from '../models/cable';
import { defaultElevation } from './elevations';
import type { Floor } from '../models/site';

export interface CableInTrayOpts {
  /** Maximum cables to render. Anything above is skipped for perf. */
  maxCables?: number;
  /** Optional Y flip for CAD-y polylines. */
  flipY?: number;
  /** Floor context for elevation calculation. */
  floor?: Floor;
  /** Force a specific Z elevation (overrides containment.elevation). */
  forceElevation?: number;
}

const CIRCUIT_COLORS: Record<CableCircuitType, number> = {
  power: 0xc62d2d,
  control: 0x9a59b5,
  data: 0x2a55a6,
  'fire-alarm': 0xff7a00,
  emergency: 0xeac413,
  instrumentation: 0x3aaaa6,
  comms: 0x2eaa3a,
  av: 0x8e44ad,
  earthing: 0x5a4628,
};

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

// Pack cable centres inside a rectangular containment cross-section.
// Returns a list of (offsetY, offsetZ) offsets from the centre-line.
// Simple algorithm — fill rows of decreasing radius.
function packCables(
  cables: Cable[],
  trayWidth: number,
  trayHeight: number,
): { y: number; z: number; r: number; cable: Cable }[] {
  const out: { y: number; z: number; r: number; cable: Cable }[] = [];
  let curX = -trayWidth / 2;
  let curZ = -trayHeight / 2;
  let rowMaxR = 0;
  for (const cable of cables) {
    const r = Math.max(2, cable.outerDiameter / 2);
    if (curX + r * 2 > trayWidth / 2) {
      curZ += rowMaxR * 2 + 2;
      curX = -trayWidth / 2;
      rowMaxR = 0;
    }
    if (curZ + r * 2 > trayHeight / 2) break; // overflow — stop rendering
    out.push({ y: curX + r, z: curZ + r, r, cable });
    curX += r * 2 + 2;
    if (r > rowMaxR) rowMaxR = r;
  }
  return out;
}

// Build a centerline curve from the polyline points at a given Z.
function buildCenterCurve(
  points: { x: number; y: number }[],
  z: number,
  flipY?: number,
): THREE.CatmullRomCurve3 | null {
  const pts: THREE.Vector3[] = [];
  for (const p of points) {
    const py = flipY != null ? flipY - p.y : p.y;
    pts.push(new THREE.Vector3(p.x, py, z));
  }
  if (pts.length < 2) return null;
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
}

/**
 * Render the cables inside a containment as parallel tubes following the
 * polyline. Returns a Group that the caller adds to the scene.
 */
export function renderCablesInContainment(
  containment: ContainmentEntity,
  cables: Cable[],
  opts: CableInTrayOpts = {},
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `cables-in:${containment.id}`;

  const max = opts.maxCables ?? 20;
  const list = cables.slice(0, max);
  if (list.length === 0 || !containment.points || containment.points.length < 2) {
    return root;
  }

  const w = containment.width ?? 100;
  const h = containment.height ?? 50;
  const baseZ =
    typeof opts.forceElevation === 'number'
      ? opts.forceElevation
      : defaultElevation(containment, opts.floor);
  const centerZ = baseZ + h / 2;

  // Compute cross-section packing once
  const packs = packCables(list, w * 0.92, h * 0.92);

  // Build a tube per cable. Reuse the centerline curve translated to
  // per-cable (Δy, Δz). To translate, we walk the polyline ourselves and
  // emit a TubeGeometry along the offset path. For a polyline this is
  // equivalent to translating the curve in 3D (since the path is in the
  // XY plane, offset-Y is along the local cross-section width and
  // offset-Z is straight up).
  for (const pack of packs) {
    const offsetPts: { x: number; y: number }[] = [];
    // Per-segment, push the offset point. For an axis-aligned offset in
    // the cross-section we'd need the local heading at each vertex; a
    // simple approximation: use the average heading of incoming +
    // outgoing segments.
    for (let i = 0; i < containment.points.length; i++) {
      const cur = containment.points[i];
      const prev = containment.points[i - 1] ?? cur;
      const next = containment.points[i + 1] ?? cur;
      const headIn = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      const headOut = Math.atan2(next.y - cur.y, next.x - cur.x);
      const headAvg = (headIn + headOut) / 2;
      // Local +Y (cross-section width) is perp-left of heading.
      const ox = -Math.sin(headAvg) * pack.y;
      const oy = Math.cos(headAvg) * pack.y;
      offsetPts.push({ x: cur.x + ox, y: cur.y + oy });
    }
    const curve = buildCenterCurve(offsetPts, centerZ + pack.z, opts.flipY);
    if (!curve) continue;
    const tube = new THREE.TubeGeometry(
      curve,
      Math.max(8, offsetPts.length * 4),
      pack.r,
      8,
      false,
    );
    const colour = CIRCUIT_COLORS[pack.cable.circuitType] ?? 0x666666;
    const mat = new THREE.MeshStandardMaterial({
      color: colour,
      metalness: 0.05,
      roughness: 0.6,
    });
    const mesh = new THREE.Mesh(tube, mat);
    mesh.castShadow = true;
    mesh.userData.entityId = containment.id;
    mesh.userData.cableId = pack.cable.id;
    root.add(mesh);
  }

  tagPicking(root, containment.id);
  return root;
}

// Public lookup so other modules (e.g. CrossSectionViz) can colour cables
// consistently.
export function colourForCircuit(t: CableCircuitType): number {
  return CIRCUIT_COLORS[t] ?? 0x666666;
}
