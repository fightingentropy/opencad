// Whole-site sample project — a realistic multi-floor demo that
// exercises the site / building / floor / zone hierarchy along with
// containment, equipment, cable schedule, fire compartments and the QA
// inspection workflow. Used as the first-run experience so a new user
// sees the full data model populated rather than an empty canvas.

import { nanoid } from 'nanoid';
import { createEmptyProject, newEntityId } from './state/store';
import { createSampleCableSchedule } from './sample-cables';
import { DEFAULT_STANDARDS } from './models/standards';
import { emptyCableSchedule } from './models/cable';
import { loadDefaultCatalogues } from './data/catalogues';
import type {
  Project,
  Entity,
  Sheet,
  SheetId,
  LayerId,
  Vec2,
  ContainmentType,
  EntityId,
  EquipmentEntity,
  ContainmentEntity,
  FittingEntity,
  SupportEntity,
  PenetrationEntity,
  WallEntity,
  RoomEntity,
  RiserEntity,
  TextEntity,
  LeaderEntity,
  NorthArrowEntity,
  ScaleBarEntity,
  GridLineEntity,
} from './types';
import {
  autoPlaceFittingsForContainment,
  autoPlaceSupportsForContainment,
  autoDetectPenetrationsForContainment,
} from './lib/auto-features';
import { buildContainmentGraph } from './lib/containment-graph';
import { routeCableThroughGraph } from './lib/cable-router';
import type {
  Site,
  Building,
  Floor,
  Zone,
  ElectricalSystem,
  SystemId,
  ZoneClassification,
} from './models/site';
import type { PenetrationSeal, ITPItem } from './models/fire';
import type { SheetMeta } from './models/revision';
import { assembleDrawingNumber } from './drawing/numbering';

const newId = (): string => nanoid(10);

// ---------- Identifier conventions ---------------------------------------
//
// Equipment tags follow a simple project-wide scheme:
//   MSB-01            Main LV switchboard
//   DB-LG / DB-L01    Floor distribution boards
//   DB-RF             Roof plant distribution board
//   FAP-01            Fire alarm panel
//   CR-01             Communications rack
//   IDF-L01           Floor IDF cabinets
//   AHU-RF-01         Roof plant items

// ---------- Display palette -----------------------------------------------

const SYSTEM_COLORS = {
  powerDistribution: '#ff8a3d',
  lighting: '#ffd84d',
  fireAlarm: '#ff3a3a',
  data: '#5cdcff',
  emergencyLighting: '#9ad65a',
  security: '#c48cff',
  bms: '#49c98f',
} as const;

const CONTAINMENT_COLORS = {
  trunking: '#bcc1c8',
  basket: '#bcc1c8',
  tray: '#7fb24a',
  conduit: '#3a6db8',
  ladder: '#aa6b3d',
  duct: '#6c7480',
  busbar: '#c4a86b',
} as const;

// ---------- Builder utilities --------------------------------------------

const addEntity = (sheet: Sheet, e: Entity): EntityId => {
  sheet.entities[e.id] = e;
  sheet.entityOrder.push(e.id);
  return e.id;
};

const wallSegment = (
  layer: LayerId,
  points: Vec2[],
  thickness: number,
  options: {
    external?: boolean;
    fireRating?: WallEntity['fireRating'];
    height?: number;
    construction?: WallEntity['construction'];
  } = {},
): WallEntity => ({
  id: newEntityId(),
  kind: 'wall',
  layerId: layer,
  visible: true,
  locked: false,
  points,
  thickness,
  height: options.height ?? 3000,
  external: options.external,
  fireRating: options.fireRating,
  construction: options.construction,
});

const room = (
  layer: LayerId,
  a: Vec2,
  b: Vec2,
  name: string,
  classification: ZoneClassification,
  zoneId?: string,
  floorColor?: string,
): RoomEntity => ({
  id: newEntityId(),
  kind: 'room',
  layerId: layer,
  visible: true,
  locked: false,
  a,
  b,
  name,
  zoneRef: zoneId,
  floorColor,
  // Hint to UI — not strictly part of RoomEntity, but kept for future use.
  hazardousZone: classification === 'hazardous' ? '2' : undefined,
});

const containment = (
  layer: LayerId,
  type: ContainmentType,
  points: Vec2[],
  width: number,
  height: number | undefined,
  systemId: SystemId,
  label?: string,
  cableCategory?: ContainmentEntity['cableCategory'],
): ContainmentEntity => ({
  id: newEntityId(),
  kind: 'containment',
  layerId: layer,
  visible: true,
  locked: false,
  containmentType: type,
  points,
  width,
  height,
  systemId,
  color: CONTAINMENT_COLORS[type as keyof typeof CONTAINMENT_COLORS],
  label,
  cableCategory,
  material: 'pre-galvanised-steel',
  loadClass: 'C',
});

const equipment = (
  layer: LayerId,
  tag: string,
  description: string,
  kind: EquipmentEntity['equipmentKind'],
  origin: Vec2,
  size: { w: number; h: number },
  systemId?: SystemId,
  ratings?: { current?: number; voltage?: number; ip?: EquipmentEntity['ipRating'] },
): EquipmentEntity => ({
  id: newEntityId(),
  kind: 'equipment',
  layerId: layer,
  visible: true,
  locked: false,
  equipmentKind: kind,
  a: { x: origin.x, y: origin.y },
  b: { x: origin.x + size.w, y: origin.y + size.h },
  rotation: 0,
  tag,
  description,
  systemId,
  ratedCurrent: ratings?.current,
  ratedVoltage: ratings?.voltage,
  ipRating: ratings?.ip,
  height: 1800,
});

const text = (
  layer: LayerId,
  pos: Vec2,
  body: string,
  fontSize = 60,
): TextEntity => ({
  id: newEntityId(),
  kind: 'text',
  layerId: layer,
  visible: true,
  locked: false,
  position: pos,
  text: body,
  fontSize,
  rotation: 0,
  align: 'left',
});

const riser = (
  layer: LayerId,
  position: Vec2,
  fromFloorId: string,
  toFloorId: string,
  systemId?: SystemId,
  label?: string,
  containmentType: ContainmentType = 'tray',
  size: { width: number; height: number } = { width: 600, height: 200 },
): RiserEntity => ({
  id: newEntityId(),
  kind: 'riser',
  layerId: layer,
  visible: true,
  locked: false,
  position,
  width: size.width,
  height: size.height,
  containmentType,
  fromFloorId,
  toFloorId,
  systemId,
  label,
});

// ---------- Floor builder ------------------------------------------------

interface FloorLayers {
  containment: LayerId;
  wall: LayerId;
  room: LayerId;
  panel: LayerId;
  annotation: LayerId;
}

interface ServiceRiserPositions {
  power: Vec2;
  data: Vec2;
  lifeSafety: Vec2;
  controls: Vec2;
}

interface FloorBuildResult {
  sheet: Sheet;
  zones: Zone[];
  equipment: EquipmentEntity[];
  containment: ContainmentEntity[];
  risers: ServiceRiserPositions;
}

type CorporateLevel = 'G' | '1' | '2' | '3' | 'R';

interface CorporateLevelMeta {
  sheetName: string;
  sheetNumber: string;
  floorName: string;
  title: string;
  titleSuffix: string;
  levelCode: string;
  levelNumber: number;
  ffl: number;
  floorHeight: number;
  slabThickness: number;
  ceilingVoid: number;
  raisedFloor?: number;
}

interface CorporateFloorOpts {
  floorId: string;
  buildingId: string;
  level: CorporateLevel;
  systems: Record<string, SystemId>;
  layers: FloorLayers;
}

const CORPORATE_LEVEL_ORDER: CorporateLevel[] = ['G', '1', '2', '3', 'R'];

