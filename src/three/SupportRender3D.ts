// Support / hanger 3D renderer. Returns a THREE.Object3D for one
// SupportEntity — a trapeze hanger/channel, a wall bracket with a
// horizontal arm + diagonal stay, a beam clamp, a saddle clip wrapping a
// conduit, …
//
// All hardware is rendered in a dark-grey metallic finish that contrasts
// with containment runs above them. Geometry is centered on the support
// origin; the scene builder applies support.position after any floor-space
// transforms such as CAD-y flipping. Rod / channel lengths are derived from
// the support's elevation and rodLength fields.

import * as THREE from 'three';
import type { SupportEntity } from '../types';
import { detailBoxes, finiteDimension, solidBox, type DetailBox } from './ContainmentGeometry';

export interface SupportRenderOpts {
  /** Bottom-of-containment Z used as anchor for the support top. Default 2400. */
  containmentBottomZ?: number;
  /** Parent containment width in mm, used to keep hanger rods clear of side faces. */
  containmentWidth?: number;
  /** Hide vertical hanger rods for generated route supports in walkthrough views. */
  hideHangerRods?: boolean;
}

const HARDWARE_COLOR = 0x60656b;
const HARDWARE_DARK = 0x3a3d42;
const MIN_SIDE_CLEARANCE_MM = 180;
const COMPACT_ROUTE_SIDE_CLEARANCE_MM = 60;

/** A folded 41 mm channel with a real open slot and perforated back. */
function strutChannel(length: number, mat: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = 'slotted-strut-channel';
  group.userData.supportPart = 'support-channel';
  const parts: DetailBox[] = [];
  for (const side of [-1, 1]) {
    parts.push({ x: 0, y: side * 19, z: 0, length, width: 3, height: 41 });
    parts.push({ x: 0, y: side * 14.5, z: 19, length, width: 9, height: 3 });
    parts.push({ x: 0, y: side * 13.75, z: -19, length, width: 13.5, height: 3 });
    parts.push({ x: 0, y: side * 10.75, z: 15.5, length, width: 2.5, height: 7 });
  }
  const count = Math.max(1, Math.min(100, Math.ceil(length / 50)));
  const pitch = length / count;
  const slot = Math.min(24, pitch * 0.55);
  for (let k = 0; k <= count; k++) {
    const bridge = k === 0 || k === count ? (pitch - slot) / 2 : pitch - slot;
    const x = k === 0 ? -length / 2 + bridge / 2
      : k === count ? length / 2 - bridge / 2 : -length / 2 + k * pitch;
    parts.push({ x, y: 0, z: -19, length: bridge, width: 14, height: 3 });
  }
  const mesh = detailBoxes(parts, mat, 'formed-channel-sheet');
  if (mesh) group.add(mesh);
  return group;
}

function addHexFixing(group: THREE.Group, x: number, y: number, z: number, mat: THREE.MeshStandardMaterial, axis: 'x' | 'z' = 'z'): void {
  const hardware = new THREE.Group();
  hardware.name = 'washer-and-hex-nut';
  hardware.userData.supportPart = 'fixing';
  const washer = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 2, 12), mat);
  washer.rotation.x = Math.PI / 2;
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 7, 6), mat);
  nut.rotation.x = Math.PI / 2;
  nut.position.z = 4;
  hardware.add(washer, nut);
  if (axis === 'x') hardware.rotation.y = Math.PI / 2;
  hardware.position.set(x, y, z);
  group.add(hardware);
}

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

function makeMat(color = HARDWARE_COLOR): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.85,
    roughness: 0.35,
  });
}

function containmentSideClearance(width?: number): number {
  const w = width && Number.isFinite(width) ? Math.max(0, width) : 0;
  return Math.max(MIN_SIDE_CLEARANCE_MM, w * 0.25);
}

function hangerSpan(s: SupportEntity, containmentWidth?: number, fallback = 600): number {
  const configured = finiteDimension(s.channelLength, 0, 0);
  if (containmentWidth && containmentWidth > 0) {
    return Math.max(
      configured,
      containmentWidth + containmentSideClearance(containmentWidth) * 2,
    );
  }
  return configured > 0 ? configured : fallback;
}

