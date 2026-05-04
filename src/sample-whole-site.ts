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
  WallEntity,
  RoomEntity,
  RiserEntity,
  TextEntity,
} from './types';
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

const newId = (): string => nanoid(10);

// ---------- Identifier conventions ---------------------------------------
//
// Equipment tags follow a simple project-wide scheme:
//   MCC-01            Main switchboard
//   DB-OF-G / DB-OF-1 Office Ground / Level 1 distribution boards
//   DB-PL-G / DB-PL-D Plant Ground / Plant Deck distribution boards
//   FAP-01            Fire alarm panel
//   CR-01             Communications rack
//   IDF-OF-G          Floor IDF cabinets
//   AHU-01 / P-01     Plant items (motor / pump)

// ---------- Display palette -----------------------------------------------

const SYSTEM_COLORS = {
  powerDistribution: '#ff8a3d',
  lighting: '#ffd84d',
  fireAlarm: '#ff3a3a',
  data: '#5cdcff',
  emergencyLighting: '#9ad65a',
} as const;

const CONTAINMENT_COLORS = {
  trunking: '#d4894a',
  basket: '#bcc1c8',
  tray: '#7fb24a',
  conduit: '#3a6db8',
  ladder: '#aa6b3d',
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
  external = false,
): WallEntity => ({
  id: newEntityId(),
  kind: 'wall',
  layerId: layer,
  visible: true,
  locked: false,
  points,
  thickness,
  height: 3000,
  external,
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
): RiserEntity => ({
  id: newEntityId(),
  kind: 'riser',
  layerId: layer,
  visible: true,
  locked: false,
  position,
  width: 600,
  height: 200,
  containmentType: 'tray',
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

interface FloorBuildResult {
  sheet: Sheet;
  zones: Zone[];
  equipment: EquipmentEntity[];
  containment: ContainmentEntity[];
  riserPositions: Vec2[];
}

interface OfficeFloorOpts {
  floorId: string;
  buildingId: string;
  level: 'G' | '1';
  systems: Record<string, SystemId>;
  layers: FloorLayers;
}

// Build an office floor. The two office floors share the same plan
// (a corridor with offices either side, an MCC/riser room, comms),
// just with different equipment tags and a riser cut-out on the upper
// level.
const buildOfficeFloor = (opts: OfficeFloorOpts): FloorBuildResult => {
  const { floorId, level, systems, layers } = opts;
  const sheet: Sheet = {
    id: newId(),
    name: `Office — Level ${level === 'G' ? 'Ground' : '1'}`,
    number: level === 'G' ? '101' : '102',
    kind: 'floor-plan',
    width: 24000,
    height: 16000,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
    sceneStyle: 'building',
    floorId,
    buildingId: opts.buildingId,
  };

  // Zones — referenced by zoneRef on rooms
  const zones: Zone[] = [
    {
      id: newId(),
      floorId,
      name: 'East Office Open Plan',
      classification: 'office',
      ipRating: 'IP20',
      fireRating: 60,
    },
    {
      id: newId(),
      floorId,
      name: 'West Office Open Plan',
      classification: 'office',
      ipRating: 'IP20',
      fireRating: 60,
    },
    {
      id: newId(),
      floorId,
      name: 'Central Corridor',
      classification: 'corridor',
      ipRating: 'IP20',
      fireRating: 60,
    },
    {
      id: newId(),
      floorId,
      name: level === 'G' ? 'MCC Room' : 'Electrical Riser',
      classification: level === 'G' ? 'plant-room' : 'electrical-riser',
      ipRating: 'IP31',
      fireRating: 90,
    },
    {
      id: newId(),
      floorId,
      name: 'Comms Room',
      classification: 'data-room',
      ipRating: 'IP20',
      fireRating: 60,
    },
  ];
  const [zEastOffice, zWestOffice, zCorridor, zPlant, zComms] = zones;

  // Rooms (drawn first so wall lines overlay their boundaries)
  addEntity(sheet, room(layers.room, { x: 0, y: 9500 }, { x: 9500, y: 16000 }, zEastOffice.name, 'office', zEastOffice.id, '#1a2030'));
  addEntity(sheet, room(layers.room, { x: 14500, y: 9500 }, { x: 24000, y: 16000 }, zWestOffice.name, 'office', zWestOffice.id, '#1a2030'));
  addEntity(sheet, room(layers.room, { x: 0, y: 7500 }, { x: 24000, y: 9300 }, zCorridor.name, 'corridor', zCorridor.id, '#262d3a'));
  addEntity(sheet, room(layers.room, { x: 0, y: 0 }, { x: 6500, y: 7300 }, zPlant.name, 'plant-room', zPlant.id, '#3a2a1a'));
  addEntity(sheet, room(layers.room, { x: 7000, y: 0 }, { x: 13500, y: 7300 }, 'Meeting / Storage', 'office', undefined, '#1a2230'));
  addEntity(sheet, room(layers.room, { x: 14000, y: 0 }, { x: 24000, y: 7300 }, zComms.name, 'data-room', zComms.id, '#1a322c'));

  // External perimeter
  addEntity(sheet, wallSegment(layers.wall, [
    { x: 0, y: 0 },
    { x: 24000, y: 0 },
    { x: 24000, y: 16000 },
    { x: 0, y: 16000 },
    { x: 0, y: 0 },
  ], 250, true));

  // North corridor wall (with three doorway gaps)
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 9400 }, { x: 4000, y: 9400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 5000, y: 9400 }, { x: 14000, y: 9400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 15000, y: 9400 }, { x: 19000, y: 9400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 20000, y: 9400 }, { x: 24000, y: 9400 }], 150));

  // South corridor wall (gaps for plant, meeting and comms doors)
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 7400 }, { x: 2000, y: 7400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 3000, y: 7400 }, { x: 8500, y: 7400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 9500, y: 7400 }, { x: 15500, y: 7400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 16500, y: 7400 }, { x: 24000, y: 7400 }], 150));

  // South dividers (between plant / meeting / comms)
  addEntity(sheet, wallSegment(layers.wall, [{ x: 6750, y: 0 }, { x: 6750, y: 7400 }], 200));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 13750, y: 0 }, { x: 13750, y: 7400 }], 200));
  // North divider between east and west open-plan offices
  addEntity(sheet, wallSegment(layers.wall, [{ x: 12000, y: 9400 }, { x: 12000, y: 16000 }], 150));

  // Equipment
  const equipmentList: EquipmentEntity[] = [];
  if (level === 'G') {
    // Main MCC sits in the plant room on the ground floor only
    const mcc = equipment(
      layers.panel,
      'MCC-01',
      'Main Motor Control Centre — 630 A TP+N',
      'mcc',
      { x: 600, y: 4400 },
      { w: 3200, h: 800 },
      systems.powerDistribution,
      { current: 630, voltage: 400, ip: 'IP31' },
    );
    addEntity(sheet, mcc);
    equipmentList.push(mcc);

    // Distribution boards for the office
    const dbA = equipment(
      layers.panel,
      'DB-OF-G',
      'Office Ground DB — 200 A',
      'distribution-board',
      { x: 4500, y: 4500 },
      { w: 800, h: 250 },
      systems.powerDistribution,
      { current: 200, voltage: 400, ip: 'IP31' },
    );
    addEntity(sheet, dbA);
    equipmentList.push(dbA);

    // Fire alarm panel — in plant
    const fap = equipment(
      layers.panel,
      'FAP-01',
      'Addressable Fire Alarm Panel — 4 loop',
      'fire-alarm-panel',
      { x: 600, y: 6200 },
      { w: 800, h: 250 },
      systems.fireAlarm,
      { ip: 'IP30' },
    );
    addEntity(sheet, fap);
    equipmentList.push(fap);
  } else {
    // Office L1 has its own DB on the riser/landing
    const dbB = equipment(
      layers.panel,
      'DB-OF-1',
      'Office Level 1 DB — 200 A',
      'distribution-board',
      { x: 1200, y: 5400 },
      { w: 800, h: 250 },
      systems.powerDistribution,
      { current: 200, voltage: 400, ip: 'IP31' },
    );
    addEntity(sheet, dbB);
    equipmentList.push(dbB);

    // IDF cabinet on the upper floor
    const idf1 = equipment(
      layers.panel,
      'IDF-OF-1',
      'Floor IDF cabinet (24U)',
      'comms-rack',
      { x: 19000, y: 5500 },
      { w: 800, h: 800 },
      systems.data,
      { ip: 'IP20' },
    );
    addEntity(sheet, idf1);
    equipmentList.push(idf1);
  }

  if (level === 'G') {
    // Comms rack in the comms room (ground floor only — building-wide root)
    const cr = equipment(
      layers.panel,
      'CR-01',
      'Main Communications Rack (42U)',
      'comms-rack',
      { x: 14600, y: 4800 },
      { w: 1000, h: 1000 },
      systems.data,
      { ip: 'IP20' },
    );
    addEntity(sheet, cr);
    equipmentList.push(cr);

    // Floor IDF in east office riser corner
    const idfg = equipment(
      layers.panel,
      'IDF-OF-G',
      'Floor IDF cabinet (24U)',
      'comms-rack',
      { x: 8500, y: 9700 },
      { w: 800, h: 800 },
      systems.data,
      { ip: 'IP20' },
    );
    addEntity(sheet, idfg);
    equipmentList.push(idfg);
  }

  // Containment routes — main spine in corridor centre
  const corridorY = 8400;
  const containmentList: ContainmentEntity[] = [];

  // Power trunking spine
  const trunkSpine = containment(
    layers.containment,
    'trunking',
    [{ x: 1200, y: corridorY }, { x: 22800, y: corridorY }],
    400,
    250,
    systems.powerDistribution,
    'Main power trunking — 400×250',
    'power',
  );
  addEntity(sheet, trunkSpine);
  containmentList.push(trunkSpine);

  // Lighting trunking — runs above the same corridor, smaller cross-section
  const lightTrunk = containment(
    layers.containment,
    'trunking',
    [{ x: 1200, y: corridorY + 250 }, { x: 22800, y: corridorY + 250 }],
    150,
    100,
    systems.lighting,
    'Lighting feeder trunking — 150×100',
    'power',
  );
  addEntity(sheet, lightTrunk);
  containmentList.push(lightTrunk);

  // Data basket parallel to the spine
  const dataBasket = containment(
    layers.containment,
    'basket',
    [{ x: 1200, y: corridorY - 250 }, { x: 22800, y: corridorY - 250 }],
    300,
    100,
    systems.data,
    'Data basket — 300×100',
    'data',
  );
  addEntity(sheet, dataBasket);
  containmentList.push(dataBasket);

  // Fire alarm conduit running just below the data basket
  const faConduit = containment(
    layers.containment,
    'conduit',
    [{ x: 600, y: corridorY - 450 }, { x: 23400, y: corridorY - 450 }],
    25,
    undefined,
    systems.fireAlarm,
    'FP200 fire alarm route',
    'fire-alarm',
  );
  addEntity(sheet, faConduit);
  containmentList.push(faConduit);

  // Conduit drops into east and west open-plan offices
  const drop1 = containment(
    layers.containment,
    'conduit',
    [{ x: 5500, y: corridorY }, { x: 5500, y: 12000 }],
    32,
    undefined,
    systems.lighting,
    'Lighting drop east office',
    'power',
  );
  addEntity(sheet, drop1);
  containmentList.push(drop1);

  const drop2 = containment(
    layers.containment,
    'conduit',
    [{ x: 19500, y: corridorY }, { x: 19500, y: 12000 }],
    32,
    undefined,
    systems.lighting,
    'Lighting drop west office',
    'power',
  );
  addEntity(sheet, drop2);
  containmentList.push(drop2);

  // Riser positions — top-left corner of plant on level G, same point on L1
  const riserPositions: Vec2[] = level === 'G' ? [{ x: 1200, y: 6800 }] : [{ x: 1200, y: 6800 }];

  // Title block annotation
  addEntity(sheet, text(layers.annotation, { x: 600, y: 15600 }, level === 'G'
    ? 'OFFICE BUILDING — GROUND FLOOR PLAN'
    : 'OFFICE BUILDING — LEVEL 1 FLOOR PLAN', 200));
  addEntity(sheet, text(layers.annotation, { x: 600, y: 15300 },
    'Power · Lighting · Data · Fire alarm · Emergency lighting',
    100));

  return { sheet, zones, equipment: equipmentList, containment: containmentList, riserPositions };
};

