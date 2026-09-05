import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ContainmentEntity, Entity, Project, Sheet } from '../../types';
import type { InstallationStatus } from '../../models/installation';
import { createInstallationAppearance } from '../InstallationAppearance';
import { buildBuildingScene } from '../BuildingScene';

const run = (id: string, status: InstallationStatus, systemId = 'power', y = 1000): ContainmentEntity => ({
  id, kind: 'containment', layerId: 'electrical', visible: true, locked: false,
  containmentType: 'tray', width: 200, height: 70, elevation: 2400,
  points: [{ x: 1000, y }, { x: 2600, y }], color: '#e95731', systemId,
  installation: { status, updatedAt: 1000, activities: [] },
});

const makeProject = (): Project => {
  const sheet = (id: string, floorId: string, entities: Entity[]): Sheet => ({
    id, floorId, buildingId: 'building', name: id, number: id, kind: 'floor-plan',
    width: 5000, height: 4000,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])), entityOrder: entities.map((entity) => entity.id),
  });
  const sheets = [sheet('ground-plan', 'ground', [
    run('done', 'completed'), run('planned', 'planned', 'power', 1800), run('active-data', 'in-progress', 'data', 2600),
    { id: 'wall', kind: 'wall', layerId: 'architecture', visible: true, locked: false,
      points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thickness: 200, height: 3000 },
    { id: 'room', kind: 'room', layerId: 'architecture', visible: true, locked: false,
      a: { x: 0, y: 0 }, b: { x: 4000, y: 3200 }, name: 'Electrical room' },
  ]), sheet('upper-plan', 'upper', [run('upper-done', 'completed')])];
  return {
    id: 'scene-test', name: 'Installation scene', created: 0, modified: 0,
    units: 'mm', standard: 'IEC', layers: {}, layerOrder: [], activeLayerId: 'electrical',
    sheets: Object.fromEntries(sheets.map((s) => [s.id, s])), sheetOrder: sheets.map((s) => s.id), activeSheetId: sheets[0].id,
    sites: { site: { id: 'site', name: 'Site', buildingOrder: ['building'] } }, activeSiteId: 'site',
    buildings: { building: { id: 'building', name: 'Building', siteId: 'site', floorOrder: ['ground', 'upper'] } },
    floors: {
      ground: { id: 'ground', name: 'Ground', level: 0, ffl: 0, floorHeight: 3400, buildingId: 'building', zoneOrder: [], sheetIds: ['ground-plan'] },
      upper: { id: 'upper', name: 'Upper', level: 1, ffl: 3400, floorHeight: 3400, buildingId: 'building', zoneOrder: [], sheetIds: ['upper-plan'] },
    },
    systems: {
      power: { id: 'power', name: 'Power', kind: 'power-distribution', color: '#f04020', band: 'II' },
      data: { id: 'data', name: 'Data', kind: 'data', color: '#287acf', band: 'I' },
    },
    cableSchedule: {
      cables: Object.fromEntries(['done', 'planned', 'active-data', 'upper-done'].map((id) => [id, {
        id, reference: `C-${id}`, from: 'A', to: 'B', circuitType: 'power', construction: 'XLPE/SWA/LSOH',
        cores: 3, csa: 2.5, hasEarth: true, outerDiameter: 12, voltage: 400, route: [id],
      }])),
      cableOrder: ['done', 'planned', 'active-data', 'upper-done'],
    },
  };
};

const materials = (root: THREE.Object3D): THREE.MeshStandardMaterial[] => {
  const result = new Set<THREE.MeshStandardMaterial>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (material instanceof THREE.MeshStandardMaterial) result.add(material);
    }
  });
  return [...result];
};

const visible = (object?: THREE.Object3D): boolean => {
  if (!object) return false;
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
};

const entityObject = (root: THREE.Object3D, id: string): THREE.Object3D | undefined => {
  let result: THREE.Object3D | undefined;
  root.traverse((obj) => {
    if (!result && obj.userData.entityId === id) result = obj;
  });
  return result;
};

