import * as THREE from 'three';
import type { Entity } from '../types';
import { installationStatus } from '../models/installation';

export type PanelAppearance = 'progress' | 'materials';
export type ApplyPanelAppearance = (entity: Entity, mode: PanelAppearance) => void;

type ColoredMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
interface OriginalMaterial {
  material: ColoredMaterial;
  color: THREE.Color;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  metalness?: number;
  roughness?: number;
  emissive?: THREE.Color;
}

// A position edit or status change must not recapture a currently muted kit.
// Weak ownership follows the incremental entity object through its lifetime.
const prepared = new WeakMap<THREE.Object3D, ApplyPanelAppearance>();

/** Capture once per entity object; leave the enclosure's shared palette intact. */
export function preparePanelEntityAppearance(
  root: THREE.Object3D,
  entityId: string,
  sharedMaterials: ReadonlySet<THREE.Material> = new Set(),
): ApplyPanelAppearance {
  const existing = prepared.get(root);
  if (existing) return existing;
  const states = new Map<ColoredMaterial, OriginalMaterial>();
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    object.userData.entityId = entityId;
    if (!(object instanceof THREE.Mesh)) return;
    const prepareMaterial = (source: THREE.Material): THREE.Material => {
      let material = source;
      if (sharedMaterials.has(source)) {
        let clone = clones.get(source);
        if (!clone) {
          clone = source.clone();
          clones.set(source, clone);
        }
        material = clone;
      }
      if ((material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) && !states.has(material)) {
        states.set(material, {
          material,
          color: material.color.clone(),
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
          ...(material instanceof THREE.MeshStandardMaterial ? {
            metalness: material.metalness,
            roughness: material.roughness,
            emissive: material.emissive.clone(),
          } : {}),
        });
      }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(prepareMaterial) : prepareMaterial(object.material);
  });
  let lastMode: PanelAppearance | undefined;
  let lastStatus: ReturnType<typeof installationStatus> | undefined;
  const apply: ApplyPanelAppearance = (entity, mode) => {
    const status = installationStatus(entity);
    root.userData.installationStatus = status;
    if (lastMode === mode && lastStatus === status) return;
    lastMode = mode;
    lastStatus = status;
    for (const state of states.values()) {
      const material = state.material;
      material.color.copy(state.color);
      material.opacity = state.opacity;
      material.transparent = state.transparent;
      material.depthWrite = state.depthWrite;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = state.metalness!;
        material.roughness = state.roughness!;
        material.emissive.copy(state.emissive!);
      }
      if (mode === 'progress' && status !== 'completed') {
        material.color.lerp(new THREE.Color(status === 'planned' ? 0xb3bdc5 : 0x9a9b91), status === 'planned' ? 0.94 : 0.78);
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = 0.08;
          material.roughness = 0.88;
          material.emissive.setHex(0x000000);
        }
      }
      material.needsUpdate = true;
    }
  };
  prepared.set(root, apply);
  return apply;
}

/** Respect hidden doors/ancestors and solid enclosure faces when picking. */
export function pickPanelEntity(root: THREE.Object3D, raycaster: THREE.Raycaster): string | null {
  root.updateWorldMatrix(true, true);
  for (const hit of raycaster.intersectObject(root, true)) {
    let object: THREE.Object3D | null = hit.object;
    let visible = true;
    let entityId: string | null = null;
    while (object) {
      if (!object.visible) visible = false;
      if (typeof object.userData.entityId === 'string') entityId ??= object.userData.entityId;
      object = object.parent;
    }
    if (!visible) continue;
    // The nearest visible physical face owns the click. A closed door does
    // not select an unseen device behind it.
    return entityId;
  }
  return null;
}
