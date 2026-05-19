import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBuildingScene } from '../BuildingScene';
import { createWholeSiteSampleProject } from '../../sample-whole-site';
import type {
  ContainmentEntity,
  EquipmentEntity,
  Entity,
  FittingEntity,
  Project,
  RiserEntity,
  RoomEntity,
  Sheet,
  SupportEntity,
  WallEntity,
} from '../../types';

const makeProject = (entities: Entity[], sheetPatch: Partial<Sheet> = {}): { project: Project; sheet: Sheet } => {
  const sheet: Sheet = {
    id: 'sheet-1',
    name: 'Floor Plan',
    number: 'A-100',
    kind: 'floor-plan',
    width: 1000,
    height: 1000,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    entityOrder: entities.map((e) => e.id),
    floorId: 'floor-1',
    buildingId: 'building-1',
    ...sheetPatch,
  };
  const project: Project = {
    id: 'project-1',
    name: 'Scene test',
    created: 0,
    modified: 0,
    layers: {},
    layerOrder: [],
    sheets: { [sheet.id]: sheet },
    sheetOrder: [sheet.id],
    activeSheetId: sheet.id,
    activeLayerId: 'containment-layer',
    units: 'mm',
    standard: 'IEC',
    sites: {
      'site-1': {
        id: 'site-1',
        name: 'Site',
        buildingOrder: ['building-1'],
      },
    },
    buildings: {
      'building-1': {
        id: 'building-1',
        siteId: 'site-1',
        name: 'Building',
        floorOrder: ['floor-1'],
      },
    },
    floors: {
      'floor-1': {
        id: 'floor-1',
        buildingId: 'building-1',
        name: 'Ground',
        level: 0,
        ffl: 0,
        floorHeight: 3500,
        zoneOrder: [],
        sheetIds: [sheet.id],
      },
    },
    activeSiteId: 'site-1',
    activeBuildingId: 'building-1',
    activeFloorId: 'floor-1',
  };
  return { project, sheet };
};

const findObject = (root: THREE.Object3D, predicate: (obj: THREE.Object3D) => boolean): THREE.Object3D | undefined => {
  let found: THREE.Object3D | undefined;
  root.traverse((obj) => {
    if (!found && predicate(obj)) found = obj;
  });
  return found;
};

