import * as THREE from 'three';
import type { Entity, Project } from '../types';
import { installationStatus, type InstallationStatus } from '../models/installation';

export type InstallationAppearance = 'progress' | 'materials' | 'systems';
export type InstallationFilter = InstallationStatus | 'all';
const KINDS = new Set(['equipment', 'containment', 'fitting', 'support', 'riser', 'penetration', 'fire-barrier']);

export function sceneEntities(project: Project): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const sheet of Object.values(project.sheets)) {
    for (const e of Object.values(sheet.entities)) map.set(e.id, e);
  }
  return map;
}

export function entitySceneRoots(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const id = obj.userData.entityId;
    if (id && obj.parent?.userData.entityId !== id) nodes.push(obj);
  });
  return nodes;
}

interface MaterialState {
  color: THREE.Color;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  metalness: number;
  roughness: number;
  emissive?: THREE.Color;
}

/** Captures each object's physical materials once; progress is a reversible view. */
export function createInstallationAppearance(root: THREE.Object3D) {
  const originals = new Map<THREE.MeshStandardMaterial, MaterialState>();
  const owners = new Map<THREE.Material, string>();
  const ownerClones = new Map<THREE.Material, Map<string, THREE.Material>>();
  const groups = entitySceneRoots(root);
  // A kit material can also appear on an untagged architectural/background
  // mesh. Leave that original alone when assigning an entity its own palette.
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    let parent: THREE.Object3D | null = obj;
    while (parent && !parent.userData.entityId) parent = parent.parent;
    if (parent) return;
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) owners.set(material, '\u0000background');
  });
  for (const group of groups) {
    const entityId = group.userData.entityId as string;
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const prepare = (material: THREE.Material): THREE.Material => {
        // Shared geometry/material kits must never tint a neighbour's status.
        const previousOwner = owners.get(material);
        if (previousOwner && previousOwner !== entityId) {
          let clones = ownerClones.get(material);
          if (!clones) {
            clones = new Map();
            ownerClones.set(material, clones);
          }
          let clone = clones.get(entityId);
          if (!clone) {
            clone = material.clone();
            clones.set(entityId, clone);
          }
          material = clone;
        }
        owners.set(material, entityId);
        if (material instanceof THREE.MeshStandardMaterial && !originals.has(material)) {
          originals.set(material, { color: material.color.clone(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite, metalness: material.metalness, roughness: material.roughness, emissive: material.emissive.clone() });
        }
        return material;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(prepare) : prepare(obj.material);
    });
  }
  return (project: Project, mode: InstallationAppearance): void => {
    const entities = sceneEntities(project);
    for (const group of groups) {
      const entity = entities.get(group.userData.entityId);
      if (!entity || !KINDS.has(entity.kind)) continue;
      const status = installationStatus(entity);
      group.userData.installationStatus = status;
      group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
          const original = originals.get(mat);
          if (!original) continue;
          mat.color.copy(original.color);
          mat.opacity = original.opacity;
          mat.transparent = original.transparent;
          mat.depthWrite = original.depthWrite;
          mat.metalness = original.metalness;
          mat.roughness = original.roughness;
          if (original.emissive) mat.emissive.copy(original.emissive);
          if (mode === 'progress' && status !== 'completed') {
            const grey = status === 'planned' ? 0xb3bdc5 : 0x9a9b91;
            mat.color.lerp(new THREE.Color(grey), status === 'planned' ? 0.94 : 0.78);
            mat.metalness = 0.08;
            mat.roughness = 0.88;
            mat.emissive.setHex(0x000000);
            // Opaque desaturation preserves depth, readable edges, and picking.
          } else if (mode === 'systems') {
            const sid = entity.systemId ?? group.userData.systemId;
            const system = sid ? project.systems?.[sid] : undefined;
            if (system?.color && !obj.userData.equipmentPart) mat.color.set(system.color);
          }
          mat.needsUpdate = true;
        }
      });
    }
  };
}
