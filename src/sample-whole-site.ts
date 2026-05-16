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
  trunking: '#bcc1c8',
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
  fireRating?: WallEntity['fireRating'],
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
  fireRating,
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

  // South corridor wall (gaps for plant, meeting and comms doors).
  // The plant / electrical-riser room is a separate fire compartment, so
  // its boundary walls are 90-min fire rated. Comms is rated at 60.
  addEntity(sheet, wallSegment(layers.wall, [{ x: 0, y: 7400 }, { x: 2000, y: 7400 }], 150, false, 90));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 3000, y: 7400 }, { x: 8500, y: 7400 }], 150, false, 90));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 9500, y: 7400 }, { x: 15500, y: 7400 }], 150));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 16500, y: 7400 }, { x: 24000, y: 7400 }], 150, false, 60));

  // South dividers (between plant / meeting / comms). The plant divider is
  // a fire compartment boundary at 90 min; the comms divider at 60 min.
  addEntity(sheet, wallSegment(layers.wall, [{ x: 6750, y: 0 }, { x: 6750, y: 7400 }], 200, false, 90));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 13750, y: 0 }, { x: 13750, y: 7400 }], 200, false, 60));
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
      { current: 630, voltage: 400, ip: 'IP30' },
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
      { current: 200, voltage: 400, ip: 'IP30' },
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
      { current: 200, voltage: 400, ip: 'IP30' },
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

    // End-of-circuit equipment items — used as routing targets for the
    // lighting, sockets, fire alarm and emergency-lighting cables in the
    // sample schedule. They're placed inside rooms close to the spine so
    // the cable router has a real endpoint to terminate at.
    const lt1 = equipment(
      layers.panel, 'LT-OF-G-01', 'East office lighting circuit endpoint',
      'other', { x: 5400, y: 11000 }, { w: 200, h: 200 }, systems.lighting, { ip: 'IP20' },
    );
    addEntity(sheet, lt1); equipmentList.push(lt1);

    const lt2 = equipment(
      layers.panel, 'LT-OF-G-02', 'West office lighting circuit endpoint',
      'other', { x: 19400, y: 11000 }, { w: 200, h: 200 }, systems.lighting, { ip: 'IP20' },
    );
    addEntity(sheet, lt2); equipmentList.push(lt2);

    const skRing = equipment(
      layers.panel, 'SK-OF-G-RING', 'Office G ring final socket outlet',
      'other', { x: 5400, y: 12500 }, { w: 200, h: 200 }, systems.powerDistribution, { ip: 'IP20' },
    );
    addEntity(sheet, skRing); equipmentList.push(skRing);

    const fa1 = equipment(
      layers.panel, 'FA-LOOP-1', 'Fire alarm loop 1 first detector',
      'other', { x: 8000, y: 9000 }, { w: 200, h: 200 }, systems.fireAlarm, { ip: 'IP30' },
    );
    addEntity(sheet, fa1); equipmentList.push(fa1);

    const em1 = equipment(
      layers.panel, 'EM-OF-G-01', 'Emergency lighting circuit endpoint',
      'other', { x: 16000, y: 11200 }, { w: 200, h: 200 }, systems.emergencyLighting, { ip: 'IP20' },
    );
    addEntity(sheet, em1); equipmentList.push(em1);

    // The 11 kV/400 V supply transformer — modelled at the corner of the
    // plant room so the incomer cable has a real source point. The MCC
    // branch is the closest containment.
    const tx = equipment(
      layers.panel, 'TX-01', '11 kV/400 V package substation transformer',
      'transformer', { x: 600, y: 800 }, { w: 1500, h: 1500 }, systems.powerDistribution,
      { current: 1000, voltage: 400, ip: 'IP30' },
    );
    addEntity(sheet, tx); equipmentList.push(tx);
  } else {
    // Office L1 — endpoint stand-ins for lighting and ring circuits.
    const lt1 = equipment(
      layers.panel, 'LT-OF-1-01', 'Level 1 lighting circuit endpoint',
      'other', { x: 5400, y: 11000 }, { w: 200, h: 200 }, systems.lighting, { ip: 'IP20' },
    );
    addEntity(sheet, lt1); equipmentList.push(lt1);

    const skRing = equipment(
      layers.panel, 'SK-OF-1-RING', 'Level 1 ring final socket outlet',
      'other', { x: 19400, y: 12500 }, { w: 200, h: 200 }, systems.powerDistribution, { ip: 'IP20' },
    );
    addEntity(sheet, skRing); equipmentList.push(skRing);
  }

  // Containment routes — main spine in corridor centre
  const corridorY = 8400;
  const containmentList: ContainmentEntity[] = [];

  // Branch x-coordinates — explicit so the spines pick up matching graph
  // nodes at every drop, allowing the cable router to traverse spine→branch.
  const brXMCC = 2200;
  const brXDBg = 4900;
  const brXFAP = 1000;
  const brXIDFg = 8900;
  const brXCR = 15100;
  const brXDB1 = 1600;
  const brXIDF1 = 19400;
  const brXDropEast = 5500;
  const brXDropWest = 19500;
  const brXEM = 16000;

  // Spine vertex sequence — must contain every branch attachment so the
  // containment graph creates shared nodes.
  const powerSpinePoints: Vec2[] = level === 'G'
    ? [
        { x: 1200, y: corridorY },
        { x: brXMCC, y: corridorY },
        { x: brXDBg, y: corridorY },
        { x: brXDropEast, y: corridorY },
        { x: brXEM, y: corridorY },
        { x: brXDropWest, y: corridorY },
        { x: 22800, y: corridorY },
      ]
    : [
        { x: 1200, y: corridorY },
        { x: brXDB1, y: corridorY },
        { x: brXDropEast, y: corridorY },
        { x: brXDropWest, y: corridorY },
        { x: 22800, y: corridorY },
      ];

  // Power trunking spine
  const trunkSpine = containment(
    layers.containment,
    'trunking',
    powerSpinePoints,
    100,
    100,
    systems.powerDistribution,
    'Main power trunking — 100×100',
    'power',
  );
  addEntity(sheet, trunkSpine);
  containmentList.push(trunkSpine);

  // Lighting basket — runs on the left of the corridor spine, smaller cross-section.
  // Vertices placed at every lighting drop so the graph stitches them in.
  const lightBasketPoints: Vec2[] = level === 'G'
    ? [
        { x: 1200, y: corridorY + 250 },
        { x: brXDropEast, y: corridorY + 250 },
        { x: brXEM, y: corridorY + 250 },
        { x: brXDropWest, y: corridorY + 250 },
        { x: 22800, y: corridorY + 250 },
      ]
    : [
        { x: 1200, y: corridorY + 250 },
        { x: brXDropEast, y: corridorY + 250 },
        { x: brXDropWest, y: corridorY + 250 },
        { x: 22800, y: corridorY + 250 },
      ];
  const lightBasket = containment(
    layers.containment,
    'basket',
    lightBasketPoints,
    150,
    100,
    systems.lighting,
    'Lighting basket — 150×100',
    'power',
  );
  addEntity(sheet, lightBasket);
  containmentList.push(lightBasket);

  // Data basket parallel to the spine — vertices at every data-branch drop
  // so the graph stitches in the IDF / CR / IDF-1 branches as shared nodes.
  const dataBasketPoints: Vec2[] = level === 'G'
    ? [
        { x: 1200, y: corridorY - 250 },
        { x: brXIDFg, y: corridorY - 250 },
        { x: brXCR, y: corridorY - 250 },
        { x: 22800, y: corridorY - 250 },
      ]
    : [
        { x: 1200, y: corridorY - 250 },
        { x: brXIDF1, y: corridorY - 250 },
        { x: 22800, y: corridorY - 250 },
      ];
  const dataBasket = containment(
    layers.containment,
    'basket',
    dataBasketPoints,
    300,
    100,
    systems.data,
    'Data basket — 300×100',
    'data',
  );
  addEntity(sheet, dataBasket);
  containmentList.push(dataBasket);

  // Fire alarm conduit running just below the data basket — vertex at the
  // FAP drop and at every FA loop endpoint so the FA branches attach via
  // shared nodes.
  const brXFA1 = 8000;
  const faConduitPoints: Vec2[] = level === 'G'
    ? [
        { x: 600, y: corridorY - 450 },
        { x: brXFAP, y: corridorY - 450 },
        { x: brXFA1, y: corridorY - 450 },
        { x: 23400, y: corridorY - 450 },
      ]
    : [
        { x: 600, y: corridorY - 450 },
        { x: 23400, y: corridorY - 450 },
      ];
  const faConduit = containment(
    layers.containment,
    'conduit',
    faConduitPoints,
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
    [{ x: brXDropEast, y: corridorY }, { x: brXDropEast, y: 12000 }],
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
    [{ x: brXDropWest, y: corridorY }, { x: brXDropWest, y: 12000 }],
    32,
    undefined,
    systems.lighting,
    'Lighting drop west office',
    'power',
  );
  addEntity(sheet, drop2);
  containmentList.push(drop2);

  if (level === 'G') {
    // Emergency lighting drop near the west corridor end
    const emDrop = containment(
      layers.containment,
      'conduit',
      [{ x: brXEM, y: corridorY }, { x: brXEM, y: 11500 }],
      25,
      undefined,
      systems.emergencyLighting,
      'Emergency lighting drop',
      'emergency',
    );
    addEntity(sheet, emDrop);
    containmentList.push(emDrop);
  }

  // Equipment branches — short conduits / trunking dropping from the
  // corridor spine into each room so the cable router can find a node
  // within snap tolerance of every panel/cabinet. Each branch's first
  // vertex must coincide exactly with a vertex on the parent spine so
  // the containment graph stitches them into a connected network.
  if (level === 'G') {
    // Power branch reaching MCC-01 (in plant @ ~y=4800), continuing on
    // to the supply transformer TX-01 in the corner so the incomer cable
    // has a real source-to-MCC route.
    const brMCC = containment(
      layers.containment,
      'trunking',
      [
        { x: brXMCC, y: corridorY },
        { x: brXMCC, y: 4800 },
        { x: brXMCC, y: 1550 },
        { x: 1350, y: 1550 },
      ],
      300,
      250,
      systems.powerDistribution,
      'Incomer route TX-01 → MCC-01',
      'power',
    );
    addEntity(sheet, brMCC);
    containmentList.push(brMCC);

    // Power branch reaching DB-OF-G (in plant @ ~y=4625)
    const brDBg = containment(
      layers.containment,
      'conduit',
      [{ x: brXDBg, y: corridorY }, { x: brXDBg, y: 4625 }],
      63,
      undefined,
      systems.powerDistribution,
      'Branch to DB-OF-G',
      'power',
    );
    addEntity(sheet, brDBg);
    containmentList.push(brDBg);

    // Fire-alarm conduit branch to FAP-01 (in plant @ ~y=6325)
    const brFAP = containment(
      layers.containment,
      'conduit',
      [{ x: brXFAP, y: corridorY - 450 }, { x: brXFAP, y: 6325 }],
      32,
      undefined,
      systems.fireAlarm,
      'Branch to FAP-01',
      'fire-alarm',
    );
    addEntity(sheet, brFAP);
    containmentList.push(brFAP);

    // Fire-alarm conduit drop to FA-LOOP-1 first detector
    const brFA1 = containment(
      layers.containment,
      'conduit',
      [{ x: brXFA1, y: corridorY - 450 }, { x: brXFA1, y: 9100 }],
      25,
      undefined,
      systems.fireAlarm,
      'FA loop 1 drop',
      'fire-alarm',
    );
    addEntity(sheet, brFA1);
    containmentList.push(brFA1);

    // Data basket branch into comms room reaching CR-01 (@ ~(15100,5300))
    const brCR = containment(
      layers.containment,
      'basket',
      [{ x: brXCR, y: corridorY - 250 }, { x: brXCR, y: 5300 }],
      300,
      100,
      systems.data,
      'Branch to CR-01',
      'data',
    );
    addEntity(sheet, brCR);
    containmentList.push(brCR);

    // Data basket branch reaching IDF-OF-G in east office (~y=10100)
    const brIDFg = containment(
      layers.containment,
      'basket',
      [{ x: brXIDFg, y: corridorY - 250 }, { x: brXIDFg, y: 10100 }],
      200,
      100,
      systems.data,
      'Branch to IDF-OF-G',
      'data',
    );
    addEntity(sheet, brIDFg);
    containmentList.push(brIDFg);
  } else {
    // Office L1 — branch reaching DB-OF-1 near riser (~(1600,5525))
    const brDB1 = containment(
      layers.containment,
      'trunking',
      [{ x: brXDB1, y: corridorY }, { x: brXDB1, y: 5525 }],
      150,
      150,
      systems.powerDistribution,
      'Branch to DB-OF-1',
      'power',
    );
    addEntity(sheet, brDB1);
    containmentList.push(brDB1);

    // Data basket branch reaching IDF-OF-1 (~(19400,5900))
    const brIDF1 = containment(
      layers.containment,
      'basket',
      [{ x: brXIDF1, y: corridorY - 250 }, { x: brXIDF1, y: 5900 }],
      200,
      100,
      systems.data,
      'Branch to IDF-OF-1',
      'data',
    );
    addEntity(sheet, brIDF1);
    containmentList.push(brIDF1);
  }

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

  // MCC partition wall with a doorway. The MCC / electrical-riser room is
  // a 90-min fire compartment, so its boundary wall is rated.
  addEntity(sheet, wallSegment(layers.wall, [{ x: 4400, y: 0 }, { x: 4400, y: 7000 }], 200, false, 90));
  addEntity(sheet, wallSegment(layers.wall, [{ x: 4400, y: 8000 }, { x: 4400, y: 18000 }], 200, false, 90));

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

    // FA loop 2 endpoint — first detector in the production hall, placed
    // close to the FA conduit so the router has a real terminator.
    const fa2 = equipment(
      layers.panel,
      'FA-LOOP-2',
      'Fire alarm loop 2 first detector (Plant)',
      'other',
      { x: 14500, y: 8650 },
      { w: 200, h: 200 },
      systems.fireAlarm,
      { ip: 'IP54' },
    );
    addEntity(sheet, fa2);
    equipmentList.push(fa2);
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

  // Branch x-coordinates — must match polyline vertices on the spine.
  const ahuX = 9500;
  const pumpX = 18750;

  // Containment — heavy ladder on long wall plus a basket spur. The
  // ladder polyline has explicit vertices at every drop so the graph
  // creates shared nodes connecting branches.
  const ladderPoints: Vec2[] = !isMezzanine
    ? [
        { x: 4500, y: 9000 },
        { x: ahuX, y: 9000 },
        { x: pumpX, y: 9000 },
        { x: 27000, y: 9000 },
      ]
    : [{ x: 4500, y: 9000 }, { x: 27000, y: 9000 }];
  const ladder = containment(
    layers.containment,
    'ladder',
    ladderPoints,
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

  if (!isMezzanine) {
    // MCC-room riser feeder — runs from ladder across the partition wall
    // (penetration!) into the electrical-riser room and drops to DB-PL-G
    // (~y=9175) and the comms cabinet CAB-PL-G (~y=6900).
    const mccFeeder = containment(
      layers.containment,
      'trunking',
      [
        { x: 4500, y: 9000 },
        { x: 1100, y: 9000 },
        { x: 1100, y: 9175 },
      ],
      200,
      150,
      systems.powerDistribution,
      'MCC-room sub-main feeder',
      'power',
    );
    addEntity(sheet, mccFeeder);
    containmentList.push(mccFeeder);

    // Data branch into the MCC room reaching CAB-PL-G
    const cabBranch = containment(
      layers.containment,
      'basket',
      [
        { x: 4500, y: 9300 },
        { x: 1000, y: 9300 },
        { x: 1000, y: 6900 },
      ],
      200,
      100,
      systems.data,
      'Branch to CAB-PL-G',
      'data',
    );
    addEntity(sheet, cabBranch);
    containmentList.push(cabBranch);

    // AHU drop — short conduit from ladder to AHU-01 connection (~y=9500)
    const ahuBranch = containment(
      layers.containment,
      'conduit',
      [{ x: ahuX, y: 9000 }, { x: ahuX, y: 9500 }],
      40,
      undefined,
      systems.powerDistribution,
      'Branch to AHU-01',
      'power',
    );
    addEntity(sheet, ahuBranch);
    containmentList.push(ahuBranch);

    // Pump P-01 branch — runs from ladder to pump (~y=14250)
    const pumpBranch = containment(
      layers.containment,
      'conduit',
      [{ x: pumpX, y: 9000 }, { x: pumpX, y: 14250 }],
      40,
      undefined,
      systems.powerDistribution,
      'Branch to P-01',
      'power',
    );
    addEntity(sheet, pumpBranch);
    containmentList.push(pumpBranch);
  } else {
    // Plant deck DB sub-main — short branch from ladder up to DB-PL-D
    const dbDeckBranch = containment(
      layers.containment,
      'trunking',
      [
        { x: 4500, y: 9000 },
        { x: 1100, y: 9000 },
        { x: 1100, y: 9175 },
      ],
      150,
      150,
      systems.powerDistribution,
      'Branch to DB-PL-D',
      'power',
    );
    addEntity(sheet, dbDeckBranch);
    containmentList.push(dbDeckBranch);
  }

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

  // Populate per-sheet title block metadata so the title block renders out
  // of the box. Each floor plan gets a unique sequence number under the
  // project / originator code, scoped by level so future drawings on the
  // same floor pick up sequential numbers.
  const today = Date.now();
  type FloorMetaPlan = {
    floorId: string;
    levelCode: string;
    seq: number;
    titleSuffix: string;
  };
  const metaPlan: Record<string, FloorMetaPlan> = {
    [officeG.sheet.id]: { floorId: officeGroundId, levelCode: '00', seq: 1, titleSuffix: 'Ground Floor Plan' },
    [officeL1.sheet.id]: { floorId: officeLevel1Id, levelCode: '01', seq: 2, titleSuffix: 'Level 1 Floor Plan' },
    [plantG.sheet.id]: { floorId: plantGroundId, levelCode: '00', seq: 3, titleSuffix: 'Plant Ground Plan' },
    [plantD.sheet.id]: { floorId: plantDeckId, levelCode: '01', seq: 4, titleSuffix: 'Plant Deck Plan' },
  };
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
      revisions: [
        {
          id: `rev-${sid}-1`,
          code: 'P01',
          status: 'S0',
          date: today,
          description: 'Initial issue',
          author: project.engineer ?? 'OpenCAD Demo',
        },
      ],
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

  // ---------- Penetration seals (manually authored examples) ----------
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

  // Stitch the seals onto the project up-front so the auto-detection step
  // below can pick a unique reference (FS-005 onwards) for any newly
  // detected penetrations without colliding with the manual entries.
  project.penetrationSeals = seals;

  // ---------- Auto-place fittings, supports, penetrations ----------
  // Iterate every containment on every sheet and run the three auto-feature
  // generators. Their output is added to the same sheet, and any newly
  // detected penetration seals merge into the project-wide seal map.
  const floorBuilds = [officeG, officeL1, plantG, plantD] as const;
  for (const fb of floorBuilds) {
    const sheet = project.sheets[fb.sheet.id];
    if (!sheet) continue;
    // Snapshot the containment IDs first — auto-features mutate the sheet
    // entity list and we don't want to iterate over fittings/supports we
    // just placed.
    const containmentIds = fb.containment.map((c) => c.id);
    for (const cid of containmentIds) {
      const fittings = autoPlaceFittingsForContainment(project, fb.sheet.id, cid);
      for (const f of fittings) addEntity(sheet, f as FittingEntity);

      const supports = autoPlaceSupportsForContainment(project, fb.sheet.id, cid);
      for (const s of supports) addEntity(sheet, s as SupportEntity);

      const detected = autoDetectPenetrationsForContainment(project, fb.sheet.id, cid);
      for (const p of detected.penetrations) addEntity(sheet, p as PenetrationEntity);
      for (const sealId of Object.keys(detected.seals)) {
        seals[sealId] = detected.seals[sealId];
      }
      // Update project so the next call's nextSealReference picks unique refs.
      project.penetrationSeals = seals;
    }
  }

  // ---------- Auto-route every cable through the containment graph ----------
  // Aggregate every containment in the project (across floors) — risers
  // are deliberately excluded because they're modelled as point markers,
  // not polylines, so the router can't traverse them. Cables that need to
  // cross buildings will fail and we tag them with a manual-routing note.
  const allContainments: ContainmentEntity[] = [];
  const equipmentCenterById = new Map<string, Vec2>();
  const equipmentCenterByTag = new Map<string, Vec2>();
  const equipmentBuildingByTag = new Map<string, string | undefined>();
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (!e) continue;
      if (e.kind === 'containment') {
        allContainments.push(e as ContainmentEntity);
      } else if (e.kind === 'equipment') {
        const eq = e as EquipmentEntity;
        const center: Vec2 = { x: (eq.a.x + eq.b.x) / 2, y: (eq.a.y + eq.b.y) / 2 };
        equipmentCenterById.set(eq.id, center);
        equipmentCenterByTag.set(eq.tag, center);
        equipmentBuildingByTag.set(eq.tag, sheet.buildingId);
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
      cable.notes =
        'Manual routing required — endpoints not modelled as equipment';
      continue;
    }
    // Pre-flag cross-building cables — the per-building containment networks
    // aren't joined in the graph, so the router can't span them.
    const fromBuilding = equipmentBuildingByTag.get(cable.from);
    const toBuilding = equipmentBuildingByTag.get(cable.to);
    const crossesBuilding = !!(fromBuilding && toBuilding && fromBuilding !== toBuilding);

    const result = routeCableThroughGraph(graph, fromPos, toPos, cable, allContainments, {
      snapTolerance: 2000,
    });
    if (result.found && result.path.length > 0) {
      cable.route = result.path.map((c) => c.id);
      // estimatedLength is in metres (1 dp). result.length is in mm.
      cable.estimatedLength = Math.round(result.length / 100) / 10;
      // Tag affected containments with the cable id so the fill overlay
      // and BOM can sum cables-per-containment.
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
      cable.notes = crossesBuilding
        ? 'Manual routing required — crosses building boundary'
        : result.warnings[0]
          ? `Manual routing required — ${result.warnings[0]}`
          : 'Manual routing required — no compliant path through containment';
    }
  }

  // ---------- Annotations: north arrows, scale bars, grid lines, leaders ----------
  // Floor plans look richer with the standard sheet furniture. We add a
  // north arrow + scale bar in the bottom-left of every plan, two grid
  // lines per sheet, and a couple of leader callouts for the spine and
  // the riser.
  const arrow = (
    layer: LayerId,
    pos: Vec2,
    size = 600,
  ): NorthArrowEntity => ({
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

  const annotateOfficeSheet = (
    sheetRef: Sheet,
    spine: ContainmentEntity,
    riserMarker: RiserEntity,
  ): void => {
    addEntity(sheetRef, arrow(layers.annotation, { x: 1200, y: 1200 }, 700));
    addEntity(sheetRef, scaleBar(layers.annotation, { x: 2200, y: 1000 }, 50, 1000, 5));
    // Office plans are 24m × 16m — gridlines at A/B and 1/2 frame the layout.
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 4000, 0, 16000, 'A'));
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 12000, 0, 16000, 'B'));
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 20000, 0, 16000, 'C'));
    addEntity(sheetRef, gridLine(layers.annotation, 'horizontal', 4000, 0, 24000, '1'));
    addEntity(sheetRef, gridLine(layers.annotation, 'horizontal', 12000, 0, 24000, '2'));
    // Leader callouts pointing to the main spine and riser
    addEntity(sheetRef, leader(layers.annotation,
      [{ x: 12000, y: 8400 }, { x: 13000, y: 11000 }, { x: 16000, y: 11000 }],
      'Main power trunking — 100×100',
      spine.id,
    ));
    addEntity(sheetRef, leader(layers.annotation,
      [{ x: riserMarker.position.x, y: riserMarker.position.y },
       { x: 3500, y: 4500 }, { x: 5500, y: 4500 }],
      'Vertical power riser',
      riserMarker.id,
    ));
  };

  const annotatePlantSheet = (
    sheetRef: Sheet,
    spine: ContainmentEntity,
    riserMarker: RiserEntity,
  ): void => {
    addEntity(sheetRef, arrow(layers.annotation, { x: 1500, y: 1500 }, 800));
    addEntity(sheetRef, scaleBar(layers.annotation, { x: 2700, y: 1300 }, 50, 1000, 5));
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 5000, 0, 18000, 'A'));
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 15000, 0, 18000, 'B'));
    addEntity(sheetRef, gridLine(layers.annotation, 'vertical', 25000, 0, 18000, 'C'));
    addEntity(sheetRef, gridLine(layers.annotation, 'horizontal', 5000, 0, 30000, '1'));
    addEntity(sheetRef, gridLine(layers.annotation, 'horizontal', 12000, 0, 30000, '2'));
    addEntity(sheetRef, leader(layers.annotation,
      [{ x: 14000, y: 9000 }, { x: 15000, y: 5000 }, { x: 17500, y: 5000 }],
      'Plant ladder — 600 mm cable run',
      spine.id,
    ));
    addEntity(sheetRef, leader(layers.annotation,
      [{ x: riserMarker.position.x, y: riserMarker.position.y },
       { x: 3000, y: 5000 }, { x: 5500, y: 5000 }],
      'Plant vertical riser',
      riserMarker.id,
    ));
  };

  annotateOfficeSheet(project.sheets[officeG.sheet.id], officeG.containment[0], officeRiser);
  annotateOfficeSheet(project.sheets[officeL1.sheet.id], officeL1.containment[0], officeRiserL1);
  annotatePlantSheet(project.sheets[plantG.sheet.id], plantG.containment[0], plantRiser);
  annotatePlantSheet(project.sheets[plantD.sheet.id], plantD.containment[0], plantRiserDeck);

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
  project.catalogues = loadDefaultCatalogues();

  return project;
};

// Convenience: a fresh empty cable schedule for callers that only need the
// shape rather than the full sample.
export { emptyCableSchedule };