// Plant floor — single open hall plus a mezzanine "deck"
interface PlantFloorOpts {
  floorId: string;
  buildingId: string;
  isMezzanine: boolean;
  systems: Record<string, SystemId>;
  layers: FloorLayers;
}

const buildPlantFloor = (opts: PlantFloorOpts): FloorBuildResult => {
  const { floorId, isMezzanine, systems, layers } = opts;
  const sheet: Sheet = {
    id: newId(),
    name: isMezzanine ? 'Plant Building — Roof Deck' : 'Plant Building — Ground',
    number: isMezzanine ? '202' : '201',
    kind: 'floor-plan',
    width: 30000,
    height: 18000,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
    sceneStyle: 'building',
    floorId,
    buildingId: opts.buildingId,
  };

  const zones: Zone[] = [
    {
      id: newId(),
      floorId,
      name: isMezzanine ? 'Plant Deck' : 'Production Floor',
      classification: isMezzanine ? 'mechanical' : 'plant-room',
      ipRating: isMezzanine ? 'IP54' : 'IP44',
      fireRating: 60,
    },
    {
      id: newId(),
      floorId,
      name: isMezzanine ? 'Roof Riser' : 'MCC Room',
      classification: 'electrical-riser',
      ipRating: 'IP31',
      fireRating: 90,
    },
  ];
  const [zMain, zMcc] = zones;

  // Rooms / footprints
  addEntity(sheet, room(layers.room, { x: 4500, y: 0 }, { x: 30000, y: 18000 }, zMain.name,
    isMezzanine ? 'mechanical' : 'plant-room', zMain.id, isMezzanine ? '#222a30' : '#2a2228'));
  addEntity(sheet, room(layers.room, { x: 0, y: 0 }, { x: 4400, y: 18000 }, zMcc.name,
    'electrical-riser', zMcc.id, '#3a2a1a'));

  // External perimeter
  addEntity(sheet, wallSegment(layers.wall, [
    { x: 0, y: 0 },
    { x: 30000, y: 0 },
    { x: 30000, y: 18000 },
    { x: 0, y: 18000 },
    { x: 0, y: 0 },
  ], 300, true));

  // MCC partition wall with a doorway
  addEntity(sheet, wallSegment(layers.wall, [{ x: 4400, y: 0 }, { x: 4400, y: 7000 }], 200));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 4400, y: 8000 }, { x: 4400, y: 18000 }], 200));

  const equipmentList: EquipmentEntity[] = [];
  const containmentList: ContainmentEntity[] = [];

  if (!isMezzanine) {
    // Plant ground DB
    const db = equipment(
      layers.panel,
      'DB-PL-G',
      'Plant Ground DB — 250 A',
      'distribution-board',
      { x: 600, y: 9000 },
      { w: 1000, h: 350 },
      systems.powerDistribution,
      { current: 250, voltage: 400, ip: 'IP54' },
    );
    addEntity(sheet, db);
    equipmentList.push(db);

    // AHU and pump
    const ahu = equipment(
      layers.panel,
      'AHU-01',
      'Air-handling unit — 38 A',
      'air-handling-unit',
      { x: 8000, y: 8500 },
      { w: 3000, h: 2000 },
      systems.powerDistribution,
      { current: 38, voltage: 400, ip: 'IP54' },
    );
    addEntity(sheet, ahu);
    equipmentList.push(ahu);

    const pump = equipment(
      layers.panel,
      'P-01',
      'Booster pump — 14 A',
      'pump',
      { x: 18000, y: 13500 },
      { w: 1500, h: 1500 },
      systems.powerDistribution,
      { current: 14, voltage: 400, ip: 'IP55' },
    );
    addEntity(sheet, pump);
    equipmentList.push(pump);

    const cabPlant = equipment(
      layers.panel,
      'CAB-PL-G',
      'Plant comms cabinet (12U)',
      'cabinet',
      { x: 600, y: 6500 },
      { w: 800, h: 800 },
      systems.data,
      { ip: 'IP54' },
    );
    addEntity(sheet, cabPlant);
    equipmentList.push(cabPlant);
  } else {
    const dbDeck = equipment(
      layers.panel,
      'DB-PL-D',
      'Plant Deck DB — 125 A',
      'distribution-board',
      { x: 600, y: 9000 },
      { w: 1000, h: 350 },
      systems.powerDistribution,
      { current: 125, voltage: 400, ip: 'IP55' },
    );
    addEntity(sheet, dbDeck);
    equipmentList.push(dbDeck);
  }

  // Containment — heavy ladder on long wall plus a basket spur
  const ladder = containment(
    layers.containment,
    'ladder',
    [{ x: 4500, y: 9000 }, { x: 27000, y: 9000 }],
    600,
    100,
    systems.powerDistribution,
    'Plant ladder — 600 mm',
    'power',
  );
  addEntity(sheet, ladder);
  containmentList.push(ladder);

  const basket = containment(
    layers.containment,
    'basket',
    [{ x: 4500, y: 9300 }, { x: 27000, y: 9300 }],
    300,
    100,
    systems.data,
    'Data basket — 300 mm',
    'data',
  );
  addEntity(sheet, basket);
  containmentList.push(basket);

  const conduit = containment(
    layers.containment,
    'conduit',
    [{ x: 4500, y: 8800 }, { x: 27000, y: 8800 }],
    32,
    undefined,
    systems.fireAlarm,
    'FP200 plant fire alarm',
    'fire-alarm',
  );
  addEntity(sheet, conduit);
  containmentList.push(conduit);

  // Title block
  addEntity(sheet, text(layers.annotation, { x: 600, y: 17500 },
    isMezzanine ? 'PLANT BUILDING — ROOF DECK PLAN' : 'PLANT BUILDING — GROUND FLOOR PLAN', 220));
  addEntity(sheet, text(layers.annotation, { x: 600, y: 17200 },
    'Production hall · Plant DB · Cable management · FA route', 100));

  // Riser position — same north-west corner on both floors
  return { sheet, zones, equipment: equipmentList, containment: containmentList,
    riserPositions: [{ x: 1500, y: 7500 }] };
};

