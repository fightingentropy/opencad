import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderContainment3D } from '../ContainmentRender3D';
import type { ContainmentEntity } from '../../types';

const makeBasket = (): ContainmentEntity => ({
  id: 'basket-1',
  kind: 'containment',
  layerId: 'containment-layer',
  visible: true,
  locked: false,
  containmentType: 'basket',
  points: [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
  ],
  width: 300,
  height: 100,
  elevation: 2400,
});

const makeConduit = (): ContainmentEntity => ({
  id: 'conduit-1',
  kind: 'containment',
  layerId: 'containment-layer',
  visible: true,
  locked: false,
  containmentType: 'conduit',
  points: [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
  ],
  width: 32,
  elevation: 1800,
});

describe('renderContainment3D', () => {
  it('does not draw transverse basket wires as vertical rods', () => {
    const basket = makeBasket();
    const obj = renderContainment3D(basket);
    obj.updateMatrixWorld(true);

    const meshes: THREE.Mesh[] = [];
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    expect(meshes).toHaveLength(7);
    for (const mesh of meshes) {
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(mesh).getSize(size);
      expect(size.z).toBeLessThanOrEqual((basket.height ?? 100) + 1);
    }
  });

  it('does not draw conduit route aids as physical 3D objects', () => {
    const conduit = makeConduit();
    const obj = renderContainment3D(conduit);
    obj.updateMatrixWorld(true);

    const meshes: THREE.Mesh[] = [];
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    expect(meshes).toHaveLength(0);
  });
});
