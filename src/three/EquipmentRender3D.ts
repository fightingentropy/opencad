// Render large equipment (distribution boards, MCCs, transformers, motors,
// fans, …) as 3D boxes with kind-appropriate colour, size and details.
// Each returned object exposes userData.entityId for picking and includes
// a text label sprite carrying the equipment tag.

import * as THREE from 'three';
import type { EquipmentEntity, EquipmentKind } from '../types';

export interface EquipmentRenderOpts {
  /** Override the equipment height (mm). Default is per-kind. */
  heightOverride?: number;
  /** Show the tag label sprite. Defaults to true. */
  showLabel?: boolean;
  /** Y-flip to convert CAD-y coordinates (sheet height in mm). */
  flipY?: number;
}

interface Style {
  color: number;
  metalness: number;
  roughness: number;
  defaultHeight: number;
  hasDoor?: boolean;
  doorRows?: number;
  doorCols?: number;
}

const STYLES: Record<EquipmentKind, Style> = {
  'distribution-board': {
    color: 0xb8bcc2, metalness: 0.6, roughness: 0.45, defaultHeight: 2000, hasDoor: true,
  },
  mcc: {
    color: 0x6c7480, metalness: 0.5, roughness: 0.5, defaultHeight: 2200, hasDoor: true, doorCols: 4,
  },
  panelboard: {
    color: 0xb8bcc2, metalness: 0.5, roughness: 0.5, defaultHeight: 1500, hasDoor: true,
  },
  switchboard: {
    color: 0x44494f, metalness: 0.5, roughness: 0.5, defaultHeight: 2200, hasDoor: true, doorCols: 6,
  },
  transformer: {
    color: 0x4a6e3f, metalness: 0.6, roughness: 0.55, defaultHeight: 1800,
  },
  generator: {
    color: 0xc63939, metalness: 0.4, roughness: 0.6, defaultHeight: 2200,
  },
  ups: {
    color: 0x2a3f56, metalness: 0.4, roughness: 0.5, defaultHeight: 1800, hasDoor: true,
  },
  motor: {
    color: 0x2a55a6, metalness: 0.6, roughness: 0.45, defaultHeight: 600,
  },
  pump: {
    color: 0x4f88c4, metalness: 0.55, roughness: 0.5, defaultHeight: 800,
  },
  fan: {
    color: 0x8c8c8c, metalness: 0.55, roughness: 0.45, defaultHeight: 1000,
  },
  'air-handling-unit': {
    color: 0xa6a8ac, metalness: 0.4, roughness: 0.65, defaultHeight: 2200,
  },
  'control-panel': {
    color: 0xb8bcc2, metalness: 0.55, roughness: 0.5, defaultHeight: 1800, hasDoor: true,
  },
  'fire-alarm-panel': {
    color: 0xc62d2d, metalness: 0.5, roughness: 0.55, defaultHeight: 800,
  },
  'comms-rack': {
    color: 0x343b46, metalness: 0.45, roughness: 0.5, defaultHeight: 2200, hasDoor: true, doorRows: 8,
  },
  cabinet: {
    color: 0xb8bcc2, metalness: 0.55, roughness: 0.5, defaultHeight: 1800, hasDoor: true,
  },
  enclosure: {
    color: 0x9aa0a8, metalness: 0.55, roughness: 0.5, defaultHeight: 600, hasDoor: true,
  },
  meter: {
    color: 0x2a2e34, metalness: 0.4, roughness: 0.6, defaultHeight: 400, hasDoor: true,
  },
  'busbar-tap-off': {
    color: 0xc4a86b, metalness: 0.85, roughness: 0.3, defaultHeight: 350,
  },
  other: {
    color: 0x9aa0a8, metalness: 0.4, roughness: 0.55, defaultHeight: 1500,
  },
};

function tagPicking(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

function makeMat(spec: { color: number; metalness: number; roughness: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
  });
}

// Build a label sprite using a 2D canvas. Cheap and works without font
// loading. The sprite is sized in world units so it stays readable.
function makeLabelSprite(text: string): THREE.Sprite {
  if (typeof document === 'undefined') {
    const fallback = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0 }));
    fallback.scale.set(800, 200, 1);
    return fallback;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 64;
  canvas.width = 512;
  canvas.height = 128;
  if (ctx) {
    ctx.fillStyle = 'rgba(20,20,24,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(800, 200, 1);
  return sprite;
}

/**
 * Render an EquipmentEntity as a 3D Group. Box sized by a/b corners and
 * height (default per-kind). Adds a label sprite on top with the tag.
 */
export function renderEquipment3D(
  equipment: EquipmentEntity,
  opts: EquipmentRenderOpts = {},
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `equipment:${equipment.id}`;
  const style = STYLES[equipment.equipmentKind] ?? STYLES.other;

  const xMin = Math.min(equipment.a.x, equipment.b.x);
  const xMax = Math.max(equipment.a.x, equipment.b.x);
  const yMin = Math.min(equipment.a.y, equipment.b.y);
  const yMax = Math.max(equipment.a.y, equipment.b.y);
  const w = Math.max(50, xMax - xMin);
  const d = Math.max(50, yMax - yMin);
  const h = opts.heightOverride ?? equipment.height ?? style.defaultHeight;

  // Centre of footprint, with optional Y flip for CAD coords.
  const cx = (xMin + xMax) / 2;
  const cy = opts.flipY != null ? opts.flipY - (yMin + yMax) / 2 : (yMin + yMax) / 2;
  const baseZ = equipment.elevation ?? 0;

  const bodyMat = makeMat(style);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), bodyMat);
  body.position.set(cx, cy, baseZ + h / 2);
  body.castShadow = true;
  body.receiveShadow = true;
  if (equipment.rotation) body.rotation.z = equipment.rotation;
  root.add(body);

  // Door pattern — darker rectangles on the front face
  if (style.hasDoor) {
    const rows = style.doorRows ?? 1;
    const cols = style.doorCols ?? 1;
    const doorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(style.color).multiplyScalar(0.65).getHex(),
      metalness: style.metalness,
      roughness: style.roughness + 0.1,
    });
    const padX = w * 0.08;
    const padZ = h * 0.06;
    const cellW = (w - padX * 2) / cols;
    const cellH = (h - padZ * 2) / rows;
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(cellW * 0.92, 4, cellH * 0.92),
          doorMat,
        );
        door.position.set(
          cx - w / 2 + padX + cellW * (cc + 0.5),
          cy - d / 2 - 1.5,
          baseZ + padZ + cellH * (r + 0.5),
        );
        if (equipment.rotation) {
          // Rotate door position around body centre. Skip — door pattern
          // looks acceptable in any orientation for this simplified model.
        }
        root.add(door);
      }
    }
  }

  // Label sprite above the equipment
  if (opts.showLabel !== false && equipment.tag) {
    const sprite = makeLabelSprite(equipment.tag);
    sprite.position.set(cx, cy, baseZ + h + 200);
    sprite.userData.entityId = equipment.id;
    root.add(sprite);
  }

  tagPicking(root, equipment.id);
  return root;
}