describe('installation material views', () => {
  it('keeps completed route colours and mutes unfinished routes without changing project data', () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    const { group, controls } = buildBuildingScene(project);
    try {
      const done = materials(group.getObjectByName('containment:done')!);
      const planned = materials(group.getObjectByName('containment:planned')!);
      const doneColours = done.map((mat) => mat.color.clone());
      const plannedColours = planned.map((mat) => mat.color.clone());
      controls.setInstallation(project, 'progress', 'all');
      expect(done.length).toBeGreaterThan(0);
      expect(planned.length).toBeGreaterThan(0);
      expect(done.every((mat, i) => mat.color.equals(doneColours[i]))).toBe(true);
      expect(planned.some((mat, i) => !mat.color.equals(plannedColours[i]))).toBe(true);
      expect(planned.every((mat) => mat.metalness === 0.08 && mat.roughness === 0.88)).toBe(true);
      controls.setInstallation(project, 'materials', 'all');
      expect(planned.every((mat, i) => mat.color.equals(plannedColours[i]))).toBe(true);
      expect(JSON.stringify(project)).toBe(before);
    } finally { controls.dispose(); }
  });

  it('restores a newly completed part and updates its filter visibility without rebuilding its geometry', () => {
    const project = makeProject();
    const { group, controls } = buildBuildingScene(project);
    try {
      const route = group.getObjectByName('containment:planned')!;
      const palette = materials(route);
      const colours = palette.map((mat) => mat.color.clone());
      controls.setInstallation(project, 'progress', 'completed');
      expect(visible(route)).toBe(false);
      const next = structuredClone(project);
      next.sheets['ground-plan'].entities.planned.installation = {
        status: 'completed', completedAt: 2000, updatedAt: 2000, activities: [],
      };
      controls.setInstallation(next, 'progress', 'completed');
      expect(group.getObjectByName('containment:planned')).toBe(route);
      expect(visible(route)).toBe(true);
      expect(palette.every((mat, index) => mat.color.equals(colours[index]))).toBe(true);
      expect(project.sheets['ground-plan'].entities.planned.installation?.status).toBe('planned');
    } finally { controls.dispose(); }
  });

  it('separates shared palettes by owner while retaining sharing within each part', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xef5522, metalness: 0.71, roughness: 0.28,
      opacity: 0.65, transparent: true, depthWrite: false, emissive: 0x160502 });
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const root = new THREE.Group();
    const add = (id?: string) => {
      const g = new THREE.Group();
      if (id) g.userData.entityId = id;
      const a = new THREE.Mesh(geometry, material);
      const b = new THREE.Mesh(geometry, material);
      g.add(a, b);
      root.add(g);
      return [a, b];
    };
    const background = add();
    const done = add('done');
    const planned = add('planned');
    const apply = createInstallationAppearance(root);
    try {
      expect(done[0].material).toBe(done[1].material);
      expect(planned[0].material).toBe(planned[1].material);
      expect(done[0].material).not.toBe(planned[0].material);
      expect(background[0].material).not.toBe(planned[0].material);
      apply(makeProject(), 'progress');
      expect(done[0].material.color.equals(material.color)).toBe(true);
      expect(planned[0].material.color.equals(material.color)).toBe(false);
      expect(material.color.getHex()).toBe(0xef5522);
      apply(makeProject(), 'systems');
      expect(planned[0].material.color.getHexString()).toBe('f04020');
      apply(makeProject(), 'materials');
      for (const mat of [done[0].material, planned[0].material]) {
        expect(mat.color.equals(material.color)).toBe(true);
        expect(mat.emissive.equals(material.emissive)).toBe(true);
        expect(mat.opacity).toBe(0.65);
        expect(mat.transparent).toBe(true);
        expect(mat.depthWrite).toBe(false);
        expect(mat.metalness).toBe(0.71);
        expect(mat.roughness).toBe(0.28);
      }
    } finally {
      geometry.dispose();
      for (const mat of materials(root)) mat.dispose();
    }
  });
});

describe('installation scene filters and resources', () => {
  it('intersects floor, system and installation filters while retaining architectural context', () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    const { group, controls } = buildBuildingScene(project);
    try {
      controls.setInstallation(project, 'progress', 'completed');
      controls.filterSystem('power');
      controls.isolateFloor('ground');
      expect(visible(group.getObjectByName('containment:done'))).toBe(true);
      expect(visible(group.getObjectByName('containment:planned'))).toBe(false);
      expect(visible(group.getObjectByName('containment:active-data'))).toBe(false);
      expect(visible(group.getObjectByName('containment:upper-done'))).toBe(false);
      expect(visible(entityObject(group, 'wall'))).toBe(true);
      expect(visible(entityObject(group, 'room'))).toBe(true);
      controls.isolateFloor('upper');
      expect(visible(group.getObjectByName('containment:done'))).toBe(false);
      expect(visible(group.getObjectByName('containment:upper-done'))).toBe(true);
      controls.isolateFloor(null);
      controls.filterSystem('data');
      controls.setInstallation(project, 'progress', 'in-progress');
      expect(visible(group.getObjectByName('containment:active-data'))).toBe(true);
      expect(visible(group.getObjectByName('containment:done'))).toBe(false);
      expect(JSON.stringify(project)).toBe(before);
    } finally { controls.dispose(); }
  });

  it('keeps cable visibility tied to its route filters, with an independent cable toggle and isolation', () => {
    const project = makeProject();
    const { group, controls } = buildBuildingScene(project);
    try {
      const doneCable = group.getObjectByName('cables-in:done');
      const plannedCable = group.getObjectByName('cables-in:planned');
      expect(doneCable?.userData.renderedCableCount).toBe(1);
      expect(plannedCable?.userData.renderedCableCount).toBe(1);
      controls.setInstallation(project, 'progress', 'planned');
      controls.filterSystem('power');
      expect(visible(doneCable)).toBe(false);
      expect(visible(plannedCable)).toBe(true);
      controls.isolateEntity('planned');
      expect(visible(group.getObjectByName('containment:planned'))).toBe(true);
      expect(visible(plannedCable)).toBe(true);
      expect(visible(entityObject(group, 'wall'))).toBe(false);
      expect(visible(entityObject(group, 'room'))).toBe(false);
      controls.setLayerVisible('cables', false);
      expect(visible(plannedCable)).toBe(false);
      expect(visible(group.getObjectByName('containment:planned'))).toBe(true);
      controls.isolateEntity(null);
      controls.setInstallation(project, 'materials', 'all');
      controls.filterSystem(null);
      expect(visible(doneCable)).toBe(false);
      controls.setLayerVisible('cables', true);
      expect(visible(doneCable)).toBe(true);
      expect(visible(entityObject(group, 'wall'))).toBe(true);
    } finally { controls.dispose(); }
  });

  it('disposes shared mesh geometry, palette and texture resources once per scene', () => {
    const { group, controls } = buildBuildingScene(makeProject());
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
    const calls = { geometry: 0, material: 0, texture: 0 };
    geometry.addEventListener('dispose', () => calls.geometry++);
    material.addEventListener('dispose', () => calls.material++);
    texture.addEventListener('dispose', () => calls.texture++);
    group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    controls.dispose();
    expect(calls).toEqual({ geometry: 1, material: 1, texture: 1 });
  });
});
