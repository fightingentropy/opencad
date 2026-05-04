// Cross-section visualisation for the floating cross-section editor.
//
// Given a containment and the cables routed through it, render a 2D
// cross-section (containment outline + cable circles inside) as a
// THREE.Group. The group is positioned at (x, y) with z=0 so a 2D camera
// can render it as an overlay. Cable circles are sized by OD, coloured
// by circuitType, and labelled with the cable reference.

import * as THREE from 'three';
import type { ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import { colourForCircuit } from './CableInTray3D';
import { colourFor } from './ContainmentRender3D';

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

// Build a small label sprite. Used for cable references.
function makeLabel(text: string, fg = '#ffffff', bg = 'rgba(20,20,24,0.85)'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fg;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(120, 30, 1);
  return sprite;
}

// Pack cable centres inside the containment cross-section (scaled coords
// match the actual mm dims). Mirrors the CableInTray3D packer.
function packCables(
  cables: Cable[],
  width: number,
  height: number,
): { y: number; z: number; r: number; cable: Cable }[] {
  const out: { y: number; z: number; r: number; cable: Cable }[] = [];
  let curX = -width / 2;
  let curZ = -height / 2;
  let rowMaxR = 0;
  for (const cable of cables) {
    const r = Math.max(2, cable.outerDiameter / 2);
    if (curX + r * 2 > width / 2) {
      curZ += rowMaxR * 2 + 2;
      curX = -width / 2;
      rowMaxR = 0;
    }
    if (curZ + r * 2 > height / 2) break;
    out.push({ y: curX + r, z: curZ + r, r, cable });
    curX += r * 2 + 2;
    if (r > rowMaxR) rowMaxR = r;
  }
  return out;
}

export interface CrossSectionOpts {
  /** Show cable references as labels. Defaults to true. */
  showLabels?: boolean;
  /** Background fill colour for the containment interior. */
  backgroundColor?: number;
}

/**
 * Render a containment cross-section with the cables packed inside.
 *
 * `x`, `y` are world-space placement (used by a 2D overlay camera).
 * `scale` lets the caller zoom — 1.0 = mm units in world space.
 */
export function renderCrossSection(
  containment: ContainmentEntity,
  cables: Cable[],
  x: number,
  y: number,
  scale = 1,
  opts: CrossSectionOpts = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = `cross-section:${containment.id}`;

  const w = (containment.width ?? 100) * scale;
  const h = (containment.height ?? 50) * scale;
  const isRound = containment.containmentType === 'conduit';

  const containmentColor = colourFor(containment, {});
  const lineMat = new THREE.LineBasicMaterial({ color: containmentColor, linewidth: 2 });
  const fillMat = new THREE.MeshBasicMaterial({
    color: opts.backgroundColor ?? 0xf2f3f5,
    transparent: true,
    opacity: 0.95,
  });

  // Outer outline + interior fill
  if (isRound) {
    const r = w / 2;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 32), fillMat);
    root.add(fill);
    const outlinePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      outlinePts.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0));
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePts), lineMat));
  } else {
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fillMat);
    root.add(fill);
    const o = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, -h / 2, 0),
      new THREE.Vector3(w / 2, -h / 2, 0),
      new THREE.Vector3(w / 2, h / 2, 0),
      new THREE.Vector3(-w / 2, h / 2, 0),
      new THREE.Vector3(-w / 2, -h / 2, 0),
    ]);
    root.add(new THREE.Line(o, lineMat));
  }

  // Cable circles
  const interiorW = isRound ? Math.SQRT2 * (w / 2) : w * 0.9;
  const interiorH = isRound ? Math.SQRT2 * (w / 2) : h * 0.9;
  const packs = packCables(
    cables,
    interiorW / scale,
    interiorH / scale,
  );

  const showLabels = opts.showLabels !== false;
  for (const pack of packs) {
    const r = pack.r * scale;
    const colour = colourForCircuit(pack.cable.circuitType);
    const circleMat = new THREE.MeshBasicMaterial({ color: colour });
    const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 16), circleMat);
    ring.position.set(pack.y * scale, pack.z * scale, 1);
    root.add(ring);
    if (showLabels) {
      const sprite = makeLabel(pack.cable.reference);
      sprite.position.set(pack.y * scale, pack.z * scale + r + 18, 2);
      // Scale label down for tiny cables
      const labelScale = Math.min(1, r / 10);
      sprite.scale.multiplyScalar(labelScale);
      root.add(sprite);
    }
  }

  root.position.set(x, y, 0);
  tagPicking(root, containment.id);
  return root;
}