const CORPORATE_LEVEL_META: Record<CorporateLevel, CorporateLevelMeta> = {
  G: {
    sheetName: 'Corporate HQ — Ground Floor',
    sheetNumber: '101',
    floorName: 'Ground Floor',
    title: 'CORPORATE HQ — GROUND FLOOR PLAN',
    titleSuffix: 'Ground Floor Plan',
    levelCode: '00',
    levelNumber: 0,
    ffl: 0,
    floorHeight: 4200,
    slabThickness: 300,
    ceilingVoid: 850,
    raisedFloor: 150,
  },
  1: {
    sheetName: 'Corporate HQ — Level 1 Office',
    sheetNumber: '102',
    floorName: 'Level 1',
    title: 'CORPORATE HQ — LEVEL 1 WORKPLACE PLAN',
    titleSuffix: 'Level 1 Workplace Plan',
    levelCode: '01',
    levelNumber: 1,
    ffl: 4200,
    floorHeight: 3900,
    slabThickness: 275,
    ceilingVoid: 750,
    raisedFloor: 150,
  },
  2: {
    sheetName: 'Corporate HQ — Level 2 Office',
    sheetNumber: '103',
    floorName: 'Level 2',
    title: 'CORPORATE HQ — LEVEL 2 WORKPLACE PLAN',
    titleSuffix: 'Level 2 Workplace Plan',
    levelCode: '02',
    levelNumber: 2,
    ffl: 8100,
    floorHeight: 3900,
    slabThickness: 275,
    ceilingVoid: 750,
    raisedFloor: 150,
  },
  3: {
    sheetName: 'Corporate HQ — Level 3 Client Suite',
    sheetNumber: '104',
    floorName: 'Level 3',
    title: 'CORPORATE HQ — LEVEL 3 CLIENT SUITE PLAN',
    titleSuffix: 'Level 3 Client Suite Plan',
    levelCode: '03',
    levelNumber: 3,
    ffl: 12000,
    floorHeight: 3900,
    slabThickness: 275,
    ceilingVoid: 750,
    raisedFloor: 150,
  },
  R: {
    sheetName: 'Corporate HQ — Roof Plant',
    sheetNumber: '105',
    floorName: 'Roof Plant',
    title: 'CORPORATE HQ — ROOF PLANT PLAN',
    titleSuffix: 'Roof Plant Plan',
    levelCode: 'RF',
    levelNumber: 4,
    ffl: 15900,
    floorHeight: 3600,
    slabThickness: 250,
    ceilingVoid: 0,
  },
};

const BUILDING_WIDTH = 36000;
const BUILDING_DEPTH = 24000;
const CORE = { minX: 14500, minY: 7600, maxX: 21500, maxY: 16400 };
const POWER_Y = 12000;
const DATA_Y = 11400;
const FIRE_Y = 10950;
const SECURITY_Y = 10600;
const LIGHTING_Y = 12600;
const CONTROLS_Y = 13100;
const POWER_RISER_X = 15500;
const LIFE_SAFETY_RISER_X = 18000;
const CONTROLS_RISER_X = 19000;
const DATA_RISER_X = 20500;
const RISERS: ServiceRiserPositions = {
  power: { x: POWER_RISER_X, y: POWER_Y },
  data: { x: DATA_RISER_X, y: DATA_Y },
  lifeSafety: { x: LIFE_SAFETY_RISER_X, y: FIRE_Y },
  controls: { x: CONTROLS_RISER_X, y: CONTROLS_Y },
};

const routePoints = (y: number, xs: number[]): Vec2[] => (
  [...new Set(xs)].sort((a, b) => a - b).map((x) => ({ x, y }))
);

const zoneRecord = (
  floorId: string,
  name: string,
  classification: ZoneClassification,
  bounds: Zone['bounds'],
  ipRating = 'IP20',
  fireRating: Zone['fireRating'] = 60,
  uniclass?: string,
): Zone => ({
  id: newId(),
  floorId,
  name,
  classification,
  bounds,
  ipRating,
  fireRating,
  uniclass,
});

const addRoomForZone = (
  sheet: Sheet,
  layer: LayerId,
  z: Zone,
  floorColor: string,
  label = z.name,
): void => {
  if (!z.bounds) return;
  addEntity(sheet, room(
    layer,
    { x: z.bounds.minX, y: z.bounds.minY },
    { x: z.bounds.maxX, y: z.bounds.maxY },
    label,
    z.classification,
    z.id,
    floorColor,
  ));
};

const addRectWalls = (
  sheet: Sheet,
  layer: LayerId,
  bounds: NonNullable<Zone['bounds']>,
  thickness: number,
  options: Parameters<typeof wallSegment>[3],
): void => {
  addEntity(sheet, wallSegment(layer, [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ], thickness, options));
};

const addRun = (
  sheet: Sheet,
  list: ContainmentEntity[],
  layer: LayerId,
  type: ContainmentType,
  points: Vec2[],
  width: number,
  height: number | undefined,
  systemId: SystemId,
  label: string,
  cableCategory: ContainmentEntity['cableCategory'],
  patch: Partial<ContainmentEntity> = {},
): ContainmentEntity => {
  const c = containment(layer, type, points, width, height, systemId, label, cableCategory);
  Object.assign(c, patch);
  addEntity(sheet, c);
  list.push(c);
  return c;
};

const addEquipment = (
  sheet: Sheet,
  list: EquipmentEntity[],
  layer: LayerId,
  tag: string,
  description: string,
  kind: EquipmentEntity['equipmentKind'],
  origin: Vec2,
  size: { w: number; h: number },
  systemId?: SystemId,
  ratings?: { current?: number; voltage?: number; ip?: EquipmentEntity['ipRating'] },
  patch: Partial<EquipmentEntity> = {},
): EquipmentEntity => {
  const e = equipment(layer, tag, description, kind, origin, size, systemId, ratings);
  Object.assign(e, patch);
  addEntity(sheet, e);
  list.push(e);
  return e;
};

const addCorporateEnvelope = (
  sheet: Sheet,
  layers: FloorLayers,
  meta: CorporateLevelMeta,
  roof = false,
): void => {
  const construction: WallEntity['construction'] = roof ? 'concrete' : 'glazed';
  const height = roof ? 1400 : meta.floorHeight - 350;
  const wallOpts = { external: true, height, construction };
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 0 }, { x: BUILDING_WIDTH, y: 0 }], 320, wallOpts));
  addEntity(sheet, wallSegment(layers.wall, [{ x: BUILDING_WIDTH, y: 0 }, { x: BUILDING_WIDTH, y: BUILDING_DEPTH }], 320, wallOpts));
  addEntity(sheet, wallSegment(layers.wall, [{ x: BUILDING_WIDTH, y: BUILDING_DEPTH }, { x: 0, y: BUILDING_DEPTH }], 320, wallOpts));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: BUILDING_DEPTH }, { x: 0, y: 0 }], 320, wallOpts));
};

const addCorporateCoreWalls = (
  sheet: Sheet,
  layers: FloorLayers,
  meta: CorporateLevelMeta,
): void => {
  const coreWall = {
    height: meta.floorHeight - 350,
    fireRating: 120 as WallEntity['fireRating'],
    construction: 'concrete' as WallEntity['construction'],
  };
  addRectWalls(sheet, layers.wall, CORE, 250, coreWall);
  addEntity(sheet, wallSegment(layers.wall, [{ x: 16500, y: 7600 }, { x: 16500, y: 16400 }], 180, coreWall));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 19500, y: 7600 }, { x: 19500, y: 16400 }], 180, coreWall));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 14500, y: 10400 }, { x: 21500, y: 10400 }], 180, coreWall));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 14500, y: 12000 }, { x: 21500, y: 12000 }], 180, coreWall));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 14500, y: 13600 }, { x: 21500, y: 13600 }], 180, coreWall));
};

