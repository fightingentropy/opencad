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
  const configured = s.channelLength ?? 0;
  if (containmentWidth && containmentWidth > 0) {
    return Math.max(
      configured,
      containmentWidth + containmentSideClearance(containmentWidth) * 2,
    );
  }
  return configured > 0 ? configured : fallback;
}

function bracketArmLength(s: SupportEntity, containmentWidth?: number, fallback = 400): number {
  const configured = s.channelLength ?? 0;
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
  const span = hangerSpan(s, containmentWidth);
  const rodLen = s.rodLength ?? Math.max(50, topZ - (s.elevation ?? topZ));
  const rodRadius = 5;
  const channelThk = 40;

  if (!hideRods) {
    // Two vertical rods (left/right). They drop from the structure (topZ +
    // rodLen) to the channel centre at topZ.
    for (const sx of [-1, 1]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(rodRadius, rodRadius, rodLen, 8),
        mat,
      );
      rod.position.set((sx * span) / 2, 0, topZ + rodLen / 2 - channelThk);
      rod.userData.supportPart = 'hanger-rod';
      // Cylinder axis is +Y by default; we want it vertical (+Z).
      rod.rotation.x = Math.PI / 2;
      rod.castShadow = true;
      grp.add(rod);
    }
  }

  // Horizontal channel below containment
  const chan = new THREE.Mesh(
    new THREE.BoxGeometry(span, 41, channelThk),
    mat,
  );
  chan.position.set(0, 0, topZ - channelThk / 2);
  chan.userData.supportPart = 'support-channel';
  chan.castShadow = true;
  chan.receiveShadow = true;
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
  const armThk = 40;
  const stayLen = armLen * 0.85;
  const wallX = -armLen / 2;
  // Horizontal arm. The local origin is the containment centreline, so
  // the arm sits under the tray instead of starting from its centre.
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(armLen, 41, armThk),
    mat,
  );
  arm.position.set(0, 0, topZ - armThk / 2);
  arm.castShadow = true;
  grp.add(arm);
  // Wall plate at the side/end of the bracket.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(8, 80, 120), mat);
  plate.position.set(wallX, 0, topZ - 60);
  plate.castShadow = true;
  grp.add(plate);
  // Diagonal stay — from base of plate to underside of arm.
  const stayGeom = new THREE.BoxGeometry(stayLen, 25, 6);
  const stay = new THREE.Mesh(stayGeom, mat);
  const angle = Math.atan2(armThk + 60, armLen);
  stay.position.set(wallX + stayLen / 2 - 20, 0, topZ - armThk - 30);
  stay.rotation.y = -angle;
  grp.add(stay);
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
  const len = s.channelLength ?? 500;
  const channel = new THREE.Mesh(new THREE.BoxGeometry(len, 41, 41), mat);
  channel.position.set(0, 0, topZ - 20);
  channel.castShadow = true;
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
  const span = hangerSpan(s, containmentWidth, 800);
  const verticalLen = s.rodLength ?? 1500;
  if (!hideVerticals) {
    // Two verticals
    for (const sx of [-1, 1]) {
      const v = new THREE.Mesh(
        new THREE.BoxGeometry(41, 41, verticalLen),
        mat,
      );
      v.position.set((sx * span) / 2, 0, topZ - verticalLen / 2);
      v.userData.supportPart = 'hanger-rod';
      v.castShadow = true;
      grp.add(v);
    }
  }
  // Horizontal cross-piece
  const horiz = new THREE.Mesh(new THREE.BoxGeometry(span + 41, 41, 41), mat);
  horiz.position.set(0, 0, topZ - 20);
  horiz.userData.supportPart = 'support-channel';
  horiz.castShadow = true;
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
  const postLen = topZ;
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, postLen),
    mat,
  );
  post.position.set(0, 0, postLen / 2);
  post.castShadow = true;
  grp.add(post);
  // Small base plate on the floor
  const base = new THREE.Mesh(new THREE.BoxGeometry(150, 150, 8), makeMat(HARDWARE_DARK));
  base.position.set(0, 0, 4);
  base.castShadow = true;
  grp.add(base);
  return grp;
}

function buildAFrame(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const span = s.channelLength ?? 800;
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

  const mat = makeMat();
  // Z elevation of the top of the support (= bottom of containment).
  const topZ = support.elevation ?? opts.containmentBottomZ ?? 2400;

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

  body.rotation.z = support.rotation ?? 0;
  root.add(body);
  tagPicking(root, support.id);
  return root;
}