function compactRouteHangerSpan(
  s: SupportEntity,
  containmentWidth?: number,
  fallback = 600,
): number {
  if (containmentWidth && containmentWidth > 0) {
    return containmentWidth + COMPACT_ROUTE_SIDE_CLEARANCE_MM * 2;
  }
  const configured = finiteDimension(s.channelLength, 0, 0);
  return configured > 0 ? configured : fallback;
}

function bracketArmLength(s: SupportEntity, containmentWidth?: number, fallback = 400): number {
  const configured = finiteDimension(s.channelLength, 0, 0);
  if (containmentWidth && containmentWidth > 0) {
    return Math.max(
      configured,
      containmentWidth + containmentSideClearance(containmentWidth),
    );
  }
  return configured > 0 ? configured : fallback;
}

// ---------- Builders --------------------------------------------------------

function buildTrapezeHanger(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
  containmentWidth?: number,
  hideRods = false,
): THREE.Group {
  const grp = new THREE.Group();
  const span = hideRods || s.autoGenerated
    ? compactRouteHangerSpan(s, containmentWidth)
    : hangerSpan(s, containmentWidth);
  const rodLen = finiteDimension(s.rodLength, 600, 50);
  const rodRadius = 5;
  const channelThk = 40;

  if (!hideRods) {
    // Two vertical rods (left/right). They drop from the structure (topZ +
    // rodLen) to the channel centre at topZ.
    for (const sx of [-1, 1]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(rodRadius, rodRadius, rodLen + 52, 10),
        mat,
      );
      rod.position.set((sx * span) / 2, 0, topZ + (rodLen - 52) / 2);
      rod.userData.supportPart = 'hanger-rod';
      // Cylinder axis is +Y by default; we want it vertical (+Z).
      rod.rotation.x = Math.PI / 2;
      rod.castShadow = true;
      grp.add(rod);
      const x = sx * span / 2;
      addHexFixing(grp, x, 0, topZ - 47, mat);
      addHexFixing(grp, x, 0, topZ + 2, mat);
      const anchor = solidBox(65, 65, 5, x, 0, topZ + rodLen - 3, mat, 'ceiling-anchor-plate');
      anchor.userData.supportPart = 'ceiling-anchor';
      grp.add(anchor);
      addHexFixing(grp, x, 0, topZ + rodLen - 10, mat);
    }
  }

  // Horizontal channel below containment
  const chan = strutChannel(span, mat);
  chan.position.set(0, 0, topZ - 20.5);
  grp.add(chan);
  return grp;
}

function buildWallBracket(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
  containmentWidth?: number,
): THREE.Group {
  const grp = new THREE.Group();
  const armLen = bracketArmLength(s, containmentWidth);
  const armThk = 41;
  const wallX = -armLen / 2;
  // Horizontal arm. The local origin is the containment centreline, so
  // the arm sits under the tray instead of starting from its centre.
  const arm = strutChannel(armLen, mat);
  arm.position.set(0, 0, topZ - armThk / 2);
  arm.castShadow = true;
  grp.add(arm);
  // Wall plate at the side/end of the bracket.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(8, 80, 220), mat);
  plate.position.set(wallX - 4, 0, topZ - 100);
  plate.castShadow = true;
  grp.add(plate);
  // Diagonal stay — from base of plate to underside of arm.
  const start = new THREE.Vector3(wallX + 4, 0, topZ - 182);
  const end = new THREE.Vector3(armLen / 2 - 35, 0, topZ - armThk);
  const direction = end.clone().sub(start);
  const stayGeom = new THREE.BoxGeometry(direction.length(), 28, 8);
  const stay = new THREE.Mesh(stayGeom, mat);
  stay.position.copy(start.add(end).multiplyScalar(0.5));
  stay.rotation.y = -Math.atan2(direction.z, direction.x);
  stay.name = 'bracket-diagonal-stay';
  grp.add(stay);
  for (const y of [-23, 23]) for (const z of [topZ - 18, topZ - 175]) addHexFixing(grp, wallX + 2, y, z, mat, 'x');
  return grp;
}

function buildCantileverArm(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
  containmentWidth?: number,
): THREE.Group {
  // Same as wall bracket but with a longer arm and beefier stay.
  const grp = buildWallBracket(s, topZ, mat, containmentWidth);
  return grp;
}

