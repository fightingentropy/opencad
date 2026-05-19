// Core types for OpenCAD Electrical
// Units are in millimeters (mm) for engineering precision

import type {
  Site,
  Building,
  Floor,
  Zone,
  ElectricalSystem,
  SiteId,
  BuildingId,
  FloorId,
  ZoneId,
  SystemId,
} from './models/site';
import type { CableSchedule } from './models/cable';
import type { StandardsProfile } from './models/standards';
import type { Catalogue, MaterialSpec } from './models/catalogue';
import type { SheetMeta, MarkupItem, ConstructionPhase } from './models/revision';
import type { PenetrationSeal, FireCompartment, ITPItem, FireRating } from './models/fire';

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type EntityId = string;
export type LayerId = string;
export type SheetId = string;
export type SymbolId = string;

export type EntityKind =
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'text'
  | 'wire'
  | 'bus'
  | 'symbol'
  | 'dimension'
  | 'wire-label'
  | 'containment'
  | 'wall'
  | 'room'
  | 'group'
  // New entity kinds for whole-site containment design
  | 'fitting'
  | 'support'
  | 'fire-barrier'
  | 'penetration'
  | 'equipment'
  | 'riser'
  | 'leader'
  | 'section-marker'
  | 'level-marker'
  | 'north-arrow'
  | 'scale-bar'
  | 'grid-line'
  | 'revision-cloud'
  | 'cloud'
  | 'underlay';

export interface BaseEntity {
  id: EntityId;
  kind: EntityKind;
  layerId: LayerId;
  visible: boolean;
  locked: boolean;
  // optional override; otherwise inherits from layer
  color?: string;
  lineWidth?: number;
  lineDash?: number[];
  // Project hierarchy / lifecycle metadata (all optional, backward compat)
  systemId?: SystemId;
  zoneId?: ZoneId;
  phase?: ConstructionPhase;
  // Construction status — overrides lifecycle when as-built differs
  asBuiltStatus?: 'as-designed' | 'modified' | 'added' | 'removed';
}