const addWorkplacePlanningWalls = (
  sheet: Sheet,
  layers: FloorLayers,
  meta: CorporateLevelMeta,
  level: CorporateLevel,
): void => {
  const partition = {
    height: meta.floorHeight - 650,
    construction: 'metal-stud' as WallEntity['construction'],
  };
  const glazed = {
    height: meta.floorHeight - 650,
    construction: 'glazed' as WallEntity['construction'],
  };
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 10400 }, { x: 13200, y: 10400 }], 120, partition));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 22800, y: 10400 }, { x: BUILDING_WIDTH, y: 10400 }], 120, partition));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 13600 }, { x: 13200, y: 13600 }], 120, partition));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 22800, y: 13600 }, { x: BUILDING_WIDTH, y: 13600 }], 120, partition));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 11800, y: 0 }, { x: 11800, y: 10400 }], 120, glazed));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 24200, y: 0 }, { x: 24200, y: 10400 }], 120, glazed));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 11800, y: 13600 }, { x: 11800, y: BUILDING_DEPTH }], 120, glazed));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 24200, y: 13600 }, { x: 24200, y: BUILDING_DEPTH }], 120, glazed));
  if (level === '3') {
    addEntity(sheet, wallSegment(layers.wall, [{ x: 24600, y: 13600 }, { x: 24600, y: BUILDING_DEPTH }], 140, glazed));
    addEntity(sheet, wallSegment(layers.wall, [{ x: 24600, y: 17800 }, { x: BUILDING_WIDTH, y: 17800 }], 140, glazed));
  }
};

const addOccupiedZones = (
  sheet: Sheet,
  layers: FloorLayers,
  floorId: string,
  level: CorporateLevel,
): Zone[] => {
  const zones: Zone[] = [];
  const push = (
    name: string,
    classification: ZoneClassification,
    bounds: NonNullable<Zone['bounds']>,
    color: string,
    ipRating = 'IP20',
    fireRating: Zone['fireRating'] = 60,
    uniclass?: string,
  ): Zone => {
    const z = zoneRecord(floorId, name, classification, bounds, ipRating, fireRating, uniclass);
    zones.push(z);
    addRoomForZone(sheet, layers.room, z, color);
    return z;
  };

  if (level === 'G') {
    push('Reception and Visitor Lobby', 'office', { minX: 0, minY: 7600, maxX: 14500, maxY: 16400 }, '#202a38', 'IP20', 60, 'SL_25_10_70');
    push('Client Briefing Suite', 'office', { minX: 0, minY: 16400, maxX: 14500, maxY: BUILDING_DEPTH }, '#1e2c3a', 'IP20', 60);
    push('Cafe and Town Hall', 'kitchen', { minX: 21500, minY: 16400, maxX: BUILDING_WIDTH, maxY: BUILDING_DEPTH }, '#243328', 'IP44', 60);
    push('Main Electrical Intake', 'electrical-riser', { minX: 0, minY: 0, maxX: 8500, maxY: 7600 }, '#3b2a1d', 'IP31', 120);
    push('Main Comms and UPS Room', 'data-room', { minX: 8500, minY: 0, maxX: 14500, maxY: 7600 }, '#1d3335', 'IP20', 90);
    push('Security Control Room', 'office', { minX: 21500, minY: 0, maxX: 28500, maxY: 7600 }, '#2c2540', 'IP20', 60);
    push('Facilities and Loading', 'storage', { minX: 28500, minY: 0, maxX: BUILDING_WIDTH, maxY: 7600 }, '#2f3034', 'IP44', 60);
  } else if (level === '3') {
    push('Executive Workplace West', 'office', { minX: 0, minY: 0, maxX: 14500, maxY: 10400 }, '#1c2634', 'IP20', 60);
    push('Project Studio East', 'office', { minX: 21500, minY: 0, maxX: BUILDING_WIDTH, maxY: 10400 }, '#1b2b31', 'IP20', 60);
    push('Client Boardroom Suite', 'office', { minX: 0, minY: 13600, maxX: 14500, maxY: BUILDING_DEPTH }, '#232b42', 'IP20', 60);
    push('Executive Meeting Rooms', 'office', { minX: 21500, minY: 13600, maxX: BUILDING_WIDTH, maxY: BUILDING_DEPTH }, '#202a3a', 'IP20', 60);
  } else {
    push(`Level ${level} West Open Office`, 'office', { minX: 0, minY: 0, maxX: 14500, maxY: 10400 }, '#1c2634', 'IP20', 60, 'SL_25_10_70');
    push(`Level ${level} East Meeting Suite`, 'office', { minX: 21500, minY: 0, maxX: BUILDING_WIDTH, maxY: 10400 }, '#1e2a38', 'IP20', 60);
    push(`Level ${level} Collaboration Lounge`, 'office', { minX: 0, minY: 13600, maxX: 14500, maxY: BUILDING_DEPTH }, '#1b2d34', 'IP20', 60);
    push(`Level ${level} East Open Office`, 'office', { minX: 21500, minY: 13600, maxX: BUILDING_WIDTH, maxY: BUILDING_DEPTH }, '#1c2934', 'IP20', 60, 'SL_25_10_70');
  }

  push('West Corridor', 'corridor', { minX: 0, minY: 10400, maxX: 14500, maxY: 13600 }, '#28313a', 'IP20', 60);
  push('East Corridor', 'corridor', { minX: 21500, minY: 10400, maxX: BUILDING_WIDTH, maxY: 13600 }, '#28313a', 'IP20', 60);
  push('Power Riser Room', 'electrical-riser', { minX: 14500, minY: 7600, maxX: 16500, maxY: 10400 }, '#3b2a1d', 'IP31', 120);
  push('Lift Lobby and Core', 'circulation', { minX: 16500, minY: 7600, maxX: 19500, maxY: 12000 }, '#303541', 'IP20', 120);
  push('Data Riser Room', 'data-room', { minX: 19500, minY: 7600, maxX: 21500, maxY: 10400 }, '#1d3335', 'IP20', 90);
  push('Life Safety Riser', 'electrical-riser', { minX: 14500, minY: 12000, maxX: 16500, maxY: 16400 }, '#322837', 'IP31', 120);
  push('WCs and Cleaners Store', 'wet-area', { minX: 16500, minY: 12000, maxX: 19500, maxY: 16400 }, '#26343d', 'IP44', 60);
  push('Controls Riser', 'electrical-riser', { minX: 19500, minY: 12000, maxX: 21500, maxY: 16400 }, '#263a2d', 'IP31', 90);
  return zones;
};

const addRoofZones = (
  sheet: Sheet,
  layers: FloorLayers,
  floorId: string,
): Zone[] => {
  const zones: Zone[] = [];
  const push = (
    name: string,
    classification: ZoneClassification,
    bounds: NonNullable<Zone['bounds']>,
    color: string,
    ipRating = 'IP54',
    fireRating: Zone['fireRating'] = 60,
  ): void => {
    const z = zoneRecord(floorId, name, classification, bounds, ipRating, fireRating);
    zones.push(z);
    addRoomForZone(sheet, layers.room, z, color);
  };
  push('Roof AHU Yard', 'mechanical', { minX: 0, minY: 13600, maxX: BUILDING_WIDTH, maxY: BUILDING_DEPTH }, '#25303a', 'IP54', 60);
  push('Roof Plant Electrical Room', 'electrical-riser', { minX: 14000, minY: 7600, maxX: 21500, maxY: 13600 }, '#3b2a1d', 'IP55', 120);
  push('PV Inverter Terrace', 'external', { minX: 26000, minY: 0, maxX: BUILDING_WIDTH, maxY: 7600 }, '#303536', 'IP65', 0);
  push('Chilled Water Plant Zone', 'mechanical', { minX: 0, minY: 0, maxX: 14000, maxY: 7600 }, '#28323a', 'IP55', 60);
  push('Roof Access Walkway', 'circulation', { minX: 0, minY: 7600, maxX: BUILDING_WIDTH, maxY: 13600 }, '#2d3238', 'IP44', 60);
  return zones;
};