// ---------- Project assembly --------------------------------------------

export const createWholeSiteSampleProject = (): Project => {
  const project = createEmptyProject();
  project.name = 'Whole-Site Containment Demo';
  project.description = 'Multi-floor commercial / light-industrial demo project — Acme Industrial Park';
  project.client = 'Acme Industrial';
  project.engineer = 'OpenCAD Demo';
  project.projectNumber = 'P-2024-001';
  project.originatorCode = 'OPC';
  project.standard = 'IEC';
  project.standardsProfile = DEFAULT_STANDARDS.BS7671;

  // Re-use the existing layer palette. Index pins layer roles to match the
  // order in `defaultLayers()` in store.ts.
  const layers: FloorLayers = {
    containment: project.layerOrder[6],
    wall: project.layerOrder[7],
    room: project.layerOrder[8],
    panel: project.layerOrder[5],
    annotation: project.layerOrder[4],
  };

  // Drop the four default schematic sheets — the whole-site demo is plan
  // driven, so its own sheets are added below.
  for (const sid of project.sheetOrder) delete project.sheets[sid];
  project.sheetOrder = [];

  // ---------- Site / building / floor scaffold ----------
  const siteId = newId();
  const officeBuildingId = newId();
  const plantBuildingId = newId();

  const officeGroundId = newId();
  const officeLevel1Id = newId();
  const plantGroundId = newId();
  const plantDeckId = newId();

  // ---------- Systems (cut-across logical groupings) ----------
  const systemPower: ElectricalSystem = {
    id: newId(),
    name: 'Power Distribution',
    kind: 'power-distribution',
    color: SYSTEM_COLORS.powerDistribution,
    band: 'II',
    description: 'LV mains, sub-mains and final circuits',
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
    description: 'Structured cabling — fibre + Cat 6A',
  };
  const systemEM: ElectricalSystem = {
    id: newId(),
    name: 'Emergency Lighting',
    kind: 'emergency-lighting',
    color: SYSTEM_COLORS.emergencyLighting,
    band: 'II',
    description: 'Self-contained emergency luminaires + maintained circuits',
  };

  const systemMap = {
    powerDistribution: systemPower.id,
    lighting: systemLight.id,
    fireAlarm: systemFA.id,
    data: systemData.id,
    emergencyLighting: systemEM.id,
  };

  const systems: Record<SystemId, ElectricalSystem> = {
    [systemPower.id]: systemPower,
    [systemLight.id]: systemLight,
    [systemFA.id]: systemFA,
    [systemData.id]: systemData,
    [systemEM.id]: systemEM,
  };

  // ---------- Build per-floor sheets ----------
  const officeG = buildOfficeFloor({
    floorId: officeGroundId,
    buildingId: officeBuildingId,
    level: 'G',
    systems: systemMap,
    layers,
  });
  const officeL1 = buildOfficeFloor({
    floorId: officeLevel1Id,
    buildingId: officeBuildingId,
    level: '1',
    systems: systemMap,
    layers,
  });
  const plantG = buildPlantFloor({
    floorId: plantGroundId,
    buildingId: plantBuildingId,
    isMezzanine: false,
    systems: systemMap,
    layers,
  });
  const plantD = buildPlantFloor({
    floorId: plantDeckId,
    buildingId: plantBuildingId,
    isMezzanine: true,
    systems: systemMap,
    layers,
  });

  // Register sheets
  for (const r of [officeG, officeL1, plantG, plantD]) {
    project.sheets[r.sheet.id] = r.sheet;
    project.sheetOrder.push(r.sheet.id);
  }

  // ---------- Risers spanning floors ----------
  const officeRiser = riser(
    layers.containment,
    officeG.riserPositions[0],
    officeGroundId,
    officeLevel1Id,
    systemPower.id,
    'Office vertical riser',
  );
  addEntity(project.sheets[officeG.sheet.id], officeRiser);
  // Mirror riser marker on the upper floor for clarity
  const officeRiserL1 = riser(
    layers.containment,
    officeL1.riserPositions[0],
    officeGroundId,
    officeLevel1Id,
    systemPower.id,
    'Office vertical riser',
  );
  addEntity(project.sheets[officeL1.sheet.id], officeRiserL1);

  const plantRiser = riser(
    layers.containment,
    plantG.riserPositions[0],
    plantGroundId,
    plantDeckId,
    systemPower.id,
    'Plant vertical riser',
  );
  addEntity(project.sheets[plantG.sheet.id], plantRiser);
  const plantRiserDeck = riser(
    layers.containment,
    plantD.riserPositions[0],
    plantGroundId,
    plantDeckId,
    systemPower.id,
    'Plant vertical riser',
  );
  addEntity(project.sheets[plantD.sheet.id], plantRiserDeck);

  // ---------- Build hierarchy records ----------
  const allZones: Record<string, Zone> = {};
  for (const z of [...officeG.zones, ...officeL1.zones, ...plantG.zones, ...plantD.zones]) {
    allZones[z.id] = z;
  }

  const floors: Record<string, Floor> = {
    [officeGroundId]: {
      id: officeGroundId,
      buildingId: officeBuildingId,
      name: 'Ground Floor',
      level: 0,
      ffl: 0,
      floorHeight: 3000,
      slabThickness: 250,
      ceilingVoid: 600,
      raisedFloor: 150,
      zoneOrder: officeG.zones.map((z) => z.id),
      sheetIds: [officeG.sheet.id],
    },
    [officeLevel1Id]: {
      id: officeLevel1Id,
      buildingId: officeBuildingId,
      name: 'Level 1',
      level: 1,
      ffl: 3000,
      floorHeight: 3000,
      slabThickness: 250,
      ceilingVoid: 600,
      raisedFloor: 150,
      zoneOrder: officeL1.zones.map((z) => z.id),
      sheetIds: [officeL1.sheet.id],
    },
    [plantGroundId]: {
      id: plantGroundId,
      buildingId: plantBuildingId,
      name: 'Ground (Plant Hall)',
      level: 0,
      ffl: -100,
      floorHeight: 6000,
      slabThickness: 300,
      ceilingVoid: 1500,
      zoneOrder: plantG.zones.map((z) => z.id),
      sheetIds: [plantG.sheet.id],
    },
    [plantDeckId]: {
      id: plantDeckId,
      buildingId: plantBuildingId,
      name: 'Roof Deck',
      level: 1,
      ffl: 6300,
      floorHeight: 3000,
      slabThickness: 200,
      ceilingVoid: 0,
      zoneOrder: plantD.zones.map((z) => z.id),
      sheetIds: [plantD.sheet.id],
    },
  };

  const buildings: Record<string, Building> = {
    [officeBuildingId]: {
      id: officeBuildingId,
      siteId,
      name: 'Main Office',
      number: 'B-01',
      use: 'Office / commercial',
      height: 6500,
      gridOriginX: 0,
      gridOriginY: 0,
      floorOrder: [officeGroundId, officeLevel1Id],
    },
    [plantBuildingId]: {
      id: plantBuildingId,
      siteId,
      name: 'Plant Building',
      number: 'B-02',
      use: 'Light industrial / plant',
      height: 9500,
      gridOriginX: 30000,
      gridOriginY: 0,
      floorOrder: [plantGroundId, plantDeckId],
    },
  };

  const sites: Record<string, Site> = {
    [siteId]: {
      id: siteId,
      name: 'Acme Industrial Park',
      description: 'Two-building demonstration campus',
      address: '1 Innovation Way, Demo Town',
      supplyVoltage: 400,
      frequency: 50,
      earthingSystem: 'TN-S',
      buildingOrder: [officeBuildingId, plantBuildingId],
    },
  };

  // ---------- Cable schedule ----------
  // Build a tag → entity-id map for from/to references
  const tagMap: Record<string, string> = {};
  const allEquipment: EquipmentEntity[] = [
    ...officeG.equipment,
    ...officeL1.equipment,
    ...plantG.equipment,
    ...plantD.equipment,
  ];
  for (const eq of allEquipment) tagMap[eq.tag] = eq.id;

  const cableSchedule = createSampleCableSchedule({
    byTag: tagMap,
    systems: systemMap,
  });

  // ---------- Penetration seals ----------
  const seals: Record<string, PenetrationSeal> = {};
  const sealRows: Array<{
    ref: string;
    rating: PenetrationSeal['requiredRating'];
    type: PenetrationSeal['sealType'];
  }> = [
    { ref: 'FS-001', rating: 90, type: 'batt' },
    { ref: 'FS-002', rating: 60, type: 'collar' },
    { ref: 'FS-003', rating: 90, type: 'composite' },
    { ref: 'FS-004', rating: 60, type: 'pillow' },
  ];
  // Use the first containment from each floor as a stand-in penetration
  // entity. Boundary entity refs the exterior plant wall.
  const sealCandidates = [
    officeG.containment[0],
    officeL1.containment[0],
    plantG.containment[0],
    plantD.containment[0],
  ];
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
      openingWidth: 200,
      openingHeight: 100,
      status: i === 0 ? 'inspected' : i === 1 ? 'designed' : 'flagged',
      notes: 'Seal at fire compartment boundary — inspect and certify before closing.',
    };
  }

  // ---------- ITP items ----------
  const itp: Record<string, ITPItem> = {};
  const itpRows: Array<Omit<ITPItem, 'id'>> = [
    {
      reference: 'ITP-01',
      activity: 'Containment installation — primary trunking',
      acceptanceCriteria: 'Routes installed on agreed elevation; supports at <=1.2 m centres; clean cuts and capped ends.',
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
      acceptanceCriteria: 'Penetration seals match approved system, no gaps, certified product reference recorded.',
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
      acceptanceCriteria: '>= 1 MΩ at 500 V DC across each circuit; record on commissioning sheet.',
      controlPoint: 'W',
      responsibility: 'Test Engineer',
      status: 'pending',
    },
    {
      reference: 'ITP-06',
      activity: 'Fire alarm cause-and-effect verification',
      acceptanceCriteria: 'Each detector and call-point tested; outputs match cause-and-effect matrix.',
      controlPoint: 'H',
      responsibility: 'FA Commissioning Engineer',
      status: 'pending',
    },
  ];
  for (const r of itpRows) {
    const id = newId();
    itp[id] = { ...r, id };
  }

  // ---------- Stitch onto the project ----------
  project.sites = sites;
  project.buildings = buildings;
  project.floors = floors;
  project.zones = allZones;
  project.systems = systems;
  project.activeSiteId = siteId;
  project.activeBuildingId = officeBuildingId;
  project.activeFloorId = officeGroundId;
  project.activeSheetId = officeG.sheet.id;
  project.cableSchedule = cableSchedule;
  project.penetrationSeals = seals;
  project.itpItems = itp;
  project.fireCompartments = {};
  project.markups = {};

  return project;
};

// Convenience: a fresh empty cable schedule for callers that only need the
// shape rather than the full sample.
export { emptyCableSchedule };
