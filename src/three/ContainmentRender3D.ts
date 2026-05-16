// Parametric extruded 3D containment renderer.
//
// One ContainmentEntity → one THREE.Object3D (a Group). Horizontal
// containment types extrude each polyline segment. Conduit is deliberately
// not rendered as physical 3D geometry here because the plan polyline is a
// routing aid, not a reliable wall/surface-mounted BIM path.
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
    if (len < 1e-3) continue;
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

// Tray: open box (3 walls + bottom). subType 'perforated' adds slots, the
// solid-bottom variant gets none.
function buildTraySegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
  subType: string | undefined,
): THREE.Group {
  const wrap = new THREE.Group();
  const tk = 2;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(len, width, tk), mat);
  bottom.position.z = -height / 2 + tk / 2;
  bottom.castShadow = true;
  bottom.receiveShadow = true;
  wrap.add(bottom);
  for (const sy of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(len, tk, height), mat);
    side.position.set(0, sy * (width / 2 - tk / 2), 0);
    side.castShadow = true;
    side.receiveShadow = true;
    wrap.add(side);
  }
  // Approximate perforations as a row of small dark stripes — visually
  // sufficient at panel-overview scale. Skip for solid-bottom and
  // return-flange (which is just a flange detail, not perforation).
  if (subType !== 'solid-bottom' && subType !== 'return-flange') {
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e34,
      metalness: 0.0,
      roughness: 0.95,
    });
    const slotCount = Math.max(2, Math.floor(len / 60));
    for (let k = 0; k < slotCount; k++) {
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(8, width * 0.55, 0.5),
        slotMat,
      );
      slot.position.set(
        -len / 2 + (k + 0.5) * (len / slotCount),
        0,
        -height / 2 + tk + 0.3,
      );
      wrap.add(slot);
    }
  }
  // Return flange — a small inward lip at the top of each side rail.
  if (subType === 'return-flange') {
    const flangeMat = mat;
    for (const sy of [-1, 1]) {
      const flange = new THREE.Mesh(
        new THREE.BoxGeometry(len, width * 0.1, tk),
        flangeMat,
      );
      flange.position.set(
        0,
        sy * (width / 2 - tk / 2 - (width * 0.1) / 2),
        height / 2 - tk / 2,
      );
      wrap.add(flange);
    }
  }
  return wrap;
}

// Ladder: side rails + rungs every 300 mm. Heavy-duty has thicker rails.
function buildLadderSegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
  subType: string | undefined,
): THREE.Group {
  const wrap = new THREE.Group();
  const isHeavy = subType === 'heavy-duty-ladder';
  const railThk = isHeavy ? 4 : 2.5;
  const railHeight = height;
  for (const sy of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(len, railThk, railHeight),
      mat,
    );
    rail.position.set(0, sy * (width / 2 - railThk / 2), 0);
    rail.castShadow = true;
    rail.receiveShadow = true;
    wrap.add(rail);
  }
  // Rungs at fixed pitch.
  const rungPitch = 300;
  const rungCount = Math.max(2, Math.floor(len / rungPitch));
  const rungThk = isHeavy ? 6 : 4;
  for (let k = 0; k <= rungCount; k++) {
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(rungThk, width - railThk * 2, rungThk),
      mat,
    );
    rung.position.set(-len / 2 + (k * len) / rungCount, 0, -height / 2 + rungThk / 2);
    rung.castShadow = true;
    wrap.add(rung);
  }
  return wrap;
}

// Basket: a low-profile tray. Keep the mesh detail understated in 3D;
// cross wires read as stray rods in first-person views.
function buildBasketSegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const wrap = new THREE.Group();
  const tk = 1.5;
  const flangeH = Math.min(height, 12);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(len, width, tk), mat);
  bottom.position.z = -height / 2 + tk / 2;
  bottom.castShadow = true;
  bottom.receiveShadow = true;
  wrap.add(bottom);
  for (const sy of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(len, tk, flangeH), mat);
    side.position.set(0, sy * (width / 2 - tk / 2), -height / 2 + flangeH / 2);
    wrap.add(side);
  }
  // Subtle longitudinal rails along the bottom. Do not add transverse
  // wire rods here: from a walkthrough camera they look like random
  // vertical pins through the tray.
  const longCount = 4;
  for (let r = 0; r < longCount; r++) {
    const t = (r + 0.5) / longCount;
    const y = -width / 2 + t * width;
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, len, 6),
      mat,
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, y, -height / 2 + tk + 0.7);
    wrap.add(rail);
  }
  return wrap;
}

// Trunking: closed box with darker lid. Multi-compartment trunking gets
// internal divider walls.
function buildTrunkingSegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
  compartments: number | undefined,
  baseColor: number,
): THREE.Group {
  const wrap = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, width, height), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  wrap.add(body);
  // Darker lid on top
  const lidColor = new THREE.Color(baseColor).multiplyScalar(0.55).getHex();
  const lidMat = new THREE.MeshStandardMaterial({
    color: lidColor,
    metalness: 0.05,
    roughness: 0.6,
  });
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(len, width * 0.92, height * 0.12),
    lidMat,
  );
  lid.position.z = height / 2 + (height * 0.12) / 2 - 0.5;
  wrap.add(lid);
  // Compartment dividers
  if (compartments && compartments > 1) {
    const divThk = 1.5;
    for (let i = 1; i < compartments; i++) {
      const t = i / compartments;
      const y = -width / 2 + t * width;
      const div = new THREE.Mesh(
        new THREE.BoxGeometry(len, divThk, height * 0.85),
        lidMat,
      );
      div.position.set(0, y, 0);
      wrap.add(div);
    }
  }
  return wrap;
}