const addCommonServiceSpines = (
  sheet: Sheet,
  list: ContainmentEntity[],
  layers: FloorLayers,
  systems: Record<string, SystemId>,
  labelPrefix: string,
  level: CorporateLevel,
): void => {
  const baseXs = [2400, 5200, 6200, 7600, 9500, 12200, POWER_RISER_X, LIFE_SAFETY_RISER_X, CONTROLS_RISER_X, DATA_RISER_X, 24500, 28500, 30500, 33600];
  const powerType: ContainmentType = level === 'G' ? 'busbar' : 'trunking';
  addRun(sheet, list, layers.containment, powerType, routePoints(POWER_Y, baseXs), level === 'G' ? 450 : 300, 150,
    systems.powerDistribution, `${labelPrefix} power ${level === 'G' ? 'busbar' : 'trunking'} — ${level === 'G' ? '800 A' : '300×150'}`, 'power',
    { elevation: level === 'G' ? 3550 : 3200, subType: level === 'G' ? 'feeder-busbar' : 'standard' });
  addRun(sheet, list, layers.containment, 'basket', routePoints(DATA_Y, [2400, 9500, DATA_RISER_X, 24500, 28500, 33600]), 300, 100,
    systems.data, `${labelPrefix} data basket — 300×100`, 'data', { elevation: 3350, subType: 'wire-mesh' });
  addRun(sheet, list, layers.containment, 'conduit', routePoints(FIRE_Y, [2400, 9500, LIFE_SAFETY_RISER_X, 30500, 33600]), 32, undefined,
    systems.fireAlarm, `${labelPrefix} FP200 fire alarm conduit`, 'fire-alarm', { elevation: 3100, material: 'lsoh' });
  addRun(sheet, list, layers.containment, 'basket', routePoints(LIGHTING_Y, [2400, 7600, 12200, POWER_RISER_X, LIFE_SAFETY_RISER_X, 28500, 30500, 33600]), 150, 100,
    systems.lighting, `${labelPrefix} lighting basket — 150×100`, 'power', { elevation: 3050, subType: 'wire-mesh' });
  addRun(sheet, list, layers.containment, 'conduit', routePoints(SECURITY_Y, [2400, 9500, DATA_RISER_X, 24500, 28500, 33600]), 32, undefined,
    systems.security, `${labelPrefix} security containment conduit`, 'data', { elevation: 3000, material: 'lsoh' });
  addRun(sheet, list, layers.containment, 'conduit', routePoints(CONTROLS_Y, [2400, 12200, CONTROLS_RISER_X, 24500, 28500, 33600]), 32, undefined,
    systems.bms, `${labelPrefix} BMS controls conduit`, 'instrumentation', { elevation: 2950, material: 'lsoh' });
};

const addOccupiedEquipmentAndBranches = (
  sheet: Sheet,
  equipmentList: EquipmentEntity[],
  containmentList: ContainmentEntity[],
  layers: FloorLayers,
  systems: Record<string, SystemId>,
  level: CorporateLevel,
): void => {
  const levelTag = level === 'G' ? 'LG' : `L0${level}`;
  const labelPrefix = level === 'G' ? 'Ground' : `Level ${level}`;
  const dbTag = `DB-${levelTag}`;
  const idfTag = `IDF-${levelTag}`;
  const lightingTag = `LT-${levelTag}-01`;
  const socketTag = `SK-${levelTag}-RING`;
  const fireTag = `FA-${levelTag}-LOOP`;
  const emergencyTag = `EM-${levelTag}-01`;

  if (level === 'G') {
    addEquipment(sheet, equipmentList, layers.panel, 'TX-01', '11 kV/400 V package substation transformer', 'transformer',
      { x: 1200, y: 1600 }, { w: 2200, h: 1800 }, systems.powerDistribution, { current: 1000, voltage: 400, ip: 'IP30' }, { height: 2200 });
    addEquipment(sheet, equipmentList, layers.panel, 'MSB-01', 'Main LV switchboard — 800 A TP+N', 'switchboard',
      { x: 4400, y: 2200 }, { w: 3600, h: 900 }, systems.powerDistribution, { current: 800, voltage: 400, ip: 'IP30' }, { height: 2100 });
    addEquipment(sheet, equipmentList, layers.panel, 'FAP-01', 'Addressable fire alarm panel — 8 loop', 'fire-alarm-panel',
      { x: 16800, y: 8200 }, { w: 800, h: 300 }, systems.fireAlarm, { ip: 'IP30' });
    addEquipment(sheet, equipmentList, layers.panel, 'CR-01', 'Main communications rack room core switch (42U)', 'comms-rack',
      { x: 9500, y: 2100 }, { w: 1100, h: 1100 }, systems.data, { ip: 'IP20' }, { height: 2200 });
    addEquipment(sheet, equipmentList, layers.panel, 'UPS-01', '60 kVA UPS with bypass panel', 'ups',
      { x: 11200, y: 2100 }, { w: 1300, h: 1000 }, systems.powerDistribution, { current: 90, voltage: 400, ip: 'IP20' }, { height: 1900 });
    addEquipment(sheet, equipmentList, layers.panel, 'SEC-CP-01', 'Security head-end and access-control panel', 'control-panel',
      { x: 22800, y: 2400 }, { w: 1200, h: 800 }, systems.security, { ip: 'IP20' });
    addEquipment(sheet, equipmentList, layers.panel, 'BMS-CP-01', 'BMS supervisor panel', 'control-panel',
      { x: 24600, y: 2400 }, { w: 1200, h: 800 }, systems.bms, { ip: 'IP20' });
  }

  addEquipment(sheet, equipmentList, layers.panel, dbTag, `${labelPrefix} distribution board — 250 A`, 'distribution-board',
    { x: 14900, y: 8200 }, { w: 1200, h: 450 }, systems.powerDistribution, { current: 250, voltage: 400, ip: 'IP30' });
  addEquipment(sheet, equipmentList, layers.panel, idfTag, `${labelPrefix} floor IDF cabinet (24U)`, 'comms-rack',
    { x: 19800, y: 8200 }, { w: 1000, h: 1000 }, systems.data, { ip: 'IP20' });
  addEquipment(sheet, equipmentList, layers.panel, lightingTag, `${labelPrefix} lighting circuit endpoint`, 'other',
    { x: 7600, y: 17600 }, { w: 220, h: 220 }, systems.lighting, { ip: 'IP20' });
  addEquipment(sheet, equipmentList, layers.panel, socketTag, `${labelPrefix} ring-final socket circuit endpoint`, 'other',
    { x: 30500, y: 17600 }, { w: 220, h: 220 }, systems.powerDistribution, { ip: 'IP20' });
  addEquipment(sheet, equipmentList, layers.panel, fireTag, `${labelPrefix} fire alarm loop endpoint`, 'other',
    { x: 9500, y: 10800 }, { w: 220, h: 220 }, systems.fireAlarm, { ip: 'IP30' });
  addEquipment(sheet, equipmentList, layers.panel, emergencyTag, `${labelPrefix} emergency lighting endpoint`, 'other',
    { x: 28500, y: 12650 }, { w: 220, h: 220 }, systems.emergencyLighting, { ip: 'IP20' });

  if (level === '2') {
    addEquipment(sheet, equipmentList, layers.panel, 'SEC-L02-ACS', 'Level 2 access-control door controller', 'control-panel',
      { x: 24600, y: 10200 }, { w: 700, h: 450 }, systems.security, { ip: 'IP20' });
    addEquipment(sheet, equipmentList, layers.panel, 'BMS-L02-VAV', 'Level 2 VAV controller panel', 'control-panel',
      { x: 12200, y: 10200 }, { w: 700, h: 450 }, systems.bms, { ip: 'IP20' });
  }

  if (level === '3') {
    addEquipment(sheet, equipmentList, layers.panel, 'AV-L03-RACK', 'Client suite AV rack', 'cabinet',
      { x: 24800, y: 15000 }, { w: 900, h: 900 }, systems.data, { ip: 'IP20' });
  }

  if (level === 'G') {
    addRun(sheet, containmentList, layers.containment, 'busbar',
      [{ x: 6200, y: POWER_Y }, { x: 6200, y: 3100 }, { x: 5500, y: 3100 }, { x: 2300, y: 2500 }],
      450, 150, systems.powerDistribution, 'Transformer to MSB busbar tap', 'power',
      { elevation: 3550, subType: 'feeder-busbar' });
    addRun(sheet, containmentList, layers.containment, 'trunking',
      [{ x: 12200, y: POWER_Y }, { x: 12200, y: 3000 }],
      225, 150, systems.powerDistribution, 'UPS essential power branch', 'power', { elevation: 3250 });
    addRun(sheet, containmentList, layers.containment, 'basket',
      [{ x: 9500, y: DATA_Y }, { x: 9500, y: 3200 }],
      300, 100, systems.data, 'Main comms room basket branch', 'data', { elevation: 3350 });
    addRun(sheet, containmentList, layers.containment, 'conduit',
      [{ x: 24500, y: SECURITY_Y }, { x: 24500, y: 3200 }],
      32, undefined, systems.security, 'Security head-end conduit drop', 'data', { elevation: 3000, material: 'lsoh' });
    addRun(sheet, containmentList, layers.containment, 'conduit',
      [{ x: 24500, y: CONTROLS_Y }, { x: 24500, y: 3200 }],
      32, undefined, systems.bms, 'BMS supervisor conduit drop', 'instrumentation', { elevation: 2950, material: 'lsoh' });
  }

  addRun(sheet, containmentList, layers.containment, level === 'G' ? 'busbar' : 'trunking',
    [{ x: POWER_RISER_X, y: POWER_Y }, { x: POWER_RISER_X, y: 8650 }, { x: 15500, y: 8650 }],
    level === 'G' ? 450 : 225, 150, systems.powerDistribution, `${labelPrefix} DB vertical riser tap`, 'power',
    { elevation: level === 'G' ? 3550 : 3200, subType: level === 'G' ? 'feeder-busbar' : 'standard' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: POWER_RISER_X, y: POWER_Y }, { x: POWER_RISER_X, y: LIGHTING_Y }],
    40, undefined, systems.lighting, `${labelPrefix} lighting board transition`, 'power', { elevation: 3000, material: 'galvanised-steel' });
  addRun(sheet, containmentList, layers.containment, 'trunking',
    [{ x: 30500, y: POWER_Y }, { x: 30500, y: 17800 }],
    150, 100, systems.powerDistribution, `${labelPrefix} ring-final power drop`, 'power', { elevation: 3000 });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 7600, y: LIGHTING_Y }, { x: 7600, y: 17800 }],
    32, undefined, systems.lighting, `${labelPrefix} lighting drop west`, 'power', { elevation: 3000 });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 28500, y: LIGHTING_Y }, { x: 28500, y: 12800 }],
    25, undefined, systems.emergencyLighting, `${labelPrefix} emergency-lighting drop`, 'emergency', { elevation: 3000 });
  addRun(sheet, containmentList, layers.containment, 'basket',
    [{ x: DATA_RISER_X, y: DATA_Y }, { x: DATA_RISER_X, y: 9200 }],
    200, 100, systems.data, `${labelPrefix} IDF basket drop`, 'data', { elevation: 3350 });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 9500, y: FIRE_Y }, { x: 9500, y: 10900 }],
    25, undefined, systems.fireAlarm, `${labelPrefix} fire alarm detector drop`, 'fire-alarm', { elevation: 3100, material: 'lsoh' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: LIFE_SAFETY_RISER_X, y: FIRE_Y }, { x: LIFE_SAFETY_RISER_X, y: 8500 }],
    32, undefined, systems.fireAlarm, `${labelPrefix} fire alarm panel/riser branch`, 'fire-alarm', { elevation: 3100, material: 'lsoh' });

  if (level === '2') {
    addRun(sheet, containmentList, layers.containment, 'conduit',
      [{ x: 24500, y: SECURITY_Y }, { x: 24500, y: 10400 }],
      32, undefined, systems.security, 'Level 2 access-control conduit drop', 'data', { elevation: 3000, material: 'lsoh' });
    addRun(sheet, containmentList, layers.containment, 'conduit',
      [{ x: 12200, y: CONTROLS_Y }, { x: 12200, y: 10400 }],
      32, undefined, systems.bms, 'Level 2 BMS VAV controls drop', 'instrumentation', { elevation: 2950, material: 'lsoh' });
  }

  if (level === '3') {
    addRun(sheet, containmentList, layers.containment, 'basket',
      [{ x: 24500, y: DATA_Y }, { x: 24500, y: 15450 }],
      200, 100, systems.data, 'Level 3 AV rack basket drop', 'data', { elevation: 3350 });
  }
};

