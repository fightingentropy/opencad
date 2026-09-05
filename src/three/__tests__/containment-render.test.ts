import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderContainment3D, setContainmentCoversOpen } from '../ContainmentRender3D';
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

    expect(meshes.length).toBeLessThan(8);
    expect(obj.getObjectByName('welded-basket-wire')).toBeInstanceOf(THREE.InstancedMesh);
    for (const mesh of meshes) {
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(mesh).getSize(size);
      expect(size.z).toBeLessThanOrEqual((basket.height ?? 100) + 1);
    }
  });

  it('renders explicitly elevated conduit with hollow walls and couplings', () => {
    const conduit = makeConduit();
    const obj = renderContainment3D(conduit);
    obj.updateMatrixWorld(true);

    const meshes: THREE.Mesh[] = [];
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    expect(obj.getObjectByName('conduit-outer-wall')).toBeInstanceOf(THREE.Mesh);
    expect(obj.getObjectByName('conduit-inner-wall')).toBeInstanceOf(THREE.Mesh);
    expect(obj.getObjectByName('conduit-coupling')).toBeInstanceOf(THREE.Mesh);
    const bounds = new THREE.Box3().setFromObject(obj);
    expect(bounds.min.z).toBeGreaterThanOrEqual(1798);
    expect(bounds.max.z).toBeLessThanOrEqual(1834);
    expect(meshes.every((mesh) => mesh.userData.entityId === conduit.id)).toBe(true);
  });

  it('leaves plan-only conduit aids hidden unless explicitly enabled', () => {
    const conduit = { ...makeConduit(), elevation: undefined };
    expect(renderContainment3D(conduit).children).toHaveLength(0);
    expect(renderContainment3D(conduit, { renderConduit: true }).children.length).toBeGreaterThan(0);
  });

  it('perforates tray through its floor instead of painting black stripes', () => {
    const tray = { ...makeBasket(), containmentType: 'tray' as const };
    const obj = renderContainment3D(tray);
    obj.updateMatrixWorld(true);
    const bottom = obj.getObjectByName('perforated-tray-bottom')!;
    expect(bottom).toBeInstanceOf(THREE.InstancedMesh);
    const ray = new THREE.Raycaster(new THREE.Vector3(37.5, 37.5, 2600), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(bottom)).toHaveLength(0);
    ray.ray.origin.x = 5;
    expect(ray.intersectObject(bottom).length).toBeGreaterThan(0);
  });

  it('opens trunking lids without a solid block obstructing the interior', () => {
    const trunking = { ...makeBasket(), containmentType: 'trunking' as const, compartments: 2 };
    const obj = renderContainment3D(trunking);
    const cover = obj.getObjectByName('removable-cover')!;
    expect(cover.visible).toBe(true);
    setContainmentCoversOpen(obj, true);
    expect(cover.visible).toBe(false);
    expect(obj.getObjectByName('segregation-dividers')).toBeDefined();
    obj.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(1000, 60, 2490), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(obj, true).find((entry) => entry.object.parent !== cover);
    expect(hit?.point.z).toBeCloseTo(2402);
    setContainmentCoversOpen(obj, false);
    expect(cover.visible).toBe(true);
  });

  it('keeps busbar width across the route and exposes physical copper conductors', () => {
    const busbar = { ...makeBasket(), containmentType: 'busbar' as const };
    const obj = renderContainment3D(busbar, { showCovers: false });
    const conductors = obj.getObjectByName('busbar-copper-conductors')!;
    obj.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(conductors).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(5998);
    expect(size.z).toBeCloseTo(55);
    expect(obj.getObjectByName('removable-cover')?.visible).toBe(false);
  });

  it('skips non-finite routes and elevations without creating corrupt geometry', () => {
    expect(renderContainment3D({ ...makeBasket(), elevation: NaN }).children).toHaveLength(0);
    expect(renderContainment3D({ ...makeBasket(), points: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }] }).children).toHaveLength(0);
  });

  it('bounds construction detail on very long runs and owns each material instance', () => {
    const basket = { ...makeBasket(), points: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }] };
    const a = renderContainment3D(basket);
    const b = renderContainment3D(basket);
    const wireA = a.getObjectByName('welded-basket-wire') as THREE.InstancedMesh;
    const wireB = b.getObjectByName('welded-basket-wire') as THREE.InstancedMesh;
    expect(wireA.count).toBeLessThan(410);
    expect(wireA.geometry).not.toBe(wireB.geometry);
    expect(wireA.material).not.toBe(wireB.material);
  });
});
