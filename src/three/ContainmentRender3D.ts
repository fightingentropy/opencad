// Parametric extruded 3D containment renderer.
//
// One ContainmentEntity → one THREE.Object3D (a Group). Horizontal
// containment types use folded sheet, channel and wire cross-sections.
// Explicitly elevated conduit routes become physical tubular runs; plan-only
// route aids remain hidden unless the caller opts in.
//
// Supported containmentTypes: tray, ladder, basket, trunking, conduit,
// duct, busbar. Sub-types apply visual variations (perforated tray,
// heavy-duty ladder, sandwich busbar, …).

import * as THREE from 'three';
import type {
  ContainmentEntity,
  ContainmentType,
  ContainmentMaterial,
} from '../types';
import type { SystemId } from '../models/site';
import { defaultElevation } from './elevations';
import type { Floor } from '../models/site';
import { detailBoxes, finiteDimension, joinedProfileGeometry, joinedRouteFrames, roundedRoute, solidBox, type DetailBox } from './ContainmentGeometry';

// ---------- Material palette -------------------------------------------------

export interface MaterialPalette {
  // Per-system colour overrides (keyed by SystemId)
  systems?: Record<SystemId, string>;
  // Per-material physical look (galvanised steel vs aluminium etc.)
  materials?: Partial<Record<ContainmentMaterial, string>>;
}

// Default colour per containment type — used when no system colour is
// supplied. These match the panel-mode look in Panel3D.tsx so a project
// switching between scenes reads consistently.
const DEFAULT_TYPE_COLOR: Record<ContainmentType, number> = {
  tray: 0xb8bcc2,
  ladder: 0xa6acb4,
  basket: 0xc2c6cc,
  trunking: 0xc2c6cc,
  conduit: 0x9aa0a8,
  duct: 0x6c7480,
  busbar: 0xc4a86b,
};

// Material physical look per containment material code.
const MATERIAL_LOOK: Record<
  ContainmentMaterial,
  { color: number; metalness: number; roughness: number }
> = {
  'galvanised-steel': { color: 0xc2c6cc, metalness: 0.85, roughness: 0.35 },
  'pre-galvanised-steel': { color: 0xb8bcc2, metalness: 0.8, roughness: 0.4 },
  'hot-dip-galvanised': { color: 0xa6acb4, metalness: 0.7, roughness: 0.45 },
  'stainless-304': { color: 0xd6dadf, metalness: 0.95, roughness: 0.2 },
  'stainless-316': { color: 0xdde0e4, metalness: 0.95, roughness: 0.2 },
  'stainless-316L': { color: 0xdde0e4, metalness: 0.95, roughness: 0.18 },
  aluminium: { color: 0xcfd2d6, metalness: 0.9, roughness: 0.3 },
  pvc: { color: 0xeaeaea, metalness: 0.0, roughness: 0.85 },
  lsoh: { color: 0xe0e0e0, metalness: 0.0, roughness: 0.9 },
  grp: { color: 0x77808a, metalness: 0.05, roughness: 0.85 },
  frp: { color: 0x6c757a, metalness: 0.05, roughness: 0.88 },
  copper: { color: 0xb87333, metalness: 0.95, roughness: 0.25 },
  other: { color: 0xb0b4ba, metalness: 0.4, roughness: 0.55 },
};

// ---------- Public render options -------------------------------------------

export interface RenderOpts {
  /** Material palette overrides (per-system colour, per-material look). */
  materials?: MaterialPalette;
  /** Whether to colour cables-in-tray as an overlay. */
  showFill?: boolean;
  /** Fill ratio 0..1 — when > 0.45 the run colours red as an over-fill warning. */
  fillPct?: number;
  /** SystemId of the run (for colour lookup). */
  systemId?: SystemId;
  /** Floor context for elevation calculation. */
  floor?: Floor;
  /** Force a specific Z elevation (mm). Overrides containment.elevation. */
  forceElevation?: number;
  /** Flip Y — pass `H` (sheet height in mm) when rendering CAD-y entities. */
  flipY?: number;
  /** Construction detail budget. Overview keeps the same physical envelope. */
  detail?: 'overview' | 'detailed';
  /** Keep lids on trunking and covered tray. False exposes internal sections. */
  showCovers?: boolean;
  /** Render conduit even when its placement uses an inferred elevation. */
  renderConduit?: boolean;
}

// ---------- Helpers ----------------------------------------------------------