const addRoofEquipmentAndContainment = (
  sheet: Sheet,
  equipmentList: EquipmentEntity[],
  containmentList: ContainmentEntity[],
  layers: FloorLayers,
  systems: Record<string, SystemId>,
): void => {
  addEquipment(sheet, equipmentList, layers.panel, 'DB-RF', 'Roof plant distribution board — 250 A', 'distribution-board',
    { x: 17000, y: 9000 }, { w: 1200, h: 450 }, systems.powerDistribution, { current: 250, voltage: 400, ip: 'IP55' });
  addEquipment(sheet, equipmentList, layers.panel, 'AHU-RF-01', 'Air-handling unit north — 42 A', 'air-handling-unit',
    { x: 5600, y: 16500 }, { w: 4200, h: 2400 }, systems.powerDistribution, { current: 42, voltage: 400, ip: 'IP55' }, { height: 2200 });
  addEquipment(sheet, equipmentList, layers.panel, 'AHU-RF-02', 'Air-handling unit east — 38 A', 'air-handling-unit',
    { x: 22400, y: 16500 }, { w: 4200, h: 2400 }, systems.powerDistribution, { current: 38, voltage: 400, ip: 'IP55' }, { height: 2200 });
  addEquipment(sheet, equipmentList, layers.panel, 'CHWP-RF-01', 'Chilled-water pump package — 22 A', 'pump',
    { x: 6600, y: 3000 }, { w: 2400, h: 1600 }, systems.powerDistribution, { current: 22, voltage: 400, ip: 'IP55' }, { height: 1400 });
  addEquipment(sheet, equipmentList, layers.panel, 'PV-INV-01', 'PV inverter — 50 kW', 'other',
    { x: 30500, y: 3600 }, { w: 1600, h: 900 }, systems.powerDistribution, { current: 80, voltage: 400, ip: 'IP65' });
  addEquipment(sheet, equipmentList, layers.panel, 'BMS-RF-IO', 'Roof plant BMS I/O panel', 'control-panel',
    { x: 19000, y: 8500 }, { w: 900, h: 650 }, systems.bms, { ip: 'IP55' });
  addEquipment(sheet, equipmentList, layers.panel, 'FA-RF-01', 'Roof plant fire alarm interface', 'other',
    { x: 11000, y: 11100 }, { w: 250, h: 250 }, systems.fireAlarm, { ip: 'IP55' });

  const roofXs = [2400, 6600, 7800, POWER_RISER_X, LIFE_SAFETY_RISER_X, CONTROLS_RISER_X, DATA_RISER_X, 24500, 28500, 30500, 33600];
  addRun(sheet, containmentList, layers.containment, 'ladder', routePoints(POWER_Y, roofXs), 600, 100,
    systems.powerDistribution, 'Roof plant ladder — 600 mm', 'power', { elevation: 2600, subType: 'heavy-duty-ladder', material: 'hot-dip-galvanised' });
  addRun(sheet, containmentList, layers.containment, 'trunking',
    [{ x: POWER_RISER_X, y: POWER_Y }, { x: 17000, y: POWER_Y }, { x: 17000, y: 9450 }],
    225, 150, systems.powerDistribution, 'Roof DB riser tap', 'power', { elevation: 2600 });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 6600, y: POWER_Y }, { x: 6600, y: 17700 }],
    50, undefined, systems.powerDistribution, 'AHU-RF-01 power drop', 'power', { elevation: 2450, material: 'galvanised-steel' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 24500, y: POWER_Y }, { x: 24500, y: 17700 }],
    50, undefined, systems.powerDistribution, 'AHU-RF-02 power drop', 'power', { elevation: 2450, material: 'galvanised-steel' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 7800, y: POWER_Y }, { x: 7800, y: 3800 }],
    40, undefined, systems.powerDistribution, 'CHWP-RF-01 power drop', 'power', { elevation: 2450, material: 'galvanised-steel' });
  addRun(sheet, containmentList, layers.containment, 'trunking',
    [{ x: 30500, y: POWER_Y }, { x: 30500, y: 4050 }],
    150, 100, systems.powerDistribution, 'PV inverter AC trunking', 'power', { elevation: 2500 });
  addRun(sheet, containmentList, layers.containment, 'basket', routePoints(DATA_Y, [2400, DATA_RISER_X, 24500, 33600]), 300, 100,
    systems.data, 'Roof data basket — 300×100', 'data', { elevation: 2600, subType: 'wire-mesh' });
  addRun(sheet, containmentList, layers.containment, 'conduit', routePoints(FIRE_Y, [2400, 11000, LIFE_SAFETY_RISER_X, 33600]), 32, undefined,
    systems.fireAlarm, 'Roof FP200 fire alarm conduit', 'fire-alarm', { elevation: 2400, material: 'lsoh' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: 11000, y: FIRE_Y }, { x: 11000, y: 11200 }],
    25, undefined, systems.fireAlarm, 'Roof fire alarm interface drop', 'fire-alarm', { elevation: 2400, material: 'lsoh' });
  addRun(sheet, containmentList, layers.containment, 'conduit', routePoints(CONTROLS_Y, [2400, CONTROLS_RISER_X, 24500, 33600]), 32, undefined,
    systems.bms, 'Roof BMS controls conduit', 'instrumentation', { elevation: 2350, material: 'lsoh' });
  addRun(sheet, containmentList, layers.containment, 'conduit',
    [{ x: CONTROLS_RISER_X, y: CONTROLS_Y }, { x: CONTROLS_RISER_X, y: 8900 }],
    32, undefined, systems.bms, 'Roof BMS I/O drop', 'instrumentation', { elevation: 2350, material: 'lsoh' });
};

