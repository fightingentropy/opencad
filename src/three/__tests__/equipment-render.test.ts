import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderEquipment3D } from '../EquipmentRender3D';
import type { EquipmentEntity } from '../../types';

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
});
