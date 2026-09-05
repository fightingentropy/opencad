// Procedural equipment in millimetres, Z-up. Resources belong to each assembly.
import * as THREE from 'three';
import type { EquipmentEntity, EquipmentKind } from '../types';
import { EquipmentParts, buildCabinet, buildMechanicalEquipment } from './EquipmentParts3D';

export interface EquipmentRenderOpts {
  heightOverride?: number;
  showLabel?: boolean;
  /** Sheet height for CAD screen-down Y coordinates. */
  flipY?: number;
  /** Swing cabinet doors open to inspect their physical internals. */
  openPanels?: boolean;
}

interface Style { color: number; defaultHeight: number; }
const STYLES: Record<EquipmentKind, Style> = {
  'distribution-board': { color: 0xb8bcc2, defaultHeight: 2000 },
  mcc: { color: 0x6c7480, defaultHeight: 2200 },
  panelboard: { color: 0xb8bcc2, defaultHeight: 1500 },
  switchboard: { color: 0x44494f, defaultHeight: 2200 },
  transformer: { color: 0x5f7868, defaultHeight: 1800 },
  generator: { color: 0xbc3933, defaultHeight: 2200 },
  ups: { color: 0x2a3f56, defaultHeight: 1800 },
  motor: { color: 0x2a55a6, defaultHeight: 600 },
  pump: { color: 0x4f88c4, defaultHeight: 800 },
  fan: { color: 0x8c8c8c, defaultHeight: 1000 },
  'air-handling-unit': { color: 0xa6a8ac, defaultHeight: 2200 },
  'control-panel': { color: 0xb8bcc2, defaultHeight: 1800 },
  'fire-alarm-panel': { color: 0xc62d2d, defaultHeight: 800 },
  'comms-rack': { color: 0x343b46, defaultHeight: 2200 },
  cabinet: { color: 0xb8bcc2, defaultHeight: 1800 },
  enclosure: { color: 0x9aa0a8, defaultHeight: 600 },
  meter: { color: 0x2a2e34, defaultHeight: 400 },
  'busbar-tap-off': { color: 0xc4a86b, defaultHeight: 350 },
  other: { color: 0x9aa0a8, defaultHeight: 1500 },
};

function makeLabelSprite(text: string, width: number): THREE.Sprite {
  let texture: THREE.CanvasTexture | undefined;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(15,24,36,0.9)';
      ctx.fillRect(0, 0, 512, 112);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(0, 0, 6, 112);
      ctx.fillStyle = '#eef4fa';
      ctx.font = '600 48px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 260, 56, 470);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
    }
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture ?? null, transparent: true, opacity: texture ? 0.95 : 0,
    depthWrite: false,
  }));
  sprite.name = 'equipment-tag';
  sprite.userData.layer = 'labels';
  sprite.scale.set(width, width * 112 / 512, 1);
  return sprite;
}

/** Toggle existing doors without rebuilding geometry or materials. */
export function setEquipmentOpen(root: THREE.Object3D, open: boolean): void {
  root.traverse((part) => {
    if (part.userData.equipmentDoor === true) {
      part.rotation.z = open ? part.userData.openAngle : 0;
      part.userData.open = open;
    }
    if (part.userData.equipmentAssembly) part.userData.openPanels = open;
  });
  root.updateMatrixWorld(true);
}

/**
 * Closed equipment fits its footprint; opening doors occupies service space.
 * Internals are representative construction details, not manufacturer CAD.
 */
export function renderEquipment3D(equipment: EquipmentEntity, opts: EquipmentRenderOpts = {}): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'equipment:' + equipment.id;
  const style = STYLES[equipment.equipmentKind] ?? STYLES.other;
  const xMin = Math.min(equipment.a.x, equipment.b.x);
  const xMax = Math.max(equipment.a.x, equipment.b.x);
  const yMin = Math.min(equipment.a.y, equipment.b.y);
  const yMax = Math.max(equipment.a.y, equipment.b.y);
  const w = Math.max(50, xMax - xMin);
  const d = Math.max(50, yMax - yMin);
  const requestedHeight = opts.heightOverride ?? equipment.height ?? style.defaultHeight;
  const h = Number.isFinite(requestedHeight) ? Math.max(50, requestedHeight) : style.defaultHeight;
  root.position.set((xMin + xMax) / 2,
    opts.flipY == null ? (yMin + yMax) / 2 : opts.flipY - (yMin + yMax) / 2,
    equipment.elevation ?? 0);
  root.rotation.z = (equipment.rotation ?? 0) * (opts.flipY == null ? 1 : -1);
  root.userData.equipmentAssembly = true;
  root.userData.equipmentKind = equipment.equipmentKind;
  root.userData.dimensions = { width: w, depth: d, height: h };
  root.userData.detailLevel = 'construction';
  const parts = new EquipmentParts(root, w, d, h, style.color);
  if (!buildMechanicalEquipment(parts, equipment)) buildCabinet(parts, equipment);
  if (opts.showLabel !== false && equipment.tag) {
    const label = makeLabelSprite(equipment.tag, Math.min(900, Math.max(400, w * 0.72)));
    label.position.set(0, 0, h + Math.min(200, h * 0.1));
    root.add(label);
  }
  root.traverse((child) => {
    child.userData.entityId = equipment.id;
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  setEquipmentOpen(root, opts.openPanels ?? false);
  return root;
}