const buildCorporateFloor = (opts: CorporateFloorOpts): FloorBuildResult => {
  const { floorId, level, systems, layers } = opts;
  const meta = CORPORATE_LEVEL_META[level];
  const sheet: Sheet = {
    id: newId(),
    name: meta.sheetName,
    number: meta.sheetNumber,
    kind: 'floor-plan',
    width: BUILDING_WIDTH,
    height: BUILDING_DEPTH,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
    sceneStyle: 'building',
    floorId,
    buildingId: opts.buildingId,
  };

  const zones = level === 'R'
    ? addRoofZones(sheet, layers, floorId)
    : addOccupiedZones(sheet, layers, floorId, level);

  addCorporateEnvelope(sheet, layers, meta, level === 'R');
  if (level !== 'R') {
    addCorporateCoreWalls(sheet, layers, meta);
    addWorkplacePlanningWalls(sheet, layers, meta, level);
  } else {
    addRectWalls(sheet, layers.wall, { minX: 14000, minY: 7600, maxX: 21500, maxY: 13600 }, 250, {
      height: 3000,
      fireRating: 120,
      construction: 'concrete',
    });
  }

  const equipmentList: EquipmentEntity[] = [];
  const containmentList: ContainmentEntity[] = [];
  const labelPrefix = level === 'G' ? 'Ground' : level === 'R' ? 'Roof' : `Level ${level}`;

  if (level !== 'R') {
    addCommonServiceSpines(sheet, containmentList, layers, systems, labelPrefix, level);
    addOccupiedEquipmentAndBranches(sheet, equipmentList, containmentList, layers, systems, level);
  } else {
    addRoofEquipmentAndContainment(sheet, equipmentList, containmentList, layers, systems);
  }

  addEntity(sheet, text(layers.annotation, { x: 800, y: BUILDING_DEPTH - 700 }, meta.title, 220));
  addEntity(sheet, text(layers.annotation, { x: 800, y: BUILDING_DEPTH - 1100 },
    'Power · Lighting · Structured data · Fire alarm · Security · BMS · Emergency lighting',
    100));

  return { sheet, zones, equipment: equipmentList, containment: containmentList, risers: RISERS };
};

// ---------- Project assembly --------------------------------------------

