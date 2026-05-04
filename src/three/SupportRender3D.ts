// Support / hanger 3D renderer. Returns a THREE.Object3D for one
// SupportEntity — a trapeze hanger with two rods + a horizontal channel,
// a wall bracket with a horizontal arm + diagonal stay, a beam clamp, a
// saddle clip wrapping a conduit, …
//
// All hardware is rendered in a dark-grey metallic finish that contrasts
// with containment runs above them. The caller positions the returned
// object using support.position (XY) and a Z baseline (typically the
// floor's FFL); rod / channel lengths are derived from the support's
// elevation and rodLength fields.

import * as THREE from 'three';
import type { SupportEntity } from '../types';

export interface SupportRenderOpts {
  /** Bottom-of-containment Z used as anchor for the support top. Default 2400. */
  containmentBottomZ?: number;
}

const HARDWARE_COLOR = 0x60656b;
const HARDWARE_DARK = 0x3a3d42;

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

// ---------- Builders --------------------------------------------------------

function buildTrapezeHanger(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const span = s.channelLength ?? 600;
  const rodLen = s.rodLength ?? Math.max(50, topZ - (s.elevation ?? topZ));
  const rodRadius = 5;
  const channelThk = 40;

  // Two vertical rods (left/right). They drop from the structure (topZ +
  // rodLen) to the channel centre at topZ.
  for (const sx of [-1, 1]) {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(rodRadius, rodRadius, rodLen, 8),
      mat,
    );
    rod.position.set((sx * span) / 2, 0, topZ + rodLen / 2 - channelThk);
    // Cylinder axis is +Y by default; we want it vertical (+Z).
    rod.rotation.x = Math.PI / 2;
    rod.castShadow = true;
    grp.add(rod);
  }
  // Horizontal channel below containment
  const chan = new THREE.Mesh(
    new THREE.BoxGeometry(span, 41, channelThk),
    mat,
  );
  chan.position.set(0, 0, topZ - channelThk / 2);
  chan.castShadow = true;
  chan.receiveShadow = true;
  grp.add(chan);
  return grp;
}

function buildWallBracket(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const armLen = s.channelLength ?? 400;
  const armThk = 40;
  const stayLen = armLen * 0.85;
  // Horizontal arm — extends in +X.
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(armLen, 41, armThk),
    mat,
  );
  arm.position.set(armLen / 2, 0, topZ - armThk / 2);
  arm.castShadow = true;
  grp.add(arm);
  // Wall plate at -X end.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(8, 80, 120), mat);
  plate.position.set(0, 0, topZ - 60);
  plate.castShadow = true;
  grp.add(plate);
  // Diagonal stay — from base of plate to underside of arm.
  const stayGeom = new THREE.BoxGeometry(stayLen, 25, 6);
  const stay = new THREE.Mesh(stayGeom, mat);
  // Position at 45° from wall to underside of arm.
  const angle = Math.atan2(armThk + 60, armLen);
  stay.position.set(armLen / 2 - 20, 0, topZ - armThk - 30);
  stay.rotation.y = -angle;
  grp.add(stay);
  return grp;
}

function buildCantileverArm(
  s: SupportEntity,
  topZ: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  // Same as wall bracket but with a longer arm and beefier stay.
  const grp = buildWallBracket(s, topZ, mat);
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
): THREE.Group {
  const grp = new THREE.Group();
  const span = s.channelLength ?? 800;
  const verticalLen = s.rodLength ?? 1500;
  // Two verticals
  for (const sx of [-1, 1]) {
    const v = new THREE.Mesh(
      new THREE.BoxGeometry(41, 41, verticalLen),
      mat,
    );
    v.position.set((sx * span) / 2, 0, topZ - verticalLen / 2);
    v.castShadow = true;
    grp.add(v);
  }
  // Horizontal cross-piece
  const horiz = new THREE.Mesh(new THREE.BoxGeometry(span + 41, 41, 41), mat);
  horiz.position.set(0, 0, topZ - 20);
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
 * Render a support as a 3D Object3D. The returned object is positioned
 * at support.position (XY) with z=0. Hardware extends upward to the
 * containment underside so it visually carries the run.
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
      body = buildTrapezeHanger(support, topZ, mat);
      break;
    case 'wall-bracket':
      body = buildWallBracket(support, topZ, mat);
      break;
    case 'cantilever-arm':
      body = buildCantileverArm(support, topZ, mat);
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
      body = buildUnistrutFrame(support, topZ, mat);
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
  body.position.set(support.position.x, support.position.y, 0);
  root.add(body);
  tagPicking(root, support.id);
  return root;
}
