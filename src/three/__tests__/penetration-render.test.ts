import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ContainmentEntity, PenetrationEntity, Project, WallEntity } from '../../types';
import type { Floor } from '../../models/site';
import { renderPenetration3D } from '../PenetrationRender3D';

const fixture = () => {
  const parent: ContainmentEntity = {
    id: 'route', kind: 'containment', layerId: 'electrical', visible: true, locked: false,
    containmentType: 'tray', systemId: 'power', width: 200, height: 80, elevation: 2400,
    points: [{ x: 0, y: 1000 }, { x: 2000, y: 1000 }],
  };
  const wall: WallEntity = {
    id: 'wall', kind: 'wall', layerId: 'architectural', visible: true, locked: false,
    points: [{ x: 1000, y: 0 }, { x: 1000, y: 2000 }], thickness: 200, height: 3000, fireRating: 120,
  };
  const entity: PenetrationEntity = {
    id: 'crossing', kind: 'penetration', layerId: 'electrical', visible: true, locked: false,
    position: { x: 1000, y: 1000 }, barrierEntityId: wall.id, penetrationOf: parent.id, sealId: 'seal',
  };
  const floor: Floor = {
    id: 'floor', name: 'Upper', buildingId: 'building', level: 1, ffl: 3500, floorHeight: 3500,
    sheetIds: ['sheet'], zoneOrder: [],
  };
  const project: Project = {
    id: 'project', name: 'Penetration fixture', created: 0, modified: 0, units: 'mm', standard: 'IEC',
    layers: {}, layerOrder: [], activeLayerId: 'electrical', activeSheetId: 'sheet', sheetOrder: ['sheet'],
    sheets: { sheet: {
      id: 'sheet', name: 'Plan', number: '01', kind: 'floor-plan', width: 4000, height: 3000, floorId: floor.id,
      entities: { route: parent, wall, crossing: entity }, entityOrder: ['route', 'wall', 'crossing'],
    } },
    penetrationSeals: { seal: {
      id: 'seal', reference: 'FS-001', boundaryEntityId: wall.id, penetrationEntityId: parent.id,
      crossingPoint: entity.position, requiredRating: 120, status: 'flagged', sealType: 'batt',
      openingWidth: 300, openingHeight: 180,
    } },
  };
  return { project, entity, parent, wall, floor };
};

const dispose = (object: THREE.Object3D) => {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometry.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometry.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
};

describe('penetration firestop geometry', () => {
  it('wraps the declared opening at the actual route elevation with selectable, bounded geometry', () => {
    const { project, entity, floor } = fixture();
    const before = JSON.stringify(project);
    const object = renderPenetration3D(entity, project, floor);
    try {
      expect(object.position.toArray()).toEqual([1000, 1000, 2440]);
      expect(object.userData.opening).toEqual({ width: 300, height: 180, depth: 200 });
      expect(object.userData.sealStatus).toBe('flagged');
      expect(object.userData.sealReference).toBe('FS-001');
      expect(object.userData.representation).toBe('illustrative-record-geometry');
      const meshes: THREE.Mesh[] = [];
      object.traverse((child) => {
        expect(child.userData.entityId).toBe(entity.id);
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.length).toBeLessThanOrEqual(6);
      expect(object.getObjectByName('firestop-infill')).toBeDefined();
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      expect(center.toArray()).toEqual([1000, 1000, 2440]);
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(500);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      // Framing and seal infill surround the opening instead of plugging the route.
      const hits = new THREE.Raycaster(new THREE.Vector3(700, 1000, 2440), new THREE.Vector3(1, 0, 0), 0, 600)
        .intersectObject(object, true);
      expect(hits).toHaveLength(0);
      expect(JSON.stringify(project)).toBe(before);
    } finally { dispose(object); }
  });

  it('accounts for diagonal wall crossing depth and reflects position and heading with flipY', () => {
    const { project, entity, parent, floor } = fixture();
    parent.points = [{ x: 0, y: 0 }, { x: 2000, y: 2000 }];
    const object = renderPenetration3D(entity, project, floor, 3000);
    try {
      expect(object.position.toArray()).toEqual([1000, 2000, 2440]);
      expect(object.rotation.z).toBeCloseTo(-Math.PI / 4);
      expect(object.userData.opening.depth).toBeCloseTo(200 * Math.SQRT2);
      expect(new THREE.Box3().setFromObject(object).isEmpty()).toBe(false);
    } finally { dispose(object); }
  });

  it('renders round conduit as an open collar with the correct conduit centre elevation', () => {
    const { project, entity, parent, floor } = fixture();
    parent.containmentType = 'conduit';
    parent.width = 40;
    parent.height = 900; // ignored for circular conduit
    project.penetrationSeals!.seal.openingWidth = 80;
    project.penetrationSeals!.seal.openingHeight = 80;
    project.penetrationSeals!.seal.sealType = 'collar';
    const object = renderPenetration3D(entity, project, floor);
    try {
      expect(object.position.z).toBe(2420);
      expect(object.getObjectByName('galvanised-collar')).toBeDefined();
      expect(object.children).toHaveLength(5);
      const hits = new THREE.Raycaster(new THREE.Vector3(700, 1000, 2420), new THREE.Vector3(1, 0, 0), 0, 600)
        .intersectObject(object, true);
      expect(hits).toHaveLength(0);
    } finally { dispose(object); }
  });

  it('preserves a recorded undersized opening instead of silently enlarging it or approving the seal', () => {
    const { project, entity, floor } = fixture();
    project.penetrationSeals!.seal.openingWidth = 150;
    const object = renderPenetration3D(entity, project, floor);
    try {
      expect(object.userData.opening.width).toBe(150);
      expect(object.userData.openingUndersized).toBe(true);
      expect(project.penetrationSeals!.seal.status).toBe('flagged');
      expect(project.penetrationSeals!.seal.achievedRating).toBeUndefined();
    } finally { dispose(object); }
  });

  it('returns an empty object for missing parents, invalid coordinates or degenerate route geometry', () => {
    const cases = [
      (f: ReturnType<typeof fixture>) => { delete f.project.sheets.sheet.entities.route; },
      (f: ReturnType<typeof fixture>) => { f.entity.position.x = NaN; },
      (f: ReturnType<typeof fixture>) => { f.parent.elevation = Infinity; },
      (f: ReturnType<typeof fixture>) => { f.parent.width = 1e100; },
      (f: ReturnType<typeof fixture>) => { f.parent.points = [{ x: 0, y: 0 }, { x: 0, y: 0 }]; },
      (f: ReturnType<typeof fixture>) => { f.wall.points = [{ x: 0, y: 1000 }, { x: 2000, y: 1000 }]; },
    ];
    for (const change of cases) {
      const f = fixture();
      change(f);
      const object = renderPenetration3D(f.entity, f.project, f.floor);
      expect(object.children).toHaveLength(0);
      expect(object.userData.entityId).toBe(f.entity.id);
    }
  });
});