function buildBeamClamp(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  // Clamp body — sits on top of an I-beam. We render only the clamp
  // hardware (no beam) since the beam is structural and not modelled.
  const body = new THREE.Mesh(new THREE.BoxGeometry(80, 80, 30), mat);
  body.position.set(0, 0, topZ + 15);
  body.castShadow = true;
  grp.add(body);
  // Two side jaws gripping the flange
  for (const sy of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 50), mat);
    jaw.position.set(0, sy * 36, topZ - 10);
    grp.add(jaw);
  }
  // Drop rod from clamp
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 80, 8),
    mat,
  );
  rod.rotation.x = Math.PI / 2;
  rod.position.set(0, 0, topZ - 40);
  grp.add(rod);
  return grp;
}

function buildSaddleClip(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  // A small clip wrapping around a conduit. Approximate as a half-torus
  // facing up + a base plate.
  const baseplate = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 4), mat);
  baseplate.position.set(0, 0, topZ - 2);
  grp.add(baseplate);
  const halfRing = new THREE.Mesh(
    new THREE.TorusGeometry(20, 3, 6, 16, Math.PI),
    mat,
  );
  halfRing.rotation.x = Math.PI / 2;
  halfRing.position.set(0, 0, topZ);
  grp.add(halfRing);
  return grp;
}

function buildMultiSaddle(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const span = s.channelLength ?? 300;
  const baseplate = new THREE.Mesh(
    new THREE.BoxGeometry(span, 18, 4),
    mat,
  );
  baseplate.position.set(0, 0, topZ - 2);
  grp.add(baseplate);
  // 3 small clips
  for (let k = 0; k < 3; k++) {
    const x = -span / 2 + ((k + 0.5) * span) / 3;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(15, 2, 6, 12, Math.PI),
      mat,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0, topZ);
    grp.add(ring);
  }
  return grp;
}

function buildChannelBracket(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const len = finiteDimension(s.channelLength, 500, 50);
  const channel = strutChannel(len, mat);
  channel.position.set(0, 0, topZ - 20.5);
  grp.add(channel);
  return grp;
}

function buildUnistrutFrame(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
  containmentWidth?: number,
  hideVerticals = false,
): THREE.Group {
  const grp = new THREE.Group();
  const span = hideVerticals || s.autoGenerated
    ? compactRouteHangerSpan(s, containmentWidth, 800)
    : hangerSpan(s, containmentWidth, 800);
  const verticalLen = finiteDimension(s.rodLength, 1500, 50);
  if (!hideVerticals) {
    // Two verticals
    for (const sx of [-1, 1]) {
      const v = strutChannel(verticalLen, mat);
      v.rotation.y = Math.PI / 2;
      v.position.set((sx * span) / 2, 0, topZ - verticalLen / 2);
      v.userData.supportPart = 'hanger-rod';
      v.castShadow = true;
      grp.add(v);
      grp.add(solidBox(110, 110, 6, sx * span / 2, 0, topZ - verticalLen + 3, mat, 'frame-foot-plate'));
      for (const y of [-34, 34]) addHexFixing(grp, sx * span / 2, y, topZ - verticalLen + 7, mat);
    }
  }
  // Horizontal cross-piece
  const horiz = strutChannel(span + 41, mat);
  horiz.position.set(0, 0, topZ - 20.5);
  grp.add(horiz);
  return grp;
}

function buildFloorStand(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  // A simple floor-standing post with a saddle on top.
  const postLen = Math.max(1, topZ - 8);
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, postLen),
    mat,
  );
  post.position.set(0, 0, postLen / 2 + 8);
  post.castShadow = true;
  grp.add(post);
  // Small base plate on the floor
  const base = new THREE.Mesh(new THREE.BoxGeometry(150, 150, 8), makeMat(HARDWARE_DARK));
  base.position.set(0, 0, 4);
  base.castShadow = true;
  grp.add(base);
  for (const x of [-52, 52]) for (const y of [-52, 52]) addHexFixing(grp, x, y, 9, mat);
  return grp;
}

function buildAFrame(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const span = finiteDimension(s.channelLength, 800, 50);
  const apexZ = topZ;
  const baseZ = 0;
  // Two slanted legs forming an A
  for (const sx of [-1, 1]) {
    const len = Math.hypot(span / 2, apexZ);
    const angle = Math.atan2(apexZ, span / 2);
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(len, 41, 41),
      mat,
    );
    leg.position.set((sx * span) / 4, 0, (apexZ + baseZ) / 2);
    leg.rotation.y = sx > 0 ? -angle : angle;
    grp.add(leg);
  }
  // Top channel
  const top = new THREE.Mesh(new THREE.BoxGeometry(span * 0.3, 41, 41), mat);
  top.position.set(0, 0, apexZ);
  grp.add(top);
  return grp;
}

