// Core types for OpenCAD Electrical
// Units are in millimeters (mm) for engineering precision

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
  | 'group';

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

export type ContainmentType = 'trunking' | 'basket' | 'tray' | 'conduit';

export interface ContainmentEntity extends BaseEntity {
  kind: 'containment';
  containmentType: ContainmentType;
  points: Vec2[];
  // Cross-section dimensions (mm). For round conduit, `width` is the
  // outside diameter and `height` is ignored.
  width?: number;
  height?: number;
  label?: string;
}

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
}

// Labeled room footprint. In 2D it's a translucent floor patch with the
// room name; in 3D it tints the floor under the room.
export interface RoomEntity extends BaseEntity {
  kind: 'room';
  a: Vec2;
  b: Vec2;
  name?: string;
  floorColor?: string;
}

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
  | GroupEntity;

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

export type SheetKind = 'schematic' | 'panel-layout' | 'one-line' | 'wiring' | 'plc-io';

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
  sceneStyle?: 'panel' | 'building';
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
  | 'wall'
  | 'room';

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
}

export interface DraftState {
  tool: ToolId;
  points: Vec2[];
}