export const createWholeSiteSampleProject = (): Project => {
  const project = createEmptyProject();
  project.name = 'Corporate HQ Containment Model';
  project.description = 'Implementation-grade multi-floor corporate office model with coordinated electrical containment, risers and roof plant.';
  project.client = 'Apex Corporate Estates';
  project.engineer = 'OpenCAD Demo';
  project.projectNumber = 'HQ-2026-001';
  project.originatorCode = 'OPC';
  project.standard = 'IEC';
  project.standardsProfile = DEFAULT_STANDARDS.BS7671;

  const layers: FloorLayers = {
    containment: project.layerOrder[6],
    wall: project.layerOrder[7],
    room: project.layerOrder[8],
    panel: project.layerOrder[5],
    annotation: project.layerOrder[4],
  };

  for (const sid of project.sheetOrder) delete project.sheets[sid];
  project.sheetOrder = [];

  const siteId = newId();
  const buildingId = newId();
  const floorIds = Object.fromEntries(
    CORPORATE_LEVEL_ORDER.map((level) => [level, newId()]),
  ) as Record<CorporateLevel, string>;

  const systemPower: ElectricalSystem = {
    id: newId(),
    name: 'Power Distribution',
    kind: 'power-distribution',
    color: SYSTEM_COLORS.powerDistribution,
    band: 'II',
    description: 'LV mains, sub-mains, busbar riser and final circuits',
  };
  const systemLight: ElectricalSystem = {
    id: newId(),
    name: 'Lighting',
    kind: 'lighting',
    color: SYSTEM_COLORS.lighting,
    band: 'II',
    description: 'General lighting circuits',
  };
  const systemFA: ElectricalSystem = {
    id: newId(),
    name: 'Fire Alarm',
    kind: 'fire-alarm',
    color: SYSTEM_COLORS.fireAlarm,
    band: 'I',
    description: 'Addressable fire alarm system — FP200',
  };
  const systemData: ElectricalSystem = {
    id: newId(),
    name: 'Data',
    kind: 'data',
    color: SYSTEM_COLORS.data,
    band: 'I',
    description: 'Structured cabling — fibre backbone and Cat 6A',
  };
  const systemEM: ElectricalSystem = {
    id: newId(),
    name: 'Emergency Lighting',
    kind: 'emergency-lighting',
    color: SYSTEM_COLORS.emergencyLighting,
    band: 'II',
    description: 'Self-contained emergency luminaires and maintained circuits',
  };
  const systemSecurity: ElectricalSystem = {
    id: newId(),
    name: 'Security',
    kind: 'security',
    color: SYSTEM_COLORS.security,
    band: 'I',
    description: 'Access control, CCTV and security head-end cabling',
  };
  const systemBms: ElectricalSystem = {
    id: newId(),
    name: 'BMS Controls',
    kind: 'bms',
    color: SYSTEM_COLORS.bms,
    band: 'I',
    description: 'BMS field bus, I/O and plant control cabling',
  };

  const systemMap = {
    powerDistribution: systemPower.id,
    lighting: systemLight.id,
    fireAlarm: systemFA.id,
    data: systemData.id,
    emergencyLighting: systemEM.id,
    security: systemSecurity.id,
    bms: systemBms.id,
  };

  const systems: Record<SystemId, ElectricalSystem> = {
    [systemPower.id]: systemPower,
    [systemLight.id]: systemLight,
    [systemFA.id]: systemFA,
    [systemData.id]: systemData,
    [systemEM.id]: systemEM,
    [systemSecurity.id]: systemSecurity,
    [systemBms.id]: systemBms,
  };

  const floorBuildByLevel = {} as Record<CorporateLevel, FloorBuildResult>;
  for (const level of CORPORATE_LEVEL_ORDER) {
    floorBuildByLevel[level] = buildCorporateFloor({
      floorId: floorIds[level],
      buildingId,
      level,
      systems: systemMap,
      layers,
    });
  }
  const floorBuilds = CORPORATE_LEVEL_ORDER.map((level) => floorBuildByLevel[level]);

  for (const floorBuild of floorBuilds) {
    project.sheets[floorBuild.sheet.id] = floorBuild.sheet;
    project.sheetOrder.push(floorBuild.sheet.id);
  }

  const today = Date.now();
  const metaPlan: Record<string, {
    floorId: string;
    levelCode: string;
    seq: number;
    titleSuffix: string;
  }> = {};
  CORPORATE_LEVEL_ORDER.forEach((level, index) => {
    const build = floorBuildByLevel[level];
    const meta = CORPORATE_LEVEL_META[level];
    metaPlan[build.sheet.id] = {
      floorId: floorIds[level],
      levelCode: meta.levelCode,
      seq: index + 1,
      titleSuffix: meta.titleSuffix,
    };
  });

  for (const sid of Object.keys(metaPlan)) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    const plan = metaPlan[sid];
    const meta: SheetMeta = {
      projectCode: project.projectNumber,
      originator: project.originatorCode,
      volume: 'ZZ',
      level: plan.levelCode,
      type: 'DR',
      discipline: 'E',
      sequenceNumber: String(plan.seq).padStart(4, '0'),
      title: sheet.name,
      subtitle: plan.titleSuffix,
      scale: '1:50',
      paperSize: 'A1',
      status: 'S0',
      currentRevision: 'P01',
      revisions: [{
        id: `rev-${sid}-1`,
        code: 'P01',
        status: 'S0',
        date: today,
        description: 'Initial issue',
        author: project.engineer ?? 'OpenCAD Demo',
      }],
      drawnBy: project.engineer ?? 'OpenCAD Demo',
      drawnDate: today,
      designer: project.engineer ?? 'OpenCAD Demo',
    };
    meta.drawingNumber = assembleDrawingNumber({
      projectCode: meta.projectCode,
      originator: meta.originator,
      volume: meta.volume,
      level: meta.level,
      type: meta.type,
      discipline: meta.discipline,
      sequenceNumber: meta.sequenceNumber,
    });
    sheet.meta = meta;
  }

  const powerRiserBySheetId: Record<string, RiserEntity> = {};
  const addServiceRiserPair = (
    fromLevel: CorporateLevel,
    toLevel: CorporateLevel,
    position: Vec2,
    systemId: SystemId,
    label: string,
    containmentType: ContainmentType,
    size: { width: number; height: number },
  ): void => {
    const fromBuild = floorBuildByLevel[fromLevel];
    const toBuild = floorBuildByLevel[toLevel];
    const lower = riser(layers.containment, position, floorIds[fromLevel], floorIds[toLevel], systemId, label, containmentType, size);
    const upper = riser(layers.containment, position, floorIds[fromLevel], floorIds[toLevel], systemId, label, containmentType, size);
    addEntity(project.sheets[fromBuild.sheet.id], lower);
    addEntity(project.sheets[toBuild.sheet.id], upper);
    if (label.includes('Power')) {
      powerRiserBySheetId[fromBuild.sheet.id] ??= lower;
      powerRiserBySheetId[toBuild.sheet.id] ??= upper;
    }
  };

  for (let i = 0; i < CORPORATE_LEVEL_ORDER.length - 1; i++) {
    const fromLevel = CORPORATE_LEVEL_ORDER[i];
    const toLevel = CORPORATE_LEVEL_ORDER[i + 1];
    addServiceRiserPair(fromLevel, toLevel, RISERS.power, systemPower.id, 'Power busbar vertical riser', 'busbar', { width: 700, height: 220 });
    addServiceRiserPair(fromLevel, toLevel, RISERS.data, systemData.id, 'Structured data vertical riser', 'basket', { width: 450, height: 180 });
    addServiceRiserPair(fromLevel, toLevel, RISERS.lifeSafety, systemFA.id, 'Life-safety vertical riser', 'conduit', { width: 220, height: 220 });
    addServiceRiserPair(fromLevel, toLevel, RISERS.controls, systemBms.id, 'BMS controls vertical riser', 'conduit', { width: 180, height: 180 });
  }

  const allZones: Record<string, Zone> = {};
  for (const z of floorBuilds.flatMap((floorBuild) => floorBuild.zones)) {
    allZones[z.id] = z;
  }

  const floors: Record<string, Floor> = {};
  for (const level of CORPORATE_LEVEL_ORDER) {
    const meta = CORPORATE_LEVEL_META[level];
    const build = floorBuildByLevel[level];
    floors[floorIds[level]] = {
      id: floorIds[level],
      buildingId,
      name: meta.floorName,
      level: meta.levelNumber,
      ffl: meta.ffl,
      floorHeight: meta.floorHeight,
      slabThickness: meta.slabThickness,
      ceilingVoid: meta.ceilingVoid,
      raisedFloor: meta.raisedFloor,
      zoneOrder: build.zones.map((z) => z.id),
      sheetIds: [build.sheet.id],
    };
  }

  const buildings: Record<string, Building> = {
    [buildingId]: {
      id: buildingId,
      siteId,
      name: 'Apex Corporate Headquarters',
      number: 'HQ-01',
      use: 'Corporate office / commercial workplace',
      height: 19500,
      gridOriginX: 0,
      gridOriginY: 0,
      floorOrder: CORPORATE_LEVEL_ORDER.map((level) => floorIds[level]),
    },
  };

  const sites: Record<string, Site> = {
    [siteId]: {
      id: siteId,
      name: 'Apex Corporate Campus',
      description: 'Single-building corporate office with coordinated risers, workplace floors and roof plant',
      address: '1 Innovation Way, London',
      supplyVoltage: 400,
      frequency: 50,
      earthingSystem: 'TN-S',
      buildingOrder: [buildingId],
    },
  };

  const tagMap: Record<string, string> = {};
  const allEquipment = floorBuilds.flatMap((floorBuild) => floorBuild.equipment);
  for (const eq of allEquipment) tagMap[eq.tag] = eq.id;
  const cableSchedule = createSampleCableSchedule({ byTag: tagMap, systems: systemMap });

  const seals: Record<string, PenetrationSeal> = {};
  const sealRows: Array<{
    ref: string;
    rating: PenetrationSeal['requiredRating'];
    type: PenetrationSeal['sealType'];
  }> = [
    { ref: 'FS-001', rating: 120, type: 'batt' },
    { ref: 'FS-002', rating: 120, type: 'collar' },
    { ref: 'FS-003', rating: 90, type: 'composite' },
    { ref: 'FS-004', rating: 90, type: 'pillow' },
    { ref: 'FS-005', rating: 60, type: 'mortar' },
  ];
  const sealCandidates = floorBuilds.map((floorBuild) => floorBuild.containment[0]).filter(Boolean);
  for (let i = 0; i < sealRows.length; i++) {
    const r = sealRows[i];
    const target = sealCandidates[i];
    if (!target) continue;
    const sealId = newId();
    seals[sealId] = {
      id: sealId,
      reference: r.ref,
      boundaryEntityId: target.id,
      penetrationEntityId: target.id,
      crossingPoint: { x: target.points[0].x, y: target.points[0].y },
      requiredRating: r.rating,
      sealType: r.type,
      achievedRating: r.rating,
      openingWidth: 260,
      openingHeight: 160,
      status: i === 0 ? 'inspected' : i === 1 ? 'designed' : 'flagged',
      notes: 'Seal at service riser or fire compartment boundary — inspect and certify before closing.',
    };
  }
  project.penetrationSeals = seals;

  for (const floorBuild of floorBuilds) {
    const sheet = project.sheets[floorBuild.sheet.id];
    if (!sheet) continue;
    const containmentIds = floorBuild.containment.map((c) => c.id);
    for (const cid of containmentIds) {
      const fittings = autoPlaceFittingsForContainment(project, floorBuild.sheet.id, cid);
      for (const f of fittings) addEntity(sheet, f as FittingEntity);

      const supports = autoPlaceSupportsForContainment(project, floorBuild.sheet.id, cid);
      for (const s of supports) addEntity(sheet, s as SupportEntity);

      const detected = autoDetectPenetrationsForContainment(project, floorBuild.sheet.id, cid);
      for (const p of detected.penetrations) addEntity(sheet, p as PenetrationEntity);
      for (const sealId of Object.keys(detected.seals)) {
        seals[sealId] = detected.seals[sealId];
      }
      project.penetrationSeals = seals;
    }
  }

  const allContainments: ContainmentEntity[] = [];
  const equipmentCenterById = new Map<string, Vec2>();
  const equipmentCenterByTag = new Map<string, Vec2>();
  const sheetOrigin = (sheet: Sheet): Vec2 => {
    const building = sheet.buildingId ? buildings[sheet.buildingId] : undefined;
    return {
      x: building?.gridOriginX ?? 0,
      y: building?.gridOriginY ?? 0,
    };
  };

  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    const origin = sheetOrigin(sheet);
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (!e) continue;
      if (e.kind === 'containment') {
        const c = e as ContainmentEntity;
        allContainments.push({
          ...c,
          points: c.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
        });
      } else if (e.kind === 'equipment') {
        const eq = e as EquipmentEntity;
        const center: Vec2 = {
          x: origin.x + (eq.a.x + eq.b.x) / 2,
          y: origin.y + (eq.a.y + eq.b.y) / 2,
        };
        equipmentCenterById.set(eq.id, center);
        equipmentCenterByTag.set(eq.tag, center);
      }
    }
  }
  const graph = buildContainmentGraph(allContainments);

  for (const cableId of cableSchedule.cableOrder) {
    const cable = cableSchedule.cables[cableId];
    if (!cable) continue;
    const fromPos =
      (cable.fromEntityId && equipmentCenterById.get(cable.fromEntityId)) ??
      equipmentCenterByTag.get(cable.from);
    const toPos =
      (cable.toEntityId && equipmentCenterById.get(cable.toEntityId)) ??
      equipmentCenterByTag.get(cable.to);
    if (!fromPos || !toPos) {
      cable.route = [];
      cable.notes = 'Manual routing required — endpoints not modelled as equipment';
      continue;
    }

    const result = routeCableThroughGraph(graph, fromPos, toPos, cable, allContainments, {
      snapTolerance: 2200,
    });
    if (result.found && result.path.length > 0) {
      cable.route = result.path.map((c) => c.id);
      cable.estimatedLength = Math.round(result.length / 100) / 10;
      for (const c of result.path) {
        const sheetForC = (() => {
          for (const sid of project.sheetOrder) {
            const s = project.sheets[sid];
            if (s && s.entities[c.id]) return s;
          }
          return null;
        })();
        if (!sheetForC) continue;
        const target = sheetForC.entities[c.id];
        if (target && target.kind === 'containment') {
          const existing = target.assignedCableIds ?? [];
          if (!existing.includes(cable.id)) {
            target.assignedCableIds = [...existing, cable.id];
          }
        }
      }
    } else {
      cable.route = [];
      cable.notes = result.warnings[0]
        ? `Manual routing required — ${result.warnings[0]}`
        : 'Manual routing required — no compliant path through containment';
    }
  }

  const arrow = (layer: LayerId, pos: Vec2, size = 600): NorthArrowEntity => ({
    id: newEntityId(),
    kind: 'north-arrow',
    layerId: layer,
    visible: true,
    locked: false,
    position: pos,
    northAngle: 0,
    size,
  });

  const scaleBar = (
    layer: LayerId,
    pos: Vec2,
    scale: number,
    segmentLength: number,
    segments: number,
  ): ScaleBarEntity => ({
    id: newEntityId(),
    kind: 'scale-bar',
    layerId: layer,
    visible: true,
    locked: false,
    position: pos,
    segmentLength,
    segments,
    scale,
  });

  const gridLine = (
    layer: LayerId,
    orientation: 'horizontal' | 'vertical',
    offset: number,
    start: number,
    end: number,
    label: string,
  ): GridLineEntity => ({
    id: newEntityId(),
    kind: 'grid-line',
    layerId: layer,
    visible: true,
    locked: false,
    orientation,
    offset,
    start,
    end,
    label,
  });

  const leader = (
    layer: LayerId,
    points: Vec2[],
    body: string,
    targetEntityId?: string,
  ): LeaderEntity => ({
    id: newEntityId(),
    kind: 'leader',
    layerId: layer,
    visible: true,
    locked: false,
    points,
    text: body,
    fontSize: 80,
    arrowStyle: 'arrow',
    targetEntityId,
  });

  const annotateCorporateSheet = (
    sheetRef: Sheet,
    spine: ContainmentEntity,
    riserMarker: RiserEntity | undefined,
    label: string,
  ): void => {
    addEntity(sheetRef, arrow(layers.annotation, { x: 1300, y: 1300 }, 800));
    addEntity(sheetRef, scaleBar(layers.annotation, { x: 2600, y: 1100 }, 50, 1000, 5));
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((grid, index) => {
      addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 6000 * (index + 1), 0, BUILDING_DEPTH, grid));
    });
    ['1', '2', '3'].forEach((grid, index) => {
      addEntity(sheetRef, gridLine(layers.annotation, 'horizontal', 6000 * (index + 1), 0, BUILDING_WIDTH, grid));
    });
    addEntity(sheetRef, leader(layers.annotation,
      [{ x: POWER_RISER_X, y: POWER_Y }, { x: 12600, y: 15200 }, { x: 8500, y: 15200 }],
      `${label} primary power route`,
      spine.id,
    ));
    if (riserMarker) {
      addEntity(sheetRef, leader(layers.annotation,
        [{ x: riserMarker.position.x, y: riserMarker.position.y },
         { x: 12800, y: 8800 }, { x: 8500, y: 8800 }],
        'Stacked power riser',
        riserMarker.id,
      ));
    }
  };

  for (const level of CORPORATE_LEVEL_ORDER) {
    const build = floorBuildByLevel[level];
    const sheet = project.sheets[build.sheet.id];
    const primaryRoute = build.containment.find((c) => c.label?.includes('power') || c.label?.includes('Roof plant ladder'));
    if (sheet && primaryRoute) {
      annotateCorporateSheet(
        sheet,
        primaryRoute,
        powerRiserBySheetId[sheet.id],
        CORPORATE_LEVEL_META[level].floorName,
      );
    }
  }

  const itp: Record<string, ITPItem> = {};
  const itpRows: Array<Omit<ITPItem, 'id'>> = [
    {
      reference: 'ITP-01',
      activity: 'Primary riser and corridor containment installation',
      acceptanceCriteria: 'Routes installed to coordinated elevations; supports at scheduled centres; prefabricated riser penetrations sealed before ceiling close.',
      controlPoint: 'I',
      responsibility: 'Electrical Contractor',
      status: 'pending',
    },
    {
      reference: 'ITP-02',
      activity: 'Cable installation and labelling',
      acceptanceCriteria: 'Cables pulled with bend radii respected, labelled at both ends, segregation per BS 7671 528.',
      controlPoint: 'W',
      responsibility: 'Electrical Contractor',
      status: 'pending',
    },
    {
      reference: 'ITP-03',
      activity: 'Fire-stopping inspection',
      acceptanceCriteria: 'Power, data, life-safety and controls riser penetrations match approved tested systems with certification recorded.',
      controlPoint: 'H',
      responsibility: 'Fire-stopping Specialist',
      status: 'in-progress',
    },
    {
      reference: 'ITP-04',
      activity: 'Earthing and bonding continuity',
      acceptanceCriteria: 'All metallic containment continuous to earth; loop impedance < 0.5 ohm to MET.',
      controlPoint: 'W',
      responsibility: 'Test Engineer',
      status: 'pending',
    },
    {
      reference: 'ITP-05',
      activity: 'Insulation resistance test',
      acceptanceCriteria: '>= 1 MOhm at 500 V DC across each circuit; record on commissioning sheet.',
      controlPoint: 'W',
      responsibility: 'Test Engineer',
      status: 'pending',
    },
    {
      reference: 'ITP-06',
      activity: 'Life-safety and security integration test',
      acceptanceCriteria: 'Fire alarm, access control, BMS shutdowns and emergency-lighting outputs match approved cause-and-effect matrix.',
      controlPoint: 'H',
      responsibility: 'Systems Commissioning Engineer',
      status: 'pending',
    },
  ];
  for (const r of itpRows) {
    const id = newId();
    itp[id] = { ...r, id };
  }

  project.sites = sites;
  project.buildings = buildings;
  project.floors = floors;
  project.zones = allZones;
  project.systems = systems;
  project.activeSiteId = siteId;
  project.activeBuildingId = buildingId;
  project.activeFloorId = floorIds.G;
  project.activeSheetId = floorBuildByLevel.G.sheet.id;
  project.cableSchedule = cableSchedule;
  project.penetrationSeals = seals;
  project.itpItems = itp;
  project.fireCompartments = {};
  project.markups = {};
  project.catalogues = loadDefaultCatalogues();

  return project;
};

// Convenience: a fresh empty cable schedule for callers that only need the
// shape rather than the full sample.
export { emptyCableSchedule };