const OVERFILL_RED = 0xc62d2d;

function pickColor(
  c: ContainmentEntity,
  opts: RenderOpts,
): { color: number; metalness: number; roughness: number } {
  // 1) per-entity hex override always wins
  if (c.color) {
    return { color: new THREE.Color(c.color).getHex(), metalness: 0.4, roughness: 0.55 };
  }
  // 2) over-fill warning
  if (opts.showFill && (opts.fillPct ?? 0) > 0.45) {
    return { color: OVERFILL_RED, metalness: 0.1, roughness: 0.7 };
  }
  // 3) system-coloured palette
  if (opts.systemId && opts.materials?.systems?.[opts.systemId]) {
    return {
      color: new THREE.Color(opts.materials.systems[opts.systemId]).getHex(),
      metalness: 0.4,
      roughness: 0.5,
    };
  }
  // 4) per-material physical look
  if (c.material) {
    const m = opts.materials?.materials?.[c.material];
    if (m) return { color: new THREE.Color(m).getHex(), metalness: 0.4, roughness: 0.5 };
    return MATERIAL_LOOK[c.material];
  }
  // 5) fall back to per-type default
  return {
    color: DEFAULT_TYPE_COLOR[c.containmentType] ?? 0xb0b4ba,
    metalness: 0.4,
    roughness: 0.5,
  };
}

function makeMat(spec: { color: number; metalness: number; roughness: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
  });
}

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

// Iterate polyline segments, returning (centerX, centerY, length, heading).
interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  len: number;
  heading: number;
}

function* iterSegments(points: { x: number; y: number }[], flipY?: number): Generator<Segment> {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ay = flipY != null ? flipY - a.y : a.y;
    const by = flipY != null ? flipY - b.y : b.y;
    const dx = b.x - a.x;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1e-3) continue;
    yield {
      ax: a.x,
      ay,
      bx: b.x,
      by,
      cx: (a.x + b.x) / 2,
      cy: (ay + by) / 2,
      len,
      heading: Math.atan2(dy, dx),
    };
  }
}

// ---------- Cross-section builders ------------------------------------------

function addBoxes(group: THREE.Group, parts: DetailBox[], mat: THREE.Material, name: string): void {
  const instances = detailBoxes(parts, mat, name);
  if (instances) group.add(instances);
}

function addCover(group: THREE.Group, length: number, width: number, height: number, mat: THREE.Material, visible: boolean): void {
  const cover = new THREE.Group();
  cover.name = 'removable-cover';
  cover.userData.containmentCover = true;
  cover.visible = visible;
  // Folded lid with down-turned edges, separate from the open body.
  cover.add(solidBox(length, width + 4, 2, 0, 0, height / 2 + 1, mat));
  for (const side of [-1, 1]) {
    cover.add(solidBox(length, 2, 9, 0, side * (width / 2 + 1), height / 2 - 3.5, mat));
  }
  group.add(cover);
}

function joinedFrames(containment: ContainmentEntity, width: number, flipY?: number): ReturnType<typeof joinedRouteFrames> {
  const curve = roundedRoute(containment.points, 0, width * 1.5, flipY);
  return curve ? joinedRouteFrames(curve.getPoints(20)) : [];
}

