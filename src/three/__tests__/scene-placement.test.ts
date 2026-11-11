import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { EquipmentEntity } from '../../types';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { attachScenePlacement, disposePreview, renderScenePlacementPreview } from '../ScenePlacement';
import { createEmptyProject } from '../../state/store';
import { useComponentPlacement, type ComponentPlacement } from '../../state/component-placement';

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

describe('3D placement requests a frame for every scene change', () => {
  it('calls onSceneChange when the ghost appears, moves, hides and is removed', () => {
    const board: EquipmentEntity = {
      id: 'board', kind: 'equipment', equipmentKind: 'distribution-board', tag: 'DB01',
      layerId: 'layer', visible: true, locked: false, elevation: 1200,
      a: { x: -600, y: -225 }, b: { x: 600, y: 225 }, height: 2000,
    };
    const project = createEmptyProject();
    const placement = {
      component: {}, prototype: board, project, sheetId: project.activeSheetId, layerId: project.activeLayerId,
      viewMode: '3d', surface: '3d', hint: '', operation: 'insert', rotation: 0, repeat: false,
    } as unknown as ComponentPlacement;
    useComponentPlacement.setState({ pending: placement, position: null, connection: null });
    const canvas = Object.assign(new EventTarget(), {
      style: { cursor: '' },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
      setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    }) as unknown as HTMLCanvasElement;
    const orbit = Object.assign(new EventTarget(), { enabled: true }) as unknown as OrbitControls;
    const camera = new THREE.PerspectiveCamera(45, 800 / 600, 10, 400000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -8000, 9000);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const scene = new THREE.Scene();
    const onSceneChange = vi.fn();
    // The leave handler checks relatedTarget instanceof Element.
    vi.stubGlobal('Element', class {});
    try {
      const detach = attachScenePlacement({
        scene, camera, canvas, orbit, root: null, placement, pointerPosition: { current: null }, onSceneChange,
      });
      const ghost = scene.getObjectByName('component-placement-preview');
      expect(ghost).toBeDefined();
      expect(onSceneChange).toHaveBeenCalled();
      expect(ghost!.visible).toBe(true);

      onSceneChange.mockClear();
      canvas.dispatchEvent(Object.assign(new Event('pointerleave'), { relatedTarget: null }));
      expect(ghost!.visible).toBe(false);
      expect(onSceneChange).toHaveBeenCalledTimes(1);

      onSceneChange.mockClear();
      detach();
      expect(scene.getObjectByName('component-placement-preview')).toBeUndefined();
      expect(onSceneChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      useComponentPlacement.setState({ pending: null, position: null, connection: null });
    }
  });
});