describe('buildBuildingScene', () => {
  it('adds a finished-floor datum marker to the rendered floor', () => {
    const { project } = makeProject([]);

    const { group } = buildBuildingScene(project);

    const marker = group.getObjectByName('ffl-markers');
    expect(marker).toBeDefined();
    expect(marker?.getObjectByName('ffl-baseline')).toBeDefined();
    expect(marker?.getObjectByName('ffl-ruler')).toBeDefined();
    expect(marker?.getObjectByName('ffl-perimeter:0')).toBeDefined();
    expect(marker?.getObjectByName('ffl-tick:1000')).toBeDefined();
  });

  it('keeps support hardware aligned with its flipped containment run', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 200 },
        { x: 500, y: 200 },
      ],
      width: 200,
      height: 50,
      elevation: 2400,
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 300, y: 200 },
      rotation: 0,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      rodLength: 600,
      channelLength: 300,
    };
    const { project, sheet } = makeProject([containment, support]);

    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const containmentObj = group.getObjectByName(`containment:${containment.id}`);
    const supportObj = group.getObjectByName(`support:${support.id}`);
    expect(containmentObj).toBeDefined();
    expect(supportObj).toBeDefined();

    const containmentCenter = new THREE.Vector3();
    const supportCenter = new THREE.Vector3();
    const supportSize = new THREE.Vector3();
    new THREE.Box3().setFromObject(containmentObj!).getCenter(containmentCenter);
    const supportBox = new THREE.Box3().setFromObject(supportObj!);
    supportBox.getCenter(supportCenter);
    supportBox.getSize(supportSize);

    expect(supportCenter.x).toBeCloseTo(containmentCenter.x, 4);
    expect(supportCenter.y).toBeCloseTo(containmentCenter.y, 4);
    expect(supportSize.y).toBeGreaterThan(supportSize.x);
  });

  it('keeps manual trapeze rods outside the containment side faces', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'trunking',
      points: [
        { x: 100, y: 200 },
        { x: 900, y: 200 },
      ],
      width: 400,
      height: 100,
      elevation: 2400,
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 500, y: 200 },
      rotation: Math.PI / 2,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      rodLength: 600,
      channelLength: 500,
      autoGenerated: false,
    };
    const { project, sheet } = makeProject([containment, support]);

    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const containmentObj = group.getObjectByName(`containment:${containment.id}`);
    const supportObj = group.getObjectByName(`support:${support.id}`);
    expect(containmentObj).toBeDefined();
    expect(supportObj).toBeDefined();

    const containmentBox = new THREE.Box3().setFromObject(containmentObj!);
    const containmentSize = new THREE.Vector3();
    const supportSize = new THREE.Vector3();
    containmentBox.getSize(containmentSize);
    new THREE.Box3().setFromObject(supportObj!).getSize(supportSize);

    expect(supportSize.y).toBeGreaterThan(containmentSize.y + 300);

    const rodPositions: THREE.Vector3[] = [];
    supportObj!.traverse((obj) => {
      if (obj.userData.supportPart === 'hanger-rod') {
        rodPositions.push(obj.getWorldPosition(new THREE.Vector3()));
      }
    });
    expect(rodPositions).toHaveLength(2);
    for (const rodPosition of rodPositions) {
      const clearance = rodPosition.y < containmentBox.min.y
        ? containmentBox.min.y - rodPosition.y
        : rodPosition.y - containmentBox.max.y;
      expect(clearance).toBeGreaterThan(140);
    }
  });

  it('hides vertical hanger rods for auto-generated route supports', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'trunking',
      points: [
        { x: 100, y: 200 },
        { x: 900, y: 200 },
      ],
      width: 100,
      height: 100,
      elevation: 2400,
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 500, y: 200 },
      rotation: 0,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      rodLength: 600,
      channelLength: 460,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([containment, support]);

    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const supportObj = group.getObjectByName(`support:${support.id}`);
    expect(supportObj).toBeDefined();

    const rods: THREE.Object3D[] = [];
    const channels: THREE.Object3D[] = [];
    supportObj!.traverse((obj) => {
      if (obj.userData.supportPart === 'hanger-rod') rods.push(obj);
      if (obj.userData.supportPart === 'support-channel') channels.push(obj);
    });

    expect(rods).toHaveLength(0);
    expect(channels.length).toBeGreaterThan(0);
  });

  it('renders legacy auto wall brackets as centred trapeze hangers', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 200 },
        { x: 700, y: 200 },
      ],
      width: 200,
      height: 50,
      elevation: 2400,
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'wall-bracket',
      position: { x: 400, y: 200 },
      rotation: 0,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      channelLength: 250,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([containment, support]);

    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const containmentObj = group.getObjectByName(`containment:${containment.id}`);
    const supportObj = group.getObjectByName(`support:${support.id}`);
    expect(containmentObj).toBeDefined();
    expect(supportObj).toBeDefined();

    const containmentCenter = new THREE.Vector3();
    const supportCenter = new THREE.Vector3();
    const containmentSize = new THREE.Vector3();
    const supportSize = new THREE.Vector3();
    new THREE.Box3().setFromObject(containmentObj!).getCenter(containmentCenter);
    new THREE.Box3().setFromObject(containmentObj!).getSize(containmentSize);
    const supportBox = new THREE.Box3().setFromObject(supportObj!);
    supportBox.getCenter(supportCenter);
    supportBox.getSize(supportSize);

    expect(Math.abs(supportCenter.x - containmentCenter.x)).toBeLessThan(25);
    expect(Math.abs(supportCenter.y - containmentCenter.y)).toBeLessThan(25);
    expect(supportSize.y).toBeGreaterThanOrEqual(containmentSize.y + 110);
    expect(supportSize.y).toBeLessThanOrEqual(containmentSize.y + 130);
  });

  it('keeps fittings aligned with their flipped containment instead of double-translating them', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'trunking',
      points: [
        { x: 100, y: 200 },
        { x: 500, y: 200 },
      ],
      width: 200,
      height: 100,
      elevation: 2400,
    };
    const fitting: FittingEntity = {
      id: 'fitting-1',
      kind: 'fitting',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      fittingKind: 'coupler',
      position: { x: 300, y: 200 },
      rotation: 0,
      containmentId: containment.id,
      width: 200,
      height: 100,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([containment, fitting]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const fittingObj = group.getObjectByName(`fitting:${fitting.id}`);
    expect(fittingObj).toBeDefined();

    const fittingCenter = new THREE.Vector3();
    new THREE.Box3().setFromObject(fittingObj!).getCenter(fittingCenter);

    expect(fittingCenter.x).toBeCloseTo(fitting.position.x, 4);
    expect(fittingCenter.y).toBeCloseTo(sheet.height - fitting.position.y, 4);
  });

  it('does not render stale auto end caps where a tray branch joins another tray', () => {
    const spine: ContainmentEntity = {
      id: 'spine',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 500 },
        { x: 500, y: 500 },
        { x: 900, y: 500 },
      ],
      width: 200,
      height: 80,
      elevation: 2400,
    };
    const branch: ContainmentEntity = {
      id: 'branch',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 500, y: 500 },
        { x: 500, y: 900 },
      ],
      width: 100,
      height: 50,
      elevation: 2400,
    };
    const staleCap: FittingEntity = {
      id: 'stale-cap',
      kind: 'fitting',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      fittingKind: 'end-cap',
      position: { x: 500, y: 500 },
      rotation: 0,
      containmentId: branch.id,
      width: branch.width,
      height: branch.height,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([spine, branch, staleCap]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });

    expect(group.getObjectByName(`fitting:${staleCap.id}`)).toBeUndefined();
  });

  it('does not render auto flat bends as separate 3D artifacts', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'trunking',
      points: [
        { x: 100, y: 200 },
        { x: 500, y: 200 },
        { x: 500, y: 600 },
      ],
      width: 100,
      height: 100,
      elevation: 2400,
    };
    const bend: FittingEntity = {
      id: 'auto-bend',
      kind: 'fitting',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      fittingKind: 'flat-bend',
      position: { x: 500, y: 200 },
      rotation: 0,
      containmentId: containment.id,
      width: containment.width,
      height: containment.height,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([containment, bend]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });

    expect(group.getObjectByName(`fitting:${bend.id}`)).toBeUndefined();
  });

  it('adds vertical drops where high-level containment terminates on equipment', () => {
    const basket: ContainmentEntity = {
      id: 'basket-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'basket',
      points: [
        { x: 100, y: 500 },
        { x: 500, y: 500 },
      ],
      width: 200,
      height: 100,
      elevation: 2600,
      systemId: 'sys-data',
    };
    const rack: EquipmentEntity = {
      id: 'rack-1',
      kind: 'equipment',
      layerId: 'equipment-layer',
      visible: true,
      locked: false,
      equipmentKind: 'comms-rack',
      a: { x: 425, y: 425 },
      b: { x: 575, y: 575 },
      tag: 'IDF-1',
      height: 1800,
      systemId: 'sys-data',
    };
    const { project } = makeProject([basket, rack]);
    const { group, controls } = buildBuildingScene(project);
    group.updateMatrixWorld(true);

    const drop = group.getObjectByName(`equipment-drop:${basket.id}:${rack.id}`);
    expect(drop).toBeDefined();
    const box = new THREE.Box3().setFromObject(drop!);
    expect(box.min.z).toBeCloseTo(1800, 0);
    expect(box.max.z).toBeCloseTo(2600, 0);

    controls.filterSystem('other-system');
    expect(drop!.visible).toBe(false);
    controls.filterSystem('sys-data');
    expect(drop!.visible).toBe(true);
  });

  it('does not turn low-level duct entries into equipment drops', () => {
    const duct: ContainmentEntity = {
      id: 'duct-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'duct',
      subType: 'underground-duct',
      points: [
        { x: 100, y: 500 },
        { x: 500, y: 500 },
      ],
      width: 300,
      height: 100,
      elevation: 2600,
      systemId: 'sys-power',
    };
    const panel: EquipmentEntity = {
      id: 'panel-1',
      kind: 'equipment',
      layerId: 'equipment-layer',
      visible: true,
      locked: false,
      equipmentKind: 'distribution-board',
      a: { x: 425, y: 425 },
      b: { x: 575, y: 575 },
      tag: 'DB-1',
      height: 1800,
      systemId: 'sys-power',
    };
    const { project } = makeProject([duct, panel]);
    const { group } = buildBuildingScene(project);

    expect(group.getObjectByName(`equipment-drop:${duct.id}:${panel.id}`)).toBeUndefined();
  });

  it('sizes the floor slab to the building shell instead of a huge generic plane', () => {
    const room: RoomEntity = {
      id: 'room-1',
      kind: 'room',
      layerId: 'room-layer',
      visible: true,
      locked: false,
      a: { x: 0, y: 0 },
      b: { x: 1200, y: 800 },
      name: 'Room',
    };
    const wall: WallEntity = {
      id: 'wall-1',
      kind: 'wall',
      layerId: 'wall-layer',
      visible: true,
      locked: false,
      points: [
        { x: 0, y: 0 },
        { x: 1200, y: 0 },
        { x: 1200, y: 800 },
        { x: 0, y: 800 },
        { x: 0, y: 0 },
      ],
      thickness: 100,
      height: 3000,
      external: true,
    };
    const { project, sheet } = makeProject([room, wall]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const slab = findObject(group, (obj) => obj.userData.layer === 'floors');
    expect(slab).toBeDefined();

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const slabBox = new THREE.Box3().setFromObject(slab!);
    slabBox.getCenter(center);
    slabBox.getSize(size);

    expect(size.x).toBeLessThan(5000);
    expect(size.y).toBeLessThan(5000);
    expect(center.x).toBeCloseTo(600, 4);
    expect(center.y).toBeCloseTo(600, 4);
  });

  it('sizes sparse floors around containment when no architectural shell exists', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 200 },
        { x: 500, y: 200 },
      ],
      width: 200,
      height: 50,
      elevation: 2400,
    };
    const { project, sheet } = makeProject([containment]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });
    group.updateMatrixWorld(true);

    const slab = findObject(group, (obj) => obj.userData.layer === 'floors');
    expect(slab).toBeDefined();

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const slabBox = new THREE.Box3().setFromObject(slab!);
    slabBox.getCenter(center);
    slabBox.getSize(size);

    expect(size.x).toBeLessThan(5000);
    expect(size.y).toBeLessThan(5000);
    expect(center.x).toBeCloseTo(300, 4);
    expect(center.y).toBeCloseTo(800, 4);
  });

  it('filters support hardware with the parent containment system', () => {
    const containment: ContainmentEntity = {
      id: 'containment-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 200 },
        { x: 500, y: 200 },
      ],
      width: 200,
      height: 50,
      elevation: 2400,
      systemId: 'sys-a',
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 300, y: 200 },
      rotation: 0,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      rodLength: 600,
      channelLength: 300,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([containment, support]);
    const { group, controls } = buildBuildingScene(project, { flipY: sheet.height });

    const containmentObj = group.getObjectByName(`containment:${containment.id}`);
    const supportObj = group.getObjectByName(`support:${support.id}`);
    expect(containmentObj).toBeDefined();
    expect(supportObj).toBeDefined();

    controls.filterSystem('sys-b');
    expect(containmentObj!.visible).toBe(false);
    expect(supportObj!.visible).toBe(false);

    controls.filterSystem('sys-a');
    expect(containmentObj!.visible).toBe(true);
    expect(supportObj!.visible).toBe(true);
  });

  it('does not render orphaned auto-generated supports', () => {
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 300, y: 200 },
      rotation: 0,
      supportingContainmentIds: ['missing-containment'],
      elevation: 2400,
      rodLength: 600,
      channelLength: 300,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([support]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });

    expect(group.getObjectByName(`support:${support.id}`)).toBeUndefined();
  });

  it('does not render conduit route aids or old auto saddle clips in 3D', () => {
    const conduit: ContainmentEntity = {
      id: 'conduit-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'conduit',
      points: [
        { x: 100, y: 200 },
        { x: 900, y: 200 },
      ],
      width: 32,
      elevation: 1800,
    };
    const support: SupportEntity = {
      id: 'support-1',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'saddle-clip',
      position: { x: 500, y: 200 },
      rotation: 0,
      supportingContainmentIds: [conduit.id],
      elevation: 1800,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([conduit, support]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });

    expect(group.getObjectByName(`containment:${conduit.id}`)).toBeUndefined();
    expect(group.getObjectByName(`support:${support.id}`)).toBeUndefined();
  });

  it('does not render auto fittings for conduit route aids', () => {
    const wall: WallEntity = {
      id: 'wall-1',
      kind: 'wall',
      layerId: 'wall-layer',
      visible: true,
      locked: false,
      points: [
        { x: 0, y: 100 },
        { x: 1000, y: 100 },
      ],
      thickness: 100,
      height: 3000,
    };
    const conduit: ContainmentEntity = {
      id: 'conduit-1',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'conduit',
      points: [
        { x: 100, y: 400 },
        { x: 900, y: 400 },
      ],
      width: 32,
      elevation: 1800,
    };
    const fitting: FittingEntity = {
      id: 'fitting-1',
      kind: 'fitting',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      fittingKind: 'coupler',
      position: { x: 500, y: 400 },
      rotation: 0,
      containmentId: conduit.id,
      width: 32,
      autoGenerated: true,
    };
    const { project } = makeProject([wall, conduit, fitting]);
    const { group } = buildBuildingScene(project);

    expect(group.getObjectByName(`containment:${conduit.id}`)).toBeUndefined();
    expect(group.getObjectByName(`fitting:${fitting.id}`)).toBeUndefined();
  });

  it('cuts wall openings where two rendered trays cross the wall', () => {
    const wall: WallEntity = {
      id: 'wall-1',
      kind: 'wall',
      layerId: 'wall-layer',
      visible: true,
      locked: false,
      points: [
        { x: 500, y: 0 },
        { x: 500, y: 1000 },
      ],
      thickness: 100,
      height: 3000,
    };
    const trayA: ContainmentEntity = {
      id: 'tray-a',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 250 },
        { x: 900, y: 250 },
      ],
      width: 100,
      height: 80,
      elevation: 2400,
    };
    const trayB: ContainmentEntity = {
      id: 'tray-b',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 100, y: 750 },
        { x: 900, y: 750 },
      ],
      width: 100,
      height: 80,
      elevation: 2400,
    };
    const { project } = makeProject([wall, trayA, trayB]);
    const { group } = buildBuildingScene(project);
    group.updateMatrixWorld(true);

    const wallMeshes: THREE.Mesh[] = [];
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.entityId === wall.id) {
        wallMeshes.push(obj);
      }
    });

    const blockersAt = (point: THREE.Vector3): THREE.Mesh[] => wallMeshes.filter((mesh) => (
      new THREE.Box3().setFromObject(mesh).containsPoint(point)
    ));

    expect(wallMeshes.length).toBeGreaterThan(1);
    expect(blockersAt(new THREE.Vector3(500, 250, 2440))).toHaveLength(0);
    expect(blockersAt(new THREE.Vector3(500, 750, 2440))).toHaveLength(0);
    expect(blockersAt(new THREE.Vector3(500, 500, 2440)).length).toBeGreaterThan(0);
  });

  it('does not render service objects outside a drawn building shell', () => {
    const room: RoomEntity = {
      id: 'room-1',
      kind: 'room',
      layerId: 'room-layer',
      visible: true,
      locked: false,
      a: { x: 0, y: 0 },
      b: { x: 1200, y: 800 },
      name: 'Room',
    };
    const wall: WallEntity = {
      id: 'wall-1',
      kind: 'wall',
      layerId: 'wall-layer',
      visible: true,
      locked: false,
      points: [
        { x: 0, y: 0 },
        { x: 1200, y: 0 },
        { x: 1200, y: 800 },
        { x: 0, y: 800 },
        { x: 0, y: 0 },
      ],
      thickness: 100,
      height: 3000,
      external: true,
    };
    const containment: ContainmentEntity = {
      id: 'containment-outside',
      kind: 'containment',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      containmentType: 'tray',
      points: [
        { x: 5000, y: 5000 },
        { x: 5600, y: 5000 },
      ],
      width: 200,
      height: 50,
      elevation: 2400,
    };
    const support: SupportEntity = {
      id: 'support-outside',
      kind: 'support',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      supportKind: 'trapeze-hanger',
      position: { x: 5300, y: 5000 },
      rotation: 0,
      supportingContainmentIds: [containment.id],
      elevation: 2400,
      rodLength: 600,
      channelLength: 300,
      autoGenerated: true,
    };
    const { project, sheet } = makeProject([room, wall, containment, support]);
    const { group } = buildBuildingScene(project, { flipY: sheet.height });

    expect(group.getObjectByName(`containment:${containment.id}`)).toBeUndefined();
    expect(group.getObjectByName(`support:${support.id}`)).toBeUndefined();
  });

  it('keeps small conduit control routes out of the exposed 3D tray layer', () => {
    const project = createWholeSiteSampleProject();
    const conduitRoutes = Object.values(project.sheets)
      .flatMap((sheet) => sheet.entityOrder.map((id) => sheet.entities[id]))
      .filter((entity): entity is ContainmentEntity => (
        entity?.kind === 'containment' &&
        entity.containmentType === 'conduit' &&
        !!(
          entity.label?.includes('FP200') ||
          entity.label?.includes('security') ||
          entity.label?.includes('BMS')
        )
      ));

    expect(conduitRoutes.length).toBeGreaterThan(0);

    const { group } = buildBuildingScene(project);

    for (const conduit of conduitRoutes) {
      expect(group.getObjectByName(`containment:${conduit.id}`)).toBeUndefined();
    }
  });

  it('does not put hanger rods through generated whole-site containment', () => {
    const project = createWholeSiteSampleProject();
    const { group } = buildBuildingScene(project, { layers: { equipment: false } });
    group.updateMatrixWorld(true);

    const supports: THREE.Object3D[] = [];
    const rods: THREE.Object3D[] = [];
    const channels: THREE.Object3D[] = [];
    group.traverse((obj) => {
      if (obj.name.startsWith('support:')) supports.push(obj);
      if (obj.userData.supportPart === 'hanger-rod') rods.push(obj);
      if (obj.userData.supportPart === 'support-channel') channels.push(obj);
    });

    expect(supports.length).toBeGreaterThan(0);
    expect(channels.length).toBeGreaterThan(0);
    expect(rods).toHaveLength(0);
  });

  it('renders corporate corridor trunking and baskets as straight parallel lanes', () => {
    const project = createWholeSiteSampleProject();
    const containments = Object.values(project.sheets)
      .flatMap((sheet) => sheet.entityOrder.map((id) => sheet.entities[id]))
      .filter((entity): entity is ContainmentEntity => entity?.kind === 'containment');
    const trunking = containments.find((c) => c.label === 'Level 2 power trunking — 300×150');
    const dataBasket = containments.find((c) => c.label === 'Level 2 data basket — 300×100');
    const lightingBasket = containments.find((c) => c.label === 'Level 2 lighting basket — 150×100');
    expect(trunking).toBeDefined();
    expect(dataBasket).toBeDefined();
    expect(lightingBasket).toBeDefined();

    const { group } = buildBuildingScene(project, { layers: { equipment: false, supports: false } });
    group.updateMatrixWorld(true);

    const trunkingBox = new THREE.Box3().setFromObject(group.getObjectByName(`containment:${trunking!.id}`)!);
    const dataBox = new THREE.Box3().setFromObject(group.getObjectByName(`containment:${dataBasket!.id}`)!);
    const lightingBox = new THREE.Box3().setFromObject(group.getObjectByName(`containment:${lightingBasket!.id}`)!);

    expect(Math.abs(dataBox.min.x - trunkingBox.min.x)).toBeLessThan(10);
    expect(Math.abs(dataBox.max.x - trunkingBox.max.x)).toBeLessThan(10);
    expect(Math.abs(lightingBox.min.x - trunkingBox.min.x)).toBeLessThan(10);
    expect(Math.abs(lightingBox.max.x - trunkingBox.max.x)).toBeLessThan(10);
    expect(dataBox.max.y).toBeLessThan(trunkingBox.min.y);
    expect(lightingBox.min.y).toBeGreaterThan(trunkingBox.max.y);
    expect(trunkingBox.min.y - dataBox.max.y).toBeGreaterThanOrEqual(250);
    expect(lightingBox.min.y - trunkingBox.max.y).toBeGreaterThanOrEqual(250);
  });

  it('puts risers inside the owning floor group so floor isolation hides the rest', () => {
    const riser: RiserEntity = {
      id: 'riser-1',
      kind: 'riser',
      layerId: 'containment-layer',
      visible: true,
      locked: false,
      position: { x: 300, y: 200 },
      width: 200,
      height: 100,
      containmentType: 'tray',
      fromFloorId: 'floor-1',
      toFloorId: 'floor-2',
    };
    const { project, sheet } = makeProject([riser]);
    const upperSheet: Sheet = {
      ...sheet,
      id: 'sheet-2',
      entities: {},
      entityOrder: [],
      floorId: 'floor-2',
    };
    project.sheets[upperSheet.id] = upperSheet;
    project.sheetOrder.push(upperSheet.id);
    project.floors!['floor-2'] = {
      id: 'floor-2',
      buildingId: 'building-1',
      name: 'Level 1',
      level: 1,
      ffl: 3300,
      floorHeight: 3500,
      zoneOrder: [],
      sheetIds: [upperSheet.id],
    };
    project.buildings!['building-1'].floorOrder.push('floor-2');

    const { group, controls } = buildBuildingScene(project, { flipY: sheet.height });
    const lowerFloor = group.getObjectByName('floor:floor-1');
    const upperFloor = group.getObjectByName('floor:floor-2');
    const riserObj = lowerFloor?.getObjectByName(`riser:${riser.id}`);
    expect(riserObj).toBeDefined();

    controls.isolateFloor('floor-2');
    expect(lowerFloor!.visible).toBe(false);
    expect(upperFloor!.visible).toBe(true);
  });
});