export interface LineEntity extends BaseEntity {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export interface PolylineEntity extends BaseEntity {
  kind: 'polyline';
  points: Vec2[];
  closed: boolean;
}

export interface RectangleEntity extends BaseEntity {
  kind: 'rectangle';
  a: Vec2;
  b: Vec2;
  fill?: string;
}

export interface CircleEntity extends BaseEntity {
  kind: 'circle';
  center: Vec2;
  radius: number;
  fill?: string;
}

export interface ArcEntity extends BaseEntity {
  kind: 'arc';
  center: Vec2;
  radius: number;
  startAngle: number; // radians
  endAngle: number;
}

export interface EllipseEntity extends BaseEntity {
  kind: 'ellipse';
  center: Vec2;
  rx: number;
  ry: number;
  rotation: number;
}

export interface TextEntity extends BaseEntity {
  kind: 'text';
  position: Vec2;
  text: string;
  fontSize: number;
  rotation: number;
  align?: 'left' | 'center' | 'right';
}

export interface WireEntity extends BaseEntity {
  kind: 'wire';
  points: Vec2[];
  wireNumber?: string;
  wireType?: string; // e.g. "L1", "L2", "N", "PE", "120VAC", "24VDC"
  gauge?: string; // e.g. "12 AWG", "2.5 mm²"
  // Optional link to a Cable in the cable schedule
  cableId?: string;
}

export interface BusEntity extends BaseEntity {
  kind: 'bus';
  points: Vec2[];
  label?: string;
}

export interface SymbolEntity extends BaseEntity {
  kind: 'symbol';
  symbolId: SymbolId;
  position: Vec2;
  rotation: number; // radians
  scale: number;
  mirror?: boolean;
  // Component metadata
  tag?: string; // e.g. "M1", "K3", "F-101"
  description?: string;
  manufacturer?: string;
  partNumber?: string;
  rating?: string;
  // Override pin mappings or wire numbers
  attributes?: Record<string, string>;
}

export interface DimensionEntity extends BaseEntity {
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  offset: number;
  text?: string;
}

export interface WireLabelEntity extends BaseEntity {
  kind: 'wire-label';
  position: Vec2;
  rotation: number;
  text: string;
  wireId?: EntityId;
}

export interface GroupEntity extends BaseEntity {
  kind: 'group';
  childIds: EntityId[];
}

// ---------- Containment (expanded) ----------

export type ContainmentType = 'trunking' | 'basket' | 'tray' | 'conduit' | 'ladder' | 'duct' | 'busbar';

export type ContainmentSubType =
  // Tray sub-types
  | 'perforated'
  | 'solid-bottom'
  | 'return-flange'
  // Ladder sub-types
  | 'standard-ladder'
  | 'heavy-duty-ladder'
  // Basket sub-types
  | 'wire-mesh'
  // Trunking sub-types
  | 'mini'
  | 'standard'
  | 'maxi'
  | 'dado'
  | 'skirting'
  | 'floor'
  | 'bench'
  | 'duct-trunking' // panel wireway
  // Conduit sub-types
  | 'rigid-pvc'
  | 'rigid-steel'
  | 'flexible-metal'
  | 'flexible-plastic'
  | 'lsoh-conduit'
  // Duct sub-types
  | 'underground-duct'
  | 'cable-trench'
  // Busbar sub-types
  | 'lighting-busbar'
  | 'feeder-busbar'
  | 'plug-in-busbar'
  | 'sandwich-busbar';

export type ContainmentMaterial =
  | 'galvanised-steel'
  | 'pre-galvanised-steel'
  | 'hot-dip-galvanised'
  | 'stainless-304'
  | 'stainless-316'
  | 'stainless-316L'
  | 'aluminium'
  | 'pvc'
  | 'lsoh'
  | 'grp'
  | 'frp'
  | 'copper'
  | 'other';

export type ContainmentFinish =
  | 'mill'
  | 'painted'
  | 'powder-coat'
  | 'hot-dip-galv'
  | 'electro-galv'
  | 'plastic-coat'
  | 'pre-galv'
  | 'natural';

export type IpRating =
  | 'IP20' | 'IP30' | 'IP40' | 'IP44' | 'IP54' | 'IP55' | 'IP65' | 'IP66' | 'IP67' | 'IP68';

export type LoadClass = 'A' | 'B' | 'C' | 'D'; // IEC 61537 load classes

export interface ContainmentEntity extends BaseEntity {
  kind: 'containment';
  containmentType: ContainmentType;
  subType?: ContainmentSubType;
  points: Vec2[];
  // Cross-section dimensions (mm). For round conduit, `width` is the
  // outside diameter and `height` is ignored.
  width?: number;
  height?: number;
  // Internal cross-section area (mm²) for fill calculations.
  // If not set, calculated from width × height with a deduction for walls.
  innerCsaMm2?: number;
  label?: string;
  // Z-elevation above floor finish level (mm). Defaults to per-type
  // ceiling-void elevation when omitted.
  elevation?: number;
  // Material / finish / mechanical properties
  material?: ContainmentMaterial;
  finish?: ContainmentFinish;
  loadClass?: LoadClass;
  // Environmental ratings
  ipRating?: IpRating;
  fireRating?: FireRating;
  // Cable category — drives segregation rules
  cableCategory?: 'power' | 'data' | 'fire-alarm' | 'emergency' | 'comms' | 'instrumentation' | 'mixed';
  // Number of internal compartments (for multi-compartment trunking)
  compartments?: number;
  // Manufacturer link
  manufacturer?: string;
  catalogProductId?: string;
  catalogPartNumber?: string;
  // Cables routed through this segment (list of CableId)
  assignedCableIds?: string[];
}

// ---------- Architectural ----------

// Architectural wall — a polyline with thickness. In 3D it's extruded
// vertically from floor to wallHeight (default 3000 mm). Multiple wall
// entities can share endpoints to form rooms; gaps in the polyline make
// doorways without needing CSG holes.
export interface WallEntity extends BaseEntity {
  kind: 'wall';
  points: Vec2[];
  // Wall thickness (mm)
  thickness: number;
  // Wall height (mm). Defaults to 3000 if omitted.
  height?: number;
  // Fire compartment boundary marker — the wall acts as a fire barrier
  fireRating?: FireRating;
  // Wall construction (drywall, masonry, ...)
  construction?: 'masonry' | 'concrete' | 'metal-stud' | 'timber-stud' | 'glazed' | 'other';
  // External vs internal
  external?: boolean;
}

// Labeled room footprint. In 2D it's a translucent floor patch with the
// room name; in 3D it tints the floor under the room.
export interface RoomEntity extends BaseEntity {
  kind: 'room';
  a: Vec2;
  b: Vec2;
  name?: string;
  floorColor?: string;
  // Room number / reference
  number?: string;
  // Cross-reference to the structured Zone
  zoneRef?: ZoneId;
  // Required IP rating for equipment in this room
  ipRating?: IpRating;
  // Hazardous area zoning
  hazardousZone?: '0' | '1' | '2' | '20' | '21' | '22' | 'safe';
}

// ---------- Containment fittings, supports, fire barriers, equipment ----------

export type FittingKind =
  | 'flat-bend'
  | 'inside-riser'
  | 'outside-riser'
  | 'tee'
  | 'cross'
  | 'reducer'
  | 'coupler'
  | 'end-cap'
  | 'end-plate'
  | 'transition'
  | 'expansion-coupling'
  | 'adaptable-box'
  | 'pull-box';

// Auto-generated or user-placed containment fitting at a route junction.
// Most fittings are derived from the geometry of containment polylines
// (every direction change → a flat-bend; every junction → a tee/cross).
export interface FittingEntity extends BaseEntity {
  kind: 'fitting';
  fittingKind: FittingKind;
  // Position — the centre of the fitting
  position: Vec2;
  // Rotation in radians (orient the fitting along the containment direction)
  rotation: number;
  // Sweep angle for bends (degrees: 30 / 45 / 60 / 90)
  angleDeg?: number;
  // Containment entity this fitting belongs to (or first if at junction)
  containmentId: EntityId;
  // Width / height of the fitting (matches parent containment by default)
  width?: number;
  height?: number;
  // For reducers — the size on the outgoing side
  reducerWidth?: number;
  reducerHeight?: number;
  // Catalogue link
  manufacturer?: string;
  catalogProductId?: string;
  catalogPartNumber?: string;
  // Auto-generated flag — these get re-derived if the route changes
  autoGenerated?: boolean;
}

export type SupportKind =
  | 'wall-bracket'
  | 'cantilever-arm'
  | 'trapeze-hanger'
  | 'ceiling-bracket'
  | 'floor-stand'
  | 'a-frame'
  | 'beam-clamp'
  | 'saddle-clip'
  | 'multi-saddle'
  | 'channel-bracket'
  | 'unistrut-frame';

export interface SupportEntity extends BaseEntity {
  kind: 'support';
  supportKind: SupportKind;
  position: Vec2;
  rotation: number;
  // The containment(s) this support carries
  supportingContainmentIds: EntityId[];
  // Z-elevation of the support point (top of support, at containment underside)
  elevation?: number;
  // Mechanical
  rodLength?: number; // mm — for trapeze hangers
  channelLength?: number; // mm
  safeWorkingLoadKg?: number;
  // Fixing into structure
  anchorType?: 'expansion' | 'drop-in' | 'through-bolt' | 'beam-clamp' | 'channel-nut' | 'wall-plug' | 'cast-in';
  // BOM linkage
  catalogProductId?: string;
  // Auto-placed by the support generator
  autoGenerated?: boolean;
}

// A fire compartment boundary marker — pairs with an existing WallEntity
// or stands alone for floor slabs. Walls / floors with fireRating set
// implicitly act as boundaries.
export interface FireBarrierEntity extends BaseEntity {
  kind: 'fire-barrier';
  // Polyline path of the boundary (typically follows a wall)
  points: Vec2[];
  rating: FireRating;
  // Boundary type
  boundaryKind: 'wall' | 'floor' | 'ceiling';
  // Reference to the wall entity if paired
  wallEntityId?: EntityId;
  // Optional name e.g. "Electrical Riser compartment"
  label?: string;
}

// A discrete penetration through a fire barrier — holds the seal record.
export interface PenetrationEntity extends BaseEntity {
  kind: 'penetration';
  position: Vec2;
  // The fire barrier being penetrated
  barrierEntityId: EntityId;
  // The containment / cable causing the penetration
  penetrationOf: EntityId;
  // Reference to the PenetrationSeal record on the project
  sealId: string;
  // Auto-detected by the auto-features pipeline (vs user-placed)
  autoGenerated?: boolean;
}

// Distribution boards, panels, transformers, motors, generators —
// large equipment placed in plan rather than as schematic symbols.
export type EquipmentKind =
  | 'distribution-board'
  | 'mcc'
  | 'panelboard'
  | 'switchboard'
  | 'transformer'
  | 'generator'
  | 'ups'
  | 'motor'
  | 'pump'
  | 'fan'
  | 'air-handling-unit'
  | 'control-panel'
  | 'fire-alarm-panel'
  | 'comms-rack'
  | 'cabinet'
  | 'enclosure'
  | 'meter'
  | 'busbar-tap-off'
  | 'other';

export interface EquipmentEntity extends BaseEntity {
  kind: 'equipment';
  equipmentKind: EquipmentKind;
  // Footprint corners (axis-aligned rectangle)
  a: Vec2;
  b: Vec2;
  rotation?: number;
  // Equipment identifier — must be unique in the project for cable refs
  tag: string;
  description?: string;
  // Z elevation of the equipment base (mm above FFL). Most equipment
  // sits on the floor (elevation 0); ceiling-mounted is given a value.
  elevation?: number;
  // Equipment height (mm)
  height?: number;
  // Electrical ratings
  ratedCurrent?: number; // A
  ratedVoltage?: number; // V
  shortCircuitRating?: number; // kA
  ipRating?: IpRating;
  // BOM linkage
  manufacturer?: string;
  partNumber?: string;
  catalogProductId?: string;
  // Connection points — locations on the equipment where containment
  // connects. Used by the cable router to know where to terminate.
  connections?: { name: string; position: Vec2; type?: 'top' | 'bottom' | 'side' }[];
}

// Vertical containment between floors. Risers are special-cased so the
// 3D view can show them spanning multiple floors and the riser-diagram
// view can extract them by floor.
export interface RiserEntity extends BaseEntity {
  kind: 'riser';
  position: Vec2;
  // Containment cross-section (matches parent containment if specified)
  width: number;
  height: number;
  containmentType: ContainmentType;
  // Bottom and top floor IDs the riser spans
  fromFloorId?: FloorId;
  toFloorId?: FloorId;
  // Or absolute Z elevations
  fromElevation?: number;
  toElevation?: number;
  // Cables routed through the riser
  assignedCableIds?: string[];
  label?: string;
}

// ---------- Annotation / drawing furniture ----------

export interface LeaderEntity extends BaseEntity {
  kind: 'leader';
  // Leader path: typically [tip, elbow, text-end]. Tip is the arrow.
  points: Vec2[];
  text: string;
  fontSize?: number;
  // Style
  arrowStyle?: 'arrow' | 'dot' | 'none';
  // Optional reference to the entity being called out
  targetEntityId?: EntityId;
}

export interface SectionMarkerEntity extends BaseEntity {
  kind: 'section-marker';
  // Cut line: from a to b. The section is taken along this line.
  a: Vec2;
  b: Vec2;
  // Section reference label e.g. "A-A"
  label: string;
  // The sheet ID where the cross-section view is drawn
  targetSheetId?: SheetId;
  // Direction of view (cross marker triangle)
  viewDirection?: 'left' | 'right';
}

export interface LevelMarkerEntity extends BaseEntity {
  kind: 'level-marker';
  position: Vec2;
  // Elevation in mm above project datum
  elevation: number;
  // Display label e.g. "+2700 FFL", "+0 GROUND"
  label?: string;
}

export interface NorthArrowEntity extends BaseEntity {
  kind: 'north-arrow';
  position: Vec2;
  // Orientation of north (degrees clockwise from up)
  northAngle?: number;
  // Diameter of the arrow symbol (mm)
  size?: number;
}

export interface ScaleBarEntity extends BaseEntity {
  kind: 'scale-bar';
  position: Vec2;
  // Major segment size in mm at 1:1 (e.g. 1000 = 1m)
  segmentLength: number;
  // Number of segments
  segments: number;
  // The drawing scale this bar represents (e.g. 50 for 1:50)
  scale: number;
}

export interface GridLineEntity extends BaseEntity {
  kind: 'grid-line';
  // Whether this is a horizontal (numbered) or vertical (lettered) gridline
  orientation: 'horizontal' | 'vertical';
  // Position (x for vertical, y for horizontal)
  offset: number;
  // Extents (mm)
  start: number;
  end: number;
  // Bubble label e.g. "A", "1"
  label: string;
}

export interface RevisionCloudEntity extends BaseEntity {
  kind: 'revision-cloud';
  // Cloud border path
  points: Vec2[];
  // Revision tag (e.g. "1", "2", "P02")
  revisionTag?: string;
}

export interface CloudEntity extends BaseEntity {
  kind: 'cloud';
  points: Vec2[];
}

// Imported drawing underlay — DWG/DXF/PDF rendered as a locked background.
export interface UnderlayEntity extends BaseEntity {
  kind: 'underlay';
  // Underlay rendering — either a list of primitives or a raster image
  origin: Vec2;
  // For raster: image data url + scale
  imageDataUrl?: string;
  // For vector: pre-rendered DXF primitives flattened to lines
  vectors?: { a: Vec2; b: Vec2; color?: string }[];
  width: number;
  height: number;
  rotation?: number;
  scale?: number;
  // Source filename
  sourceName?: string;
  // Locked underlays don't accept selections
  underlayLocked?: boolean;
  // Display opacity 0..1
  opacity?: number;
}

// ---------- Discriminated union ----------

export type Entity =
  | LineEntity
  | PolylineEntity
  | RectangleEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | TextEntity
  | WireEntity
  | BusEntity
  | SymbolEntity
  | DimensionEntity
  | WireLabelEntity
  | ContainmentEntity
  | WallEntity
  | RoomEntity
  | GroupEntity
  | FittingEntity
  | SupportEntity
  | FireBarrierEntity
  | PenetrationEntity
  | EquipmentEntity
  | RiserEntity
  | LeaderEntity
  | SectionMarkerEntity
  | LevelMarkerEntity
  | NorthArrowEntity
  | ScaleBarEntity
  | GridLineEntity
  | RevisionCloudEntity
  | CloudEntity
  | UnderlayEntity;

// ---------- Symbol library ----------

export interface SymbolPin {
  id: string;
  name: string; // e.g. "1", "2", "A1", "A2"
  position: Vec2; // relative to symbol origin
  type?: 'input' | 'output' | 'power' | 'ground' | 'bidirectional';
}

export type SymbolPrimitive =
  | { kind: 'line'; a: Vec2; b: Vec2; lineWidth?: number }
  | { kind: 'circle'; c: Vec2; r: number; fill?: string; lineWidth?: number }
  | { kind: 'arc'; c: Vec2; r: number; start: number; end: number; lineWidth?: number }
  | { kind: 'rect'; a: Vec2; b: Vec2; fill?: string; lineWidth?: number }
  | { kind: 'polyline'; points: Vec2[]; closed?: boolean; fill?: string; lineWidth?: number }
  | { kind: 'text'; p: Vec2; text: string; size: number; align?: 'left' | 'center' | 'right' };

export interface SymbolDef {
  id: SymbolId;
  name: string;
  category: SymbolCategory;
  description?: string;
  // bounding box for hit-testing & placement preview
  bounds: Bounds;
  pins: SymbolPin[];
  primitives: SymbolPrimitive[];
  // default tag prefix (e.g. "M" for motor, "K" for relay)
  tagPrefix?: string;
  // standard: IEEE / IEC / NEMA
  standard?: 'IEEE' | 'IEC' | 'NEMA' | 'JIC';
}

export type SymbolCategory =
  | 'power-source'
  | 'switch'
  | 'contactor-relay'
  | 'motor'
  | 'transformer'
  | 'fuse-breaker'
  | 'sensor'
  | 'plc-io'
  | 'pushbutton'
  | 'indicator'
  | 'terminal'
  | 'connector'
  | 'ground'
  | 'resistor-capacitor'
  | 'diode-led'
  | 'panel-component'
  | 'one-line';

// ---------- Layers ----------

export interface Layer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  lineWidth: number;
  lineDash?: number[];
}

