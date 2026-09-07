import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { EquipmentEntity } from '../../types';
import { disposePreview, renderScenePlacementPreview } from '../ScenePlacement';

describe('3D placement preview', () => {
  it('keeps equipment elevation when the pointer root moves onto a floor', () => {
    const board: EquipmentEntity = {
      id: 'board', kind: 'equipment', equipmentKind: 'distribution-board', tag: 'DB01',
      layerId: 'layer', visible: true, locked: false, elevation: 1200,
      a: { x: -600, y: -225 }, b: { x: 600, y: 225 }, height: 2000,
    };
    const preview = renderScenePlacementPreview(board);
    const original = new THREE.Box3().setFromObject(preview);
    preview.position.set(5000, 2000, 3000);
    preview.updateMatrixWorld(true);
    const shifted = new THREE.Box3().setFromObject(preview);
    expect(original.min.z).toBeGreaterThanOrEqual(1200);
    expect(shifted.min.z - original.min.z).toBeCloseTo(3000);
    expect(shifted.min.x - original.min.x).toBeCloseTo(5000);
    expect(shifted.min.y - original.min.y).toBeCloseTo(2000);
    expect(preview.getObjectByName('equipment-tag')).toBeUndefined();
    disposePreview(preview);
  });

  it('disposes shared geometry, materials and label textures once when a preview ends', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    disposePreview(root);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