function addProfile(
  group: THREE.Group,
  frames: ReturnType<typeof joinedRouteFrames>,
  profile: number[][],
  mat: THREE.Material,
  name: string,
): void {
  const mesh = new THREE.Mesh(joinedProfileGeometry(frames, profile.map(([y, z]) => new THREE.Vector2(y, z))), mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addPerforatedRouteBottom(
  wrap: THREE.Group,
  containment: ContainmentEntity,
  frames: ReturnType<typeof joinedRouteFrames>,
  width: number,
  thickness: number,
  mat: THREE.Material,
  flipY?: number,
): void {
  const curve = roundedRoute(containment.points, 0, width * 1.5, flipY);
  if (!curve || frames.length < 2) return;
  const edge = (offset: number): THREE.Vector2[] => frames.map(({ point, normal }) => point.clone().addScaledVector(normal, offset));
  const outline = [...edge(width / 2), ...edge(-width / 2).reverse()];
  const shape = new THREE.Shape(outline);
  const rows = Math.max(1, Math.min(8, Math.floor(width / 65)));
  const pitchY = width / rows;
  const slotWidth = Math.min(12, pitchY * 0.23);
  // Slots only occupy the straight sections; bend plates remain continuous.
  for (const leg of curve.curves) {
    if (!(leg instanceof THREE.LineCurve3)) continue;
    const length = leg.getLength();
    if (length <= 70) continue;
    const count = Math.max(1, Math.min(100, Math.floor(length / 75)));
    const pitchX = length / count;
    const slotLength = Math.min(32, pitchX * 0.45);
    const tangent = leg.getTangent(0);
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    for (let row = 0; row < rows; row++) for (let i = 0; i < count; i++) {
      const center = leg.getPoint((i + 0.5) / count);
      const lateral = -width / 2 + (row + 0.5) * pitchY;
      const hole = new THREE.Path();
      for (const [j, [dx, dy]] of [[-1, -1], [1, -1], [1, 1], [-1, 1]].entries()) {
        const x = center.x + tangent.x * dx * slotLength / 2 + normal.x * (lateral + dy * slotWidth / 2);
        const y = center.y + tangent.y * dx * slotLength / 2 + normal.y * (lateral + dy * slotWidth / 2);
        if (j === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
  }
  const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 }), mat);
  bottom.name = 'perforated-tray-bottom';
  bottom.castShadow = true;
  bottom.receiveShadow = true;
  wrap.add(bottom);
}

/** One open section follows the bend, with no overlapping boxes or end walls. */
function buildJoinedTrough(containment: ContainmentEntity, width: number, height: number, mat: THREE.MeshStandardMaterial, opts: RenderOpts): THREE.Group {
  const wrap = new THREE.Group();
  const frames = joinedFrames(containment, width, opts.flipY);
  const tk = Math.min(2, height / 8, width / 12);
  const half = width / 2;
  const lip = Math.min(12, width * 0.1);
  const perforated = containment.containmentType === 'tray' && opts.detail !== 'overview'
    && containment.subType !== 'solid-bottom' && containment.subType !== 'return-flange' && width > 35;
  if (perforated) {
    addPerforatedRouteBottom(wrap, containment, frames, width, tk, mat, opts.flipY);
    for (const side of [-1, 1]) addProfile(wrap, frames, [
      [half, tk], [half, height], [half - lip, height],
      [half - lip, height - tk], [half - tk, height - tk], [half - tk, tk],
    ].map(([y, z]) => [y * side, z]), mat, 'continuous-tray-rail');
  } else {
    addProfile(wrap, frames, [
      [-half, 0], [half, 0], [half, height], [half - lip, height],
      [half - lip, height - tk], [half - tk, height - tk], [half - tk, tk],
      [-half + tk, tk], [-half + tk, height - tk], [-half + lip, height - tk],
      [-half + lip, height], [-half, height],
    ], mat, 'continuous-open-trough');
  }
  if (containment.containmentType === 'trunking') {
    const count = Math.max(1, Math.min(8, Math.floor(finiteDimension(containment.compartments, 1))));
    for (let i = 1; i < count; i++) {
      const y = -half + width * i / count;
      addProfile(wrap, frames, [[y - 0.75, tk], [y + 0.75, tk], [y + 0.75, height - 6], [y - 0.75, height - 6]], mat, 'segregation-dividers');
    }
    const cover = new THREE.Group();
    cover.name = 'removable-cover';
    cover.userData.containmentCover = true;
    cover.visible = opts.showCovers !== false;
    addProfile(cover, frames, [
      [-half - 2, height - 8], [-half, height - 8], [-half, height],
      [half, height], [half, height - 8], [half + 2, height - 8],
      [half + 2, height + 2], [-half - 2, height + 2],
    ], mat, 'folded-trunking-lid');
    wrap.add(cover);
  }
  return wrap;
}

function buildJoinedBasket(containment: ContainmentEntity, width: number, height: number, mat: THREE.MeshStandardMaterial, opts: RenderOpts): THREE.Group {
  const wrap = new THREE.Group();
  const curve = roundedRoute(containment.points, 0, width * 1.5, opts.flipY);
  if (!curve) return wrap;
  const frames = joinedRouteFrames(curve.getPoints(20));
  const radius = Math.min(2.5, width / 30, height / 10);
  const bottom = radius;
  const top = height - radius;
  const half = width / 2 - radius;
  const longitudinal = Math.max(2, Math.min(14, Math.ceil(width / 50)));
  // Continuous longitudinal wires follow the same section through the bend.
  const wires: [number, number][] = [];
  for (let i = 0; i <= longitudinal; i++) wires.push([-half + i * half * 2 / longitudinal, bottom]);
  for (const side of [-1, 1]) for (const z of [top, height / 2]) wires.push([side * half, z]);
  for (const [y, z] of wires) {
    const profile = Array.from({ length: 8 }, (_, i) => [y + Math.cos(i * Math.PI / 4) * radius, z + Math.sin(i * Math.PI / 4) * radius]);
    addProfile(wrap, frames, profile, mat, 'continuous-basket-wire');
  }
  const count = Math.max(2, Math.min(opts.detail === 'overview' ? 40 : 128, Math.ceil(curve.getLength() / 100)));
  const uprights = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 8), mat, count * 3);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  let index = 0;
  const wire = (a: THREE.Vector3, b: THREE.Vector3): void => {
    const delta = b.clone().sub(a);
    rotation.setFromUnitVectors(axis, delta.clone().normalize());
    matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, new THREE.Vector3(1, delta.length(), 1));
    uprights.setMatrixAt(index++, matrix);
  };
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
    const a = point.clone().addScaledVector(normal, -half).setZ(bottom);
    const b = point.clone().addScaledVector(normal, half).setZ(bottom);
    wire(a, b);
    wire(a, a.clone().setZ(top));
    wire(b, b.clone().setZ(top));
  }
  uprights.name = 'welded-basket-wire';
  uprights.castShadow = true;
  uprights.receiveShadow = true;
  uprights.computeBoundingBox();
  uprights.computeBoundingSphere();
  wrap.add(uprights);
  return wrap;
}

function buildTraySegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, subType: string | undefined, detailed: boolean): THREE.Group {
  const wrap = new THREE.Group();
  const tk = Math.min(2, height / 8, width / 12);
  const floorZ = -height / 2 + tk / 2;
  const perforated = subType !== 'solid-bottom' && subType !== 'return-flange' && detailed && width > 35 && len > 70;
  if (!perforated) {
    wrap.add(solidBox(len, width, tk, 0, 0, floorZ, mat, 'tray-bottom'));
  } else {
    // Open slots are negative space between continuous sheet bridges. This
    // gives true through-holes and shadows without hundreds of CSG meshes.
    const parts: DetailBox[] = [];
    const rows = Math.max(1, Math.min(8, Math.floor(width / 65)));
    const pitchY = width / rows;
    const slotWidth = Math.min(12, pitchY * 0.23);
    const count = Math.max(1, Math.min(100, Math.floor(len / 75)));
    const pitchX = len / count;
    const slotLength = Math.min(32, pitchX * 0.45);
    for (let row = 0; row <= rows; row++) {
      const bandWidth = row === 0 || row === rows ? (pitchY - slotWidth) / 2 : pitchY - slotWidth;
      const y = row === 0 ? -width / 2 + bandWidth / 2
        : row === rows ? width / 2 - bandWidth / 2 : -width / 2 + row * pitchY;
      parts.push({ x: 0, y, z: floorZ, length: len, width: bandWidth, height: tk });
    }
    for (let row = 0; row < rows; row++) {
      const y = -width / 2 + (row + 0.5) * pitchY;
      for (let k = 0; k <= count; k++) {
        const bridgeLength = k === 0 || k === count ? (pitchX - slotLength) / 2 : pitchX - slotLength;
        const x = k === 0 ? -len / 2 + bridgeLength / 2
          : k === count ? len / 2 - bridgeLength / 2 : -len / 2 + k * pitchX;
        parts.push({ x, y, z: floorZ, length: bridgeLength, width: slotWidth, height: tk });
      }
    }
    addBoxes(wrap, parts, mat, 'perforated-tray-bottom');
  }
  const rails: DetailBox[] = [];
  const lipWidth = Math.min(12, width * 0.1);
  for (const side of [-1, 1]) {
    rails.push({ x: 0, y: side * (width / 2 - tk / 2), z: 0, length: len, width: tk, height: height - tk * 2 });
    rails.push({ x: 0, y: side * (width / 2 - lipWidth / 2), z: height / 2 - tk / 2, length: len, width: lipWidth, height: tk });
    if (detailed && height >= 40) {
      // Formed longitudinal bead stiffens the thin side wall.
      rails.push({ x: 0, y: side * (width / 2 + tk / 2), z: -height * 0.14, length: len, width: tk, height: 5 });
    }
  }
  addBoxes(wrap, rails, mat, 'folded-tray-rails');
  return wrap;
}

function buildLadderSegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, subType: string | undefined): THREE.Group {
  const wrap = new THREE.Group();
  const tk = subType === 'heavy-duty-ladder' ? 3 : 2;
  const flange = Math.min(20, width * 0.12);
  const parts: DetailBox[] = [];
  for (const side of [-1, 1]) {
    parts.push({ x: 0, y: side * (width / 2 - tk / 2), z: 0, length: len, width: tk, height });
    for (const top of [-1, 1]) {
      parts.push({ x: 0, y: side * (width / 2 - flange / 2), z: top * (height / 2 - tk / 2), length: len, width: flange, height: tk });
    }
  }
  const count = Math.max(1, Math.min(128, Math.ceil(len / 300)));
  const rungDepth = Math.min(20, height * 0.45);
  const rungWidth = Math.min(35, len / count * 0.65);
  for (let k = 0; k < count; k++) {
    const x = -len / 2 + (k + 0.5) * len / count;
    // A formed rung has a broad cable bearing face and two short webs.
    parts.push({ x, y: 0, z: -height / 2 + rungDepth - tk / 2, length: rungWidth, width: width - tk * 2, height: tk });
    for (const side of [-1, 1]) parts.push({ x: x + side * (rungWidth / 2 - tk / 2), y: 0, z: -height / 2 + rungDepth / 2, length: tk, width: width - tk * 2, height: rungDepth });
  }
  addBoxes(wrap, parts, mat, 'formed-ladder-rails-and-rungs');
  return wrap;
}

function buildBasketSegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, detailed: boolean): THREE.Group {
  const wrap = new THREE.Group();
  const radius = Math.min(2.5, width / 30, height / 10);
  const count = Math.max(2, Math.min(detailed ? 128 : 40, Math.ceil(len / (detailed ? 100 : 250))));
  const longitudinal = Math.max(2, Math.min(14, Math.ceil(width / 50)));
  const instances = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 6), mat, count * 3 + longitudinal + 1 + 4);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  let index = 0;
  function wire(a: THREE.Vector3, b: THREE.Vector3): void {
    const delta = b.clone().sub(a);
    quaternion.setFromUnitVectors(axis, delta.clone().normalize());
    matrix.compose(a.clone().add(b).multiplyScalar(0.5), quaternion, new THREE.Vector3(1, delta.length(), 1));
    instances.setMatrixAt(index++, matrix);
  }
  const bottom = -height / 2 + radius;
  const halfW = width / 2 - radius;
  const top = height / 2 - radius;
  for (let k = 0; k < count; k++) {
    const x = -len / 2 + (k + 0.5) * len / count;
    wire(new THREE.Vector3(x, -halfW, bottom), new THREE.Vector3(x, halfW, bottom));
    for (const side of [-1, 1]) wire(new THREE.Vector3(x, side * halfW, bottom), new THREE.Vector3(x, side * halfW, top));
  }
  for (let k = 0; k <= longitudinal; k++) {
    const y = -halfW + k * halfW * 2 / longitudinal;
    wire(new THREE.Vector3(-len / 2, y, bottom), new THREE.Vector3(len / 2, y, bottom));
  }
  for (const side of [-1, 1]) for (const z of [top, bottom + (top - bottom) * 0.5]) {
    wire(new THREE.Vector3(-len / 2, side * halfW, z), new THREE.Vector3(len / 2, side * halfW, z));
  }
  instances.name = 'welded-basket-wire';
  instances.castShadow = true;
  instances.receiveShadow = true;
  instances.computeBoundingSphere();
  instances.computeBoundingBox();
  wrap.add(instances);
  return wrap;
}

function buildTrunkingSegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, compartments: number | undefined, covers: boolean): THREE.Group {
  const wrap = buildTraySegment(width, height, len, mat, 'solid-bottom', false);
  const parts: DetailBox[] = [];
  const count = Math.max(1, Math.min(8, Math.floor(finiteDimension(compartments, 1))));
  for (let i = 1; i < count; i++) {
    parts.push({ x: 0, y: -width / 2 + width * i / count, z: -3, length: len, width: 1.5, height: Math.max(1, height - 6) });
  }
  addBoxes(wrap, parts, mat, 'segregation-dividers');
  addCover(wrap, len, width, height, mat, covers);
  return wrap;
}

function buildDuctSegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial): THREE.Group {
  const wrap = new THREE.Group();
  const tk = Math.min(8, width * 0.1, height * 0.1);
  const parts: DetailBox[] = [];
  for (const side of [-1, 1]) {
    parts.push({ x: 0, y: 0, z: side * (height / 2 - tk / 2), length: len, width, height: tk });
    parts.push({ x: 0, y: side * (width / 2 - tk / 2), z: 0, length: len, width: tk, height: height - tk * 2 });
  }
  addBoxes(wrap, parts, mat, 'hollow-duct-wall');
  return wrap;
}

function buildBusbarSegment(width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, subType: string | undefined, covers: boolean): THREE.Group {
  const wrap = buildTrunkingSegment(width, height, len, mat, 1, covers);
  const copper = new THREE.MeshStandardMaterial({ color: 0xb97643, metalness: 0.88, roughness: 0.27 });
  const insulator = new THREE.MeshStandardMaterial({ color: 0x30373c, metalness: 0.02, roughness: 0.75 });
  const phases: DetailBox[] = [];
  const conductors = Math.min(5, Math.max(1, Math.floor(width / 14)));
  for (let i = 0; i < conductors; i++) {
    phases.push({ x: 0, y: (i - (conductors - 1) / 2) * width * 0.7 / conductors, z: -height * 0.05, length: len - 2, width: Math.min(6, width / 20), height: height * 0.55 });
  }
  addBoxes(wrap, phases, copper, 'busbar-copper-conductors');
  const blocks: DetailBox[] = [];
  const count = Math.max(1, Math.min(48, Math.ceil(len / 1000)));
  for (let i = 0; i < count; i++) {
    const x = -len / 2 + (i + 0.5) * len / count;
    blocks.push({ x, y: 0, z: -height * 0.35, length: Math.min(45, len / count * 0.5), width: width * 0.8, height: height * 0.15 });
    if (subType === 'plug-in-busbar') blocks.push({ x, y: 0, z: height / 2 + 5, length: Math.min(65, len / count * 0.5), width: width * 0.55, height: 8 });
  }
  addBoxes(wrap, blocks, insulator, 'busbar-insulators-and-tap-offs');
  return wrap;
}

function addSplicePlates(wrap: THREE.Group, width: number, height: number, len: number, mat: THREE.MeshStandardMaterial, detailed: boolean): void {
  if (len < 250 || height < 15) return;
  const plates: DetailBox[] = [];
  const boltPositions: THREE.Vector3[] = [];
  const jointCount = Math.min(24, Math.max(0, Math.floor((len - 250) / 3000)));
  // End connector plates also make short field-cut sections identifiable.
  const positions = [-len / 2 + 85, ...Array.from({ length: jointCount }, (_, k) => -len / 2 + (k + 1) * 3000)];
  for (const x of positions) for (const side of [-1, 1]) {
    plates.push({ x, y: side * (width / 2 + 2), z: 0, length: 140, width: 3, height: height * 0.65 });
    if (detailed) for (const dx of [-43, 43]) for (const dz of [-1, 1]) {
      boltPositions.push(new THREE.Vector3(x + dx, side * (width / 2 + 5), dz * height * 0.19));
    }
  }
  addBoxes(wrap, plates, mat, 'bolted-splice-plates');
  if (!boltPositions.length) return;
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x646d73, metalness: 0.85, roughness: 0.3 });
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(4.5, 4.5, 4, 6), boltMat, boltPositions.length);
  boltPositions.forEach((position, index) => bolts.setMatrixAt(index, new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)));
  bolts.name = 'splice-hex-bolts';
  bolts.castShadow = true;
  bolts.computeBoundingSphere();
  bolts.computeBoundingBox();
  wrap.add(bolts);
}