// ---------- Public entry point ----------------------------------------------

/**
 * Render a support as a 3D Object3D centered at local XY origin. The caller
 * positions the returned object at support.position after applying the same
 * coordinate transform used for the parent containment.
 */
export function renderSupport3D(
  support: SupportEntity,
  opts: SupportRenderOpts = {},
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `support:${support.id}`;
  root.userData.autoGenerated = support.autoGenerated === true;

  const mat = makeMat();
  // Z elevation of the top of the support (= bottom of containment).
  const topZ = Number.isFinite(support.elevation) ? support.elevation!
    : Number.isFinite(opts.containmentBottomZ) ? opts.containmentBottomZ! : 2400;

  let body: THREE.Group;
  switch (support.supportKind) {
    case 'trapeze-hanger':
      body = buildTrapezeHanger(
        support,
        topZ,
        mat,
        opts.containmentWidth,
        opts.hideHangerRods,
      );
      break;
    case 'wall-bracket':
      body = buildWallBracket(support, topZ, mat, opts.containmentWidth);
      break;
    case 'cantilever-arm':
      body = buildCantileverArm(support, topZ, mat, opts.containmentWidth);
      break;
    case 'beam-clamp':
      body = buildBeamClamp(support, topZ, mat);
      break;
    case 'saddle-clip':
      body = buildSaddleClip(support, topZ, mat);
      break;
    case 'multi-saddle':
      body = buildMultiSaddle(support, topZ, mat);
      break;
    case 'channel-bracket':
      body = buildChannelBracket(support, topZ, mat);
      break;
    case 'unistrut-frame':
      body = buildUnistrutFrame(
        support,
        topZ,
        mat,
        opts.containmentWidth,
        opts.hideHangerRods,
      );
      break;
    case 'floor-stand':
      body = buildFloorStand(support, topZ, mat);
      break;
    case 'a-frame':
      body = buildAFrame(support, topZ, mat);
      break;
    case 'ceiling-bracket':
    default:
      body = buildChannelBracket(support, topZ, mat);
      break;
  }

  body.rotation.z = Number.isFinite(support.rotation) ? support.rotation : 0;
  root.add(body);
  tagPicking(root, support.id);
  return root;
}

/**
 * Snapshot containment bounds once after both groups share the same world
 * transform. The returned predicate checks the physical rod against actual
 * metal surfaces (including instanced sections), not a polyline's large AABB.
 * It does not mutate or delete the support record. Automatic placements at
 * crossings can be omitted by the scene builder; manual clashes stay visible.
 */
export function createSupportClashTester(containments: THREE.Object3D[]): (support: THREE.Object3D) => boolean {
  const candidates = containments.map((object) => {
    object.updateWorldMatrix(true, true);
    return { object, bounds: new THREE.Box3().setFromObject(object) };
  });
  return (support) => {
    support.updateWorldMatrix(true, true);
    let clash = false;
    support.traverse((rod) => {
      if (clash || rod.userData.supportPart !== 'hanger-rod') return;
      const bounds = new THREE.Box3().setFromObject(rod);
      const nearby = candidates.filter((candidate) => candidate.bounds.intersectsBox(bounds));
      if (!nearby.length) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const halfX = (bounds.max.x - bounds.min.x) * 0.4;
      const halfY = (bounds.max.y - bounds.min.y) * 0.4;
      // Start above the washer/channel connection: that intentional contact
      // is support bearing, whereas any higher containment strike is a clash.
      const startZ = bounds.min.z + 55;
      const distance = bounds.max.z - startZ;
      if (distance <= 0) return;
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, distance);
      for (const [dx, dy] of [[0, 0], [-halfX, 0], [halfX, 0], [0, -halfY], [0, halfY]]) {
        ray.ray.origin.set(center.x + dx, center.y + dy, startZ);
        if (nearby.some(({ object }) => ray.intersectObject(object, true).length > 0)) {
          clash = true;
          return;
        }
      }
    });
    return clash;
  };
}

/** Convenience for a single support. Prefer the factory for an entire floor. */
export function supportHasContainmentClash(support: THREE.Object3D, containments: THREE.Object3D[]): boolean {
  return createSupportClashTester(containments)(support);
}