// Duct: thick-walled box. Used for floor / underground duct runs.
function buildDuctSegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
): THREE.Group {
  const wrap = new THREE.Group();
  // Outer shell
  const outer = new THREE.Mesh(new THREE.BoxGeometry(len, width, height), mat);
  outer.castShadow = true;
  outer.receiveShadow = true;
  wrap.add(outer);
  // Hollow inner — slightly inset for a thick-walled appearance. We can't
  // do CSG in three core, so we just darken the inside at the open ends
  // by adding capped face tiles in a slot colour.
  const slotMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e34,
    metalness: 0.0,
    roughness: 0.95,
  });
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(2, width * 0.7, height * 0.7),
      slotMat,
    );
    cap.position.set((sx * len) / 2, 0, 0);
    wrap.add(cap);
  }
  return wrap;
}

// Busbar: a closed metal box, often with sandwich construction. We use
// ExtrudeGeometry so the cap details (joints every metre) sit cleanly.
function buildBusbarSegment(
  width: number,
  height: number,
  len: number,
  mat: THREE.MeshStandardMaterial,
  subType: string | undefined,
): THREE.Group {
  const wrap = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(-width / 2, -height / 2);
  profile.lineTo(width / 2, -height / 2);
  profile.lineTo(width / 2, height / 2);
  profile.lineTo(-width / 2, height / 2);
  profile.lineTo(-width / 2, -height / 2);
  const ext = new THREE.ExtrudeGeometry(profile, {
    depth: len,
    bevelEnabled: false,
  });
  // Re-orient — ExtrudeGeometry extrudes along +Z; we want length on X.
  ext.rotateY(Math.PI / 2);
  ext.translate(-len / 2, 0, 0);
  const body = new THREE.Mesh(ext, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  wrap.add(body);
  // Joint covers every 1000 mm — a darker thin band wrapping the box.
  if (subType !== 'plug-in-busbar') {
    const jointMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(mat.color).multiplyScalar(0.4).getHex(),
      metalness: 0.6,
      roughness: 0.4,
    });
    const jointPitch = 1000;
    const joints = Math.floor(len / jointPitch);
    for (let k = 1; k <= joints; k++) {
      const x = -len / 2 + k * jointPitch;
      const j = new THREE.Mesh(
        new THREE.BoxGeometry(8, width * 1.04, height * 1.04),
        jointMat,
      );
      j.position.set(x, 0, 0);
      wrap.add(j);
    }
  } else {
    // Plug-in busbar — visible tap-off slots along the bottom.
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e34,
      metalness: 0.0,
      roughness: 0.95,
    });
    const slotPitch = 600;
    const slots = Math.floor(len / slotPitch);
    for (let k = 1; k <= slots; k++) {
      const x = -len / 2 + k * slotPitch;
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(40, width * 0.4, 4),
        slotMat,
      );
      s.position.set(x, 0, -height / 2 - 0.5);
      wrap.add(s);
    }
  }
  return wrap;
}

// ---------- Public entry point ----------------------------------------------

/**
 * Render a containment entity as a 3D group. Returns null only for
 * truly degenerate input (no points / zero-length).
 */
export function renderContainment3D(
  containment: ContainmentEntity,
  opts: RenderOpts = {},
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `containment:${containment.id}`;
  if (!containment.points || containment.points.length < 2) {
    tagPicking(root, containment.id);
    return root;
  }

  const w = containment.width ?? 100;
  const h = containment.height ?? 50;

  if (containment.containmentType === 'conduit') {
    tagPicking(root, containment.id);
    return root;
  }

  const colorSpec = pickColor(containment, opts);
  const baseMat = makeMat(colorSpec);

  // Bottom-of-section Z elevation.
  const baseZ =
    typeof opts.forceElevation === 'number'
      ? opts.forceElevation
      : defaultElevation(containment, opts.floor);

  for (const seg of iterSegments(containment.points, opts.flipY)) {
    let segGroup: THREE.Group | null = null;
    let centerZ = baseZ + h / 2;

    switch (containment.containmentType) {
      case 'tray':
        segGroup = buildTraySegment(w, h, seg.len, baseMat, containment.subType);
        break;
      case 'ladder':
        segGroup = buildLadderSegment(w, h, seg.len, baseMat, containment.subType);
        break;
      case 'basket':
        segGroup = buildBasketSegment(w, h, seg.len, baseMat);
        break;
      case 'trunking':
        segGroup = buildTrunkingSegment(
          w,
          h,
          seg.len,
          baseMat,
          containment.compartments,
          colorSpec.color,
        );
        break;
      case 'duct':
        segGroup = buildDuctSegment(w, h, seg.len, baseMat);
        break;
      case 'busbar':
        segGroup = buildBusbarSegment(w, h, seg.len, baseMat, containment.subType);
        break;
    }

    if (!segGroup) continue;
    segGroup.position.set(seg.cx, seg.cy, centerZ);
    segGroup.rotation.z = seg.heading;
    root.add(segGroup);
  }

  tagPicking(root, containment.id);
  return root;
}

// Re-export for callers that want to pre-resolve a colour without running
// the renderer.
export function colourFor(c: ContainmentEntity, opts: RenderOpts = {}): number {
  return pickColor(c, opts).color;
}