// ---------- Sheets / Project ----------

export type SheetKind =
  | 'schematic'
  | 'panel-layout'
  | 'one-line'
  | 'wiring'
  | 'plc-io'
  // New sheet kinds for whole-site projects
  | 'floor-plan'
  | 'site-plan'
  | 'elevation'
  | 'cross-section'
  | 'riser-diagram'
  | 'detail'
  | 'cable-schedule'
  | 'containment-schedule';

export interface Sheet {
  id: SheetId;
  name: string;
  number: string;
  kind: SheetKind;
  // page size in mm; ANSI B = 432 x 279, A3 = 420 x 297
  width: number;
  height: number;
  entities: Record<EntityId, Entity>;
  entityOrder: EntityId[];
  background?: string;
  // 3D scene style. 'panel' (default) renders the panel enclosure with door,
  // DIN rails and ducts. 'building' renders a clean floor with no enclosure
  // — useful for showing containment runs in a corridor or open space.
  sceneStyle?: 'panel' | 'building' | 'site';
  // Floor / building / zone this sheet belongs to (whole-site projects)
  floorId?: FloorId;
  buildingId?: BuildingId;
  zoneId?: ZoneId;
  // Sheet-level metadata: title block, revisions, status, etc.
  meta?: SheetMeta;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  client?: string;
  engineer?: string;
  created: number;
  modified: number;
  layers: Record<LayerId, Layer>;
  layerOrder: LayerId[];
  sheets: Record<SheetId, Sheet>;
  sheetOrder: SheetId[];
  activeSheetId: SheetId;
  activeLayerId: LayerId;
  // unit system
  units: 'mm' | 'in';
  standard: 'IEEE' | 'IEC';

