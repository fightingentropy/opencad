// Render containment fittings (bends, tees, reducers, end-caps, …) as
// 3D objects. Most fittings are auto-derived from the polyline geometry
// of the parent containment — every direction change becomes a flat
// bend, every junction becomes a tee or cross. The renderer is colour-
// matched to the parent.
//
// Fittings live on the same Z plane as the containment's centre line.
// Geometry is centred on the local origin; the scene builder positions
// the returned object after applying floor-space transforms such as Y flip.

import * as THREE from 'three';
import type { ContainmentEntity, FittingEntity } from '../types';
import { colourFor } from './ContainmentRender3D';
import type { RenderOpts } from './ContainmentRender3D';

export interface FittingRenderOpts extends RenderOpts {
  /** Parent containment — used to size the fitting and pick the colour. */
  parent?: ContainmentEntity;
}

const DEFAULT_RADIUS = 200; // mm — bend radius for flat bends if not set

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

function makeMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.4,
    roughness: 0.5,
  });
}

// Derive width/height: take the fitting's own values if present, else
// fall back to the parent containment's. Default 100 × 50.
function dimsFor(f: FittingEntity, parent?: ContainmentEntity): { w: number; h: number } {
  const w = f.width ?? parent?.width ?? 100;
  const h = f.height ?? parent?.height ?? 50;
  return { w, h };
}

function isOpenContainment(parent?: ContainmentEntity): boolean {
  return (
    parent?.containmentType === 'tray' ||
    parent?.containmentType === 'basket' ||
    parent?.containmentType === 'ladder'
  );
}

function buildSideJoinerPlates(
  parent: ContainmentEntity | undefined,
  width: number,
  height: number,
  mat: THREE.MeshStandardMaterial,
  length: number,
): THREE.Group {
  const grp = new THREE.Group();
  const plateThickness = 5;
  const plateHeight = parent?.containmentType === 'basket'
    ? Math.min(30, height)
    : Math.min(Math.max(24, height * 0.45), height);
  const plateZ = parent?.containmentType === 'basket'
    ? -height / 2 + plateHeight / 2
    : 0;

  for (const sy of [-1, 1]) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(length, plateThickness, plateHeight),
      mat,
    );
    plate.position.set(0, sy * (width / 2 + plateThickness / 2), plateZ);
    plate.castShadow = true;
    plate.receiveShadow = true;
    grp.add(plate);
  }

  return grp;
}

// ---------- Builders --------------------------------------------------------

function buildFlatBend(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  const angle = ((f.angleDeg ?? 90) * Math.PI) / 180;
  const radius = DEFAULT_RADIUS;
  const isConduit = parent?.containmentType === 'conduit';
  // Build a quarter-arc curve in the XY plane, centred on the fitting.
  const pts: THREE.Vector3[] = [];
  const segments = 16;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * angle;
    pts.push(new THREE.Vector3(radius * Math.cos(t) - radius, radius * Math.sin(t), 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
  if (isConduit) {
    const tubeRadius = w / 2;
    const tube = new THREE.TubeGeometry(curve, segments, tubeRadius, 12, false);
    const mesh = new THREE.Mesh(tube, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
  } else {
    // Box-section bend — extrude a rectangular tube along the curve.
    const tube = new THREE.TubeGeometry(curve, segments, Math.max(w, h) / 2, 4, false);
    // Orient the cross-section so the longer side is horizontal — by
    // default TubeGeometry uses a circular cross-section so this is an
    // approximation. Rectangular bends are visually similar at panel
    // overview scale.
    const mesh = new THREE.Mesh(tube, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
  }
  return grp;
}

function buildTee(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  const armLen = Math.max(w, h) * 1.5;
  // Three radial extrusions at 0°, 90°, 180°.
  const angles = [0, Math.PI / 2, Math.PI];
  for (const a of angles) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, w, h), mat);
    arm.position.set((armLen / 2) * Math.cos(a), (armLen / 2) * Math.sin(a), 0);
    arm.rotation.z = a;
    arm.castShadow = true;
    arm.receiveShadow = true;
    grp.add(arm);
  }
  // Centre block ties it together
  const hub = new THREE.Mesh(new THREE.BoxGeometry(w * 1.1, w * 1.1, h), mat);
  hub.castShadow = true;
  grp.add(hub);
  return grp;
}

function buildCross(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  const armLen = Math.max(w, h) * 1.5;
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const a of angles) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, w, h), mat);
    arm.position.set((armLen / 2) * Math.cos(a), (armLen / 2) * Math.sin(a), 0);
    arm.rotation.z = a;
    arm.castShadow = true;
    arm.receiveShadow = true;
    grp.add(arm);
  }
  const hub = new THREE.Mesh(new THREE.BoxGeometry(w * 1.2, w * 1.2, h), mat);
  hub.castShadow = true;
  grp.add(hub);
  return grp;
}

