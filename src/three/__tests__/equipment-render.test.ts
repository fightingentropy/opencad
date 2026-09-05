import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderEquipment3D, setEquipmentOpen } from '../EquipmentRender3D';
import type { EquipmentEntity, EquipmentKind } from '../../types';

const equipment = (equipmentKind: EquipmentEntity['equipmentKind']): EquipmentEntity => ({
  id: `${equipmentKind}-1`,
  kind: 'equipment',
  layerId: 'equipment-layer',
  visible: true,
  locked: false,
  equipmentKind,
  a: { x: 0, y: 0 },
  b: { x: 800, y: 800 },
  tag: 'EQ-1',
  height: 1800,
});

const firstMesh = (root: THREE.Object3D): THREE.Mesh => {
  let mesh: THREE.Mesh | undefined;
  root.traverse((obj) => {
    if (!mesh && obj instanceof THREE.Mesh) mesh = obj;
  });
  if (!mesh) throw new Error('Expected at least one mesh');
  return mesh;
};

describe('renderEquipment3D', () => {
  it('renders comms racks as readable dark-grey cabinets rather than black blocks', () => {
    const obj = renderEquipment3D(equipment('comms-rack'), { showLabel: false });
    const material = firstMesh(obj).material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(0x343b46);
  });

  const kinds: EquipmentKind[] = [
    'distribution-board', 'mcc', 'panelboard', 'switchboard', 'transformer',
    'generator', 'ups', 'motor', 'pump', 'fan', 'air-handling-unit',
    'control-panel', 'fire-alarm-panel', 'comms-rack', 'cabinet',
    'enclosure', 'meter', 'busbar-tap-off', 'other',
  ];

  it.each(kinds)('%s keeps its closed physical assembly inside the equipment envelope', kind => {
    const eq = { ...equipment(kind), b: { x: 1200, y: 650 }, elevation: 175 };
    const closed = renderEquipment3D(eq, { showLabel: false });
    const bounds = new THREE.Box3().setFromObject(closed);
    const tolerance = 0.02;
    expect(bounds.min.x).toBeGreaterThanOrEqual(-tolerance);
    expect(bounds.max.x).toBeLessThanOrEqual(1200 + tolerance);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-tolerance);
    expect(bounds.max.y).toBeLessThanOrEqual(650 + tolerance);
    expect(bounds.min.z).toBeGreaterThanOrEqual(175 - tolerance);
    expect(bounds.max.z).toBeLessThanOrEqual(1975 + tolerance);
    let meshCount = 0;
    closed.traverse(part => {
      expect(part.userData.entityId).toBe(eq.id);
      if (part instanceof THREE.Mesh) {
        meshCount++;
        expect(part.userData.equipmentPart).toBeTruthy();
        expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      }
    });
    expect(meshCount).toBeLessThan(180);
    expect(meshCount).toBeGreaterThan(10);
  });

  it('opens real hinged doors, exposes internals, and closes to the same envelope', () => {
    const eq = equipment('distribution-board');
    const model = renderEquipment3D(eq, { showLabel: false });
    const before = new THREE.Box3().setFromObject(model);
    const door = model.getObjectByName('hinged-door')!;
    const panel = model.getObjectByName('door-panel')!;
    const originalPosition = panel.getWorldPosition(new THREE.Vector3());
    const backplate = model.getObjectByName('backplate')!;
    const backplatePosition = backplate.getWorldPosition(new THREE.Vector3());
    expect(model.getObjectByName('DIN-rail')).toBeDefined();
    expect(model.getObjectByName('circuit-breaker')).toBeInstanceOf(THREE.InstancedMesh);
    expect(model.getObjectByName('copper-busbar')).toBeDefined();
    expect(model.getObjectByName('cable-gland')).toBeDefined();
    expect(model.getObjectByName('phase-conductor')).toBeDefined();
    setEquipmentOpen(model, true);
    expect(door.rotation.z).toBeLessThan(-Math.PI / 2);
    expect(panel.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(originalPosition.y - 200);
    expect(backplate.getWorldPosition(new THREE.Vector3()).equals(backplatePosition)).toBe(true);
    const openBounds = new THREE.Box3().setFromObject(model);
    expect(openBounds.min.y).toBeLessThan(before.min.y);
    expect(openBounds.min.toArray().every(Number.isFinite)).toBe(true);
    setEquipmentOpen(model, false);
    expect(new THREE.Box3().setFromObject(model).equals(before)).toBe(true);
  });

  it.each(kinds)('%s retains a finite bounded model for a shallow footprint', kind => {
    const model = renderEquipment3D({ ...equipment(kind), b: { x: 1200, y: 80 } }, { showLabel: false });
    const bounds = new THREE.Box3().setFromObject(model);
    expect(bounds.min.toArray().every(Number.isFinite)).toBe(true);
    expect(bounds.max.toArray().every(Number.isFinite)).toBe(true);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(bounds.max.y).toBeLessThanOrEqual(80.02);
    setEquipmentOpen(model, true);
    const open = new THREE.Box3().setFromObject(model);
    expect(open.min.toArray().every(Number.isFinite)).toBe(true);
    expect(open.max.toArray().every(Number.isFinite)).toBe(true);
  });

  it('rotates the complete assembly, preserving door and interior alignment', () => {
    const eq = { ...equipment('distribution-board'), b: { x: 1200, y: 600 } };
    const ordinary = renderEquipment3D(eq, { showLabel: false });
    const rotated = renderEquipment3D({ ...eq, rotation: Math.PI / 2 }, { showLabel: false });
    for (const name of ['door-panel', 'backplate', 'copper-busbar', 'cable-gland']) {
      const a = ordinary.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
      const b = rotated.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
      expect(b.x).toBeCloseTo(600 - (a.y - 300), 4);
      expect(b.y).toBeCloseTo(300 + (a.x - 600), 4);
      expect(b.z).toBeCloseTo(a.z, 4);
    }
    const flipped = renderEquipment3D({ ...eq, rotation: Math.PI / 2 }, { showLabel: false, flipY: 5000 });
    expect(flipped.position.y).toBe(4700);
    expect(flipped.rotation.z).toBe(-Math.PI / 2);
  });

  it('owns materials and geometry independently so disposing another scene is safe', () => {
    const first = renderEquipment3D(equipment('distribution-board'), { showLabel: false });
    const second = renderEquipment3D(equipment('distribution-board'), { showLabel: false });
    const firstGeometries = new Set<THREE.BufferGeometry>();
    const firstMaterials = new Set<THREE.Material>();
    first.traverse(part => {
      if (!(part instanceof THREE.Mesh)) return;
      firstGeometries.add(part.geometry);
      for (const mat of Array.isArray(part.material) ? part.material : [part.material]) firstMaterials.add(mat);
    });
    let foreignDisposals = 0;
    second.traverse(part => {
      if (!(part instanceof THREE.Mesh)) return;
      expect(firstGeometries.has(part.geometry)).toBe(false);
      part.geometry.addEventListener('dispose', () => foreignDisposals++);
      for (const mat of Array.isArray(part.material) ? part.material : [part.material]) {
        expect(firstMaterials.has(mat)).toBe(false);
        mat.addEventListener('dispose', () => foreignDisposals++);
      }
    });
    firstGeometries.forEach(geometry => geometry.dispose());
    firstMaterials.forEach(material => material.dispose());
    expect(foreignDisposals).toBe(0);
    expect(new THREE.Box3().setFromObject(second).isEmpty()).toBe(false);
  });

  it('uses identifiable mechanical geometry and modular MCC compartments', () => {
    const models: [EquipmentKind, string][] = [
      ['transformer', 'HV-bushing'], ['generator', 'exhaust-stack'],
      ['motor', 'motor-cooling-fin'], ['pump', 'pump-volute'],
      ['fan', 'fan-guard-ring'], ['comms-rack', 'network-port'],
    ];
    for (const [kind, part] of models) {
      expect(renderEquipment3D(equipment(kind), { showLabel: false }).getObjectByName(part)).toBeDefined();
    }
    const mcc = renderEquipment3D(equipment('mcc'), { showLabel: false, openPanels: true });
    let doors = 0;
    mcc.traverse(part => {
      if (!part.userData.equipmentDoor) return;
      doors++;
      expect(part.userData.open).toBe(true);
    });
    expect(doors).toBe(9);
  });
});