  // -------- Whole-site extensions (all optional, backward compat) --------
  // Site / building / floor / zone hierarchy
  sites?: Record<SiteId, Site>;
  buildings?: Record<BuildingId, Building>;
  floors?: Record<FloorId, Floor>;
  zones?: Record<ZoneId, Zone>;
  systems?: Record<SystemId, ElectricalSystem>;
  activeSiteId?: SiteId;
  activeBuildingId?: BuildingId;
  activeFloorId?: FloorId;

  // Cable schedule (project-wide)
  cableSchedule?: CableSchedule;

  // Standards profile (drives calc rules)
  standardsProfile?: StandardsProfile;

  // Catalogue references
  catalogues?: Record<string, Catalogue>;
  materialSpec?: MaterialSpec;

  // Fire compartments and penetration seals
  fireCompartments?: Record<string, FireCompartment>;
  penetrationSeals?: Record<string, PenetrationSeal>;

  // Inspection & test plan items
  itpItems?: Record<string, ITPItem>;

  // Markup / review threads
  markups?: Record<string, MarkupItem>;

  // Project number — used by drawing numbering
  projectNumber?: string;
  // Originator code for drawing numbering
  originatorCode?: string;
}

// ---------- Tools / Editor State ----------

export type SnapKind =
  | 'grid'
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'pin'
  | 'center'
  | 'perpendicular'
  | 'none';