function buildReducer(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  const w2 = f.reducerWidth ?? w * 0.6;
  const h2 = f.reducerHeight ?? h * 0.8;
  const len = Math.max(w, w2) * 2;
  // Approximate the taper with a thin frustum: build via lathe-like trapezoid
  // boxes. Easiest: a CylinderGeometry with rectangular caps via shape extrude.
  // Simpler approximation — two boxes blended with a connecting plate.
  const big = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, w, h), mat);
  big.position.x = -len * 0.3;
  const small = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, w2, h2), mat);
  small.position.x = len * 0.3;
  // Diagonal connecting walls — top, bottom, and 2 sides.
  const taperLen = len * 0.2;
  const taper = new THREE.Mesh(
    new THREE.BoxGeometry(taperLen, (w + w2) / 2, (h + h2) / 2),
    mat,
  );
  big.castShadow = true;
  small.castShadow = true;
  taper.castShadow = true;
  grp.add(big);
  grp.add(small);
  grp.add(taper);
  return grp;
}

function buildEndCap(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  if (isOpenContainment(parent)) return grp;
  const { w, h } = dimsFor(f, parent);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(3, w, h), mat);
  plate.castShadow = true;
  plate.receiveShadow = true;
  grp.add(plate);
  return grp;
}

function buildCoupler(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  if (isOpenContainment(parent)) {
    grp.add(buildSideJoinerPlates(parent, w, h, mat, Math.max(120, w * 0.55)));
    return grp;
  }
  // Slightly oversized short overlap, in lighter colour.
  const lighter = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mat.color).lerp(new THREE.Color(0xffffff), 0.25).getHex(),
    metalness: mat.metalness,
    roughness: mat.roughness,
  });
  const sleeve = new THREE.Mesh(
    new THREE.BoxGeometry(40, w * 1.04, h * 1.04),
    lighter,
  );
  sleeve.castShadow = true;
  grp.add(sleeve);
  return grp;
}

function buildPullBox(
  f: FittingEntity,
  parent: ContainmentEntity | undefined,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const { w, h } = dimsFor(f, parent);
  const boxLen = Math.max(w * 2, 200);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(boxLen, w * 1.4, h * 1.4),
    mat,
  );
  box.castShadow = true;
  box.receiveShadow = true;
  grp.add(box);
  return grp;
}

// ---------- Public entry point ----------------------------------------------

/**
 * Render a fitting as a 3D Group centred on local XY origin. Caller is
 * expected to translate it to the fitting position and containment
 * centre-line elevation.
 */
export function renderFitting3D(
  fitting: FittingEntity,
  opts: FittingRenderOpts = {},
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `fitting:${fitting.id}`;

  const color = opts.parent ? colourFor(opts.parent, opts) : 0xb0b4ba;
  const mat = makeMat(color);

  let body: THREE.Group;
  switch (fitting.fittingKind) {
    case 'flat-bend':
    case 'inside-riser':
    case 'outside-riser':
      body = buildFlatBend(fitting, opts.parent, mat);
      break;
    case 'tee':
      body = buildTee(fitting, opts.parent, mat);
      break;
    case 'cross':
      body = buildCross(fitting, opts.parent, mat);
      break;
    case 'reducer':
    case 'transition':
      body = buildReducer(fitting, opts.parent, mat);
      break;
    case 'end-cap':
    case 'end-plate':
      body = buildEndCap(fitting, opts.parent, mat);
      break;
    case 'coupler':
    case 'expansion-coupling':
      body = buildCoupler(fitting, opts.parent, mat);
      break;
    case 'adaptable-box':
    case 'pull-box':
      body = buildPullBox(fitting, opts.parent, mat);
      break;
    default:
      body = buildEndCap(fitting, opts.parent, mat);
      break;
  }

  body.rotation.z = fitting.rotation ?? 0;
  root.add(body);
  tagPicking(root, fitting.id);
  return root;
}
