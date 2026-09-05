import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Entity, SymbolEntity, WireEntity } from '../../types';
import { pickPanelEntity, preparePanelEntityAppearance } from '../PanelInstallationAppearance';
import { buildMaterials, buildWireMesh, updateWireGeometryInPlace } from '../Panel3D';

const symbol = (id = 'symbol-1'): SymbolEntity => ({
  id, kind: 'symbol', layerId: 'components', visible: true, locked: false,
  symbolId: 'breaker', position: { x: 0, y: 0 }, rotation: 0, scale: 1,
});
const completed = <T extends Entity>(entity: T): T => ({
  ...entity, installation: { status: 'completed', updatedAt: 100, completedAt: 100, activities: [] },
});

const box = (material: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), material);

describe('legacy panel installation appearance', () => {
  it('isolates shared component colors from the enclosure and neighbouring components', () => {
    const materials = buildMaterials();
    const palette = new Set<THREE.Material>([materials.red, materials.steelPainted]);
    const originalRed = materials.red.color.getHex();
    const originalSteel = materials.steelPainted.color.getHex();
    const enclosure = box(materials.steelPainted);
    const plannedGroup = new THREE.Group();
    plannedGroup.add(box(materials.red), box(materials.steelPainted));
    const completedGroup = new THREE.Group();
    completedGroup.add(box(materials.red));
    const applyPlanned = preparePanelEntityAppearance(plannedGroup, 'planned', palette);
    const applyCompleted = preparePanelEntityAppearance(completedGroup, 'completed', palette);
    applyPlanned(symbol('planned'), 'progress');
    applyCompleted(completed(symbol('completed')), 'progress');
    const plannedMaterial = (plannedGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const finishedMaterial = (completedGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(plannedMaterial).not.toBe(materials.red);
    expect(plannedMaterial.color.getHex()).not.toBe(originalRed);
    expect(finishedMaterial.color.getHex()).toBe(originalRed);
    expect(materials.red.color.getHex()).toBe(originalRed);
    expect((enclosure.material as THREE.MeshStandardMaterial).color.getHex()).toBe(originalSteel);
  });

  it('captures original materials once and restores them after repeated status/mode changes', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x1565c0, metalness: 0.72, roughness: 0.26, emissive: 0x021305 });
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geometry, material);
    const original = { color: material.color.getHex(), emissive: material.emissive.getHex() };
    const apply = preparePanelEntityAppearance(mesh, 'symbol-1');
    apply(symbol(), 'progress');
    const muted = material.color.getHex();
    for (let i = 0; i < 3; i++) {
      expect(preparePanelEntityAppearance(mesh, 'symbol-1')).toBe(apply);
      apply({ ...symbol(), position: { x: i * 10, y: 20 } }, 'progress');
      expect(material.color.getHex()).toBe(muted);
    }
    apply(completed(symbol()), 'progress');
    expect(material.color.getHex()).toBe(original.color);
    expect(material.emissive.getHex()).toBe(original.emissive);
    expect(material.metalness).toBe(0.72);
    expect(material.roughness).toBe(0.26);
    apply(symbol(), 'progress');
    apply(symbol(), 'materials');
    expect(material.color.getHex()).toBe(original.color);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.userData.installationStatus).toBe('planned');
  });

  it('keeps a wire geometry update incremental while restoring the cable jacket color', () => {
    const wire: WireEntity = { id: 'wire-1', kind: 'wire', layerId: 'wires', visible: true, locked: false, color: '#de3028', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const mesh = buildWireMesh(wire, 400)!;
    const geometry = mesh.geometry;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const color = material.color.getHex();
    const apply = preparePanelEntityAppearance(mesh, wire.id);
    apply(wire, 'progress');
    expect(updateWireGeometryInPlace(mesh, { ...wire, points: [{ x: 0, y: 0 }, { x: 120, y: 20 }] }, 400)).toBe(true);
    apply(completed(wire), 'progress');
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
    expect(material.color.getHex()).toBe(color);
    expect(mesh.userData.entityId).toBe(wire.id);
  });

  it('supports basic wireframe materials and preserves their physical opacity', () => {
    const material = new THREE.MeshBasicMaterial({ color: 0x43b687, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false });
    const mesh = box(material);
    const color = material.color.getHex();
    const apply = preparePanelEntityAppearance(mesh, 'symbol-1');
    apply(symbol(), 'progress');
    expect(material.color.getHex()).not.toBe(color);
    apply(symbol(), 'materials');
    expect(material.color.getHex()).toBe(color);
    expect(material.opacity).toBe(0.35);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });
});

describe('legacy panel picking', () => {
  it('finds tagged component descendants and ignores a hidden enclosing group', () => {
    const root = new THREE.Group();
    const component = new THREE.Group();
    const mesh = box(new THREE.MeshStandardMaterial());
    component.add(mesh);
    root.add(component);
    preparePanelEntityAppearance(component, 'symbol-1');
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1));
    expect(pickPanelEntity(root, ray)).toBe('symbol-1');
    component.visible = false;
    expect(pickPanelEntity(root, ray)).toBeNull();
  });

  it('does not select devices through a closed enclosure door', () => {
    const root = new THREE.Group();
    const component = box(new THREE.MeshStandardMaterial());
    preparePanelEntityAppearance(component, 'symbol-1');
    const door = box(new THREE.MeshStandardMaterial());
    door.position.z = 20;
    root.add(component, door);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1));
    expect(pickPanelEntity(root, ray)).toBeNull();
    door.visible = false;
    expect(pickPanelEntity(root, ray)).toBe('symbol-1');
  });
});