function buildConduit(containment: ContainmentEntity, opts: RenderOpts, diameter: number, baseZ: number, mat: THREE.MeshStandardMaterial): THREE.Group {
  const wrap = new THREE.Group();
  const radius = diameter / 2;
  const curve = roundedRoute(containment.points, baseZ + radius, diameter * 3, opts.flipY);
  if (!curve) return wrap;
  const steps = Math.max(16, Math.min(512, Math.ceil(curve.getLength() / 100) + containment.points.length * 12));
  const radial = opts.detail === 'overview' ? 8 : 16;
  const shell = new THREE.Mesh(new THREE.TubeGeometry(curve, steps, radius, radial, false), mat);
  shell.name = 'conduit-outer-wall';
  shell.castShadow = true;
  shell.receiveShadow = true;
  wrap.add(shell);
  const innerRadius = Math.max(radius * 0.65, radius - 2);
  const insideMat = mat.clone();
  insideMat.side = THREE.BackSide;
  const inner = new THREE.Mesh(new THREE.TubeGeometry(curve, steps, innerRadius, radial, false), insideMat);
  inner.name = 'conduit-inner-wall';
  wrap.add(inner);
  for (const t of [0, 1]) {
    const rim = new THREE.Mesh(new THREE.RingGeometry(innerRadius, radius, radial), mat);
    rim.position.copy(curve.getPointAt(t));
    const tangent = curve.getTangentAt(t).multiplyScalar(t === 0 ? -1 : 1);
    rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    wrap.add(rim);
  }
  const joints = Math.min(32, Math.floor(curve.getLength() / 3000));
  for (let i = 1; i <= joints; i++) {
    const t = i / (joints + 1);
    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2, radius + 2, Math.min(45, diameter * 1.4), radial, 1, true), mat);
    coupling.name = 'conduit-coupling';
    coupling.position.copy(curve.getPointAt(t));
    coupling.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t));
    wrap.add(coupling);
  }
  return wrap;
}

// ---------- Public entry point ----------------------------------------------

/** Every returned group exclusively owns its geometries/materials. */
export function renderContainment3D(containment: ContainmentEntity, opts: RenderOpts = {}): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `containment:${containment.id}`;
  tagPicking(root, containment.id);
  if (!containment.points || containment.points.length < 2) return root;
  const w = finiteDimension(containment.width, 100, 8);
  const h = finiteDimension(containment.height, 50, 8);
  const baseZ = Number.isFinite(opts.forceElevation) ? opts.forceElevation!
    : defaultElevation(containment, opts.floor);
  if (!Number.isFinite(baseZ)) return root;
  const segments = [...iterSegments(containment.points, opts.flipY)];
  if (!segments.length) return root;
  if (containment.containmentType === 'conduit' && !opts.renderConduit
    && !Number.isFinite(containment.elevation) && !Number.isFinite(opts.forceElevation)) return root;
  const colorSpec = pickColor(containment, opts);
  const baseMat = makeMat(colorSpec);
  if (containment.containmentType === 'conduit') {
    root.add(buildConduit(containment, opts, w, baseZ, baseMat));
  } else if (containment.containmentType === 'trunking'
    || (segments.length > 1 && (containment.containmentType === 'tray' || containment.containmentType === 'basket'))) {
    const body = containment.containmentType === 'basket'
      ? buildJoinedBasket(containment, w, h, baseMat, opts)
      : buildJoinedTrough(containment, w, h, baseMat, opts);
    body.name = 'containment-section';
    body.position.z = baseZ;
    root.add(body);
  } else {
    const detailed = opts.detail !== 'overview';
    for (const seg of segments) {
      let body: THREE.Group;
      switch (containment.containmentType) {
        case 'tray':
          body = buildTraySegment(w, h, seg.len, baseMat, containment.subType, detailed);
          break;
        case 'ladder':
          body = buildLadderSegment(w, h, seg.len, baseMat, containment.subType);
          break;
        case 'basket':
          body = buildBasketSegment(w, h, seg.len, baseMat, detailed);
          break;
        case 'duct':
          body = buildDuctSegment(w, h, seg.len, baseMat);
          break;
        case 'busbar':
          body = buildBusbarSegment(w, h, seg.len, baseMat, containment.subType, opts.showCovers !== false);
          break;
        default: continue;
      }
      if (containment.containmentType !== 'duct') addSplicePlates(body, w, h, seg.len, baseMat, detailed);
      body.name = 'containment-section';
      body.position.set(seg.cx, seg.cy, baseZ + h / 2);
      body.rotation.z = seg.heading;
      root.add(body);
    }
  }
  tagPicking(root, containment.id);
  return root;
}

/** Toggle tagged removable lids without rebuilding geometry or losing picking. */
export function setContainmentCoversOpen(object: THREE.Object3D, open: boolean): void {
  object.traverse((child) => {
    if (child.userData.containmentCover) child.visible = !open;
  });
}

export function colourFor(c: ContainmentEntity, opts: RenderOpts = {}): number {
  return pickColor(c, opts).color;
}