export type ToolId =
  | 'select'
  | 'pan'
  | 'line'
  | 'wire'
  | 'bus'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'polyline'
  | 'text'
  | 'dimension'
  | 'symbol'
  | 'erase'
  | 'measure'
  | 'trunking'
  | 'basket'
  | 'tray'
  | 'conduit'
  | 'ladder'
  | 'wall'
  | 'room'
  // New tools for whole-site design
  | 'equipment'
  | 'support'
  | 'leader'
  | 'section-marker'
  | 'level-marker'
  | 'north-arrow'
  | 'scale-bar'
  | 'revision-cloud'
  | 'fire-barrier';

export interface Viewport {
  x: number; // pan in world coords
  y: number;
  zoom: number; // pixels per mm
}

export interface SnapSettings {
  enabled: boolean;
  grid: boolean;
  osnap: boolean; // master toggle for all object-snap types (F3)
  endpoint: boolean;
  midpoint: boolean;
  intersection: boolean;
  perpendicular: boolean;
  pin: boolean;
  gridSize: number; // mm
}

export interface EditorState {
  tool: ToolId;
  selection: Set<EntityId>;
  hover: EntityId | null;
  viewport: Viewport;
  snap: SnapSettings;
  // tool-specific transient state
  drafting: DraftState | null;
  // currently selected symbol from library, for placement
  pendingSymbol: SymbolId | null;
  // pointer position in world coords (for ghost rendering)
  cursor: Vec2;
  cursorSnap: Vec2 | null;
  cursorSnapKind: SnapKind;
  // ortho mode constrains drawing to 0/90
  ortho: boolean;
  // show 3D panel preview side-by-side
  // 2D-only, split (2D + 3D), or 3D-only
  viewMode: '2d' | 'split' | '3d';
  // command line history
  commandHistory: string[];
  statusMessage: string;
  // Phase filter — show only entities in this phase
  phaseFilter?: ConstructionPhase | 'all';
  // System filter — show only entities for this system
  systemFilter?: SystemId | 'all';
  // Compliance overlay — colour containment by fill % / segregation
  complianceOverlay?: 'off' | 'fill' | 'segregation' | 'support-spacing';
}

export interface DraftState {
  tool: ToolId;
  points: Vec2[];
}

// Re-export the new model types so consumers can import from one place.
export type {
  Site,
  Building,
  Floor,
  Zone,
  ElectricalSystem,
  SiteId,
  BuildingId,
  FloorId,
  ZoneId,
  SystemId,
};
export type { PenetrationSeal, FireCompartment, ITPItem, FireRating };
