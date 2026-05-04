// Site / Building / Floor / Zone hierarchy.
//
// In whole-site projects sheets no longer live in a flat list — they
// belong to a floor (or zone) within a building, within a site. The
// existing flat `sheetOrder` is preserved as the canonical iteration
// order; this hierarchy is metadata sitting alongside it.

export type SiteId = string;
export type BuildingId = string;
export type FloorId = string;
export type ZoneId = string;
export type SystemId = string;

export type EarthingSystem = 'TN-C-S' | 'TN-S' | 'TN-C' | 'TT' | 'IT';

export interface Site {
  id: SiteId;
  name: string;
  description?: string;
  // Postal address / project address
  address?: string;
  // WGS84 lat/lng for site placement on a map (optional)
  latitude?: number;
  longitude?: number;
  // Site-wide electrical defaults
  supplyVoltage?: number; // V (e.g. 400, 230)
  frequency?: number; // Hz (50 or 60)
  earthingSystem?: EarthingSystem;
  // Buildings on the site
  buildingOrder: BuildingId[];
}

export interface Building {
  id: BuildingId;
  siteId: SiteId;
  name: string;
  // Building number/code (e.g. "B-01", "Block A")
  number?: string;
  description?: string;
  // Construction type / use classification
  use?: string;
  // Total height in mm
  height?: number;
  // Structural grid reference origin (mm) relative to site
  gridOriginX?: number;
  gridOriginY?: number;
  // Floors in this building, ordered ground-up
  floorOrder: FloorId[];
}

export interface Floor {
  id: FloorId;
  buildingId: BuildingId;
  name: string;
  // Level number (Ground = 0, Basement = -1, etc.)
  level: number;
  // Finished floor level in mm above site datum
  ffl: number;
  // Floor-to-floor height in mm
  floorHeight: number;
  // Slab thickness in mm
  slabThickness?: number;
  // Ceiling void depth in mm (slab to suspended ceiling)
  ceilingVoid?: number;
  // Raised floor depth in mm (structural floor to FFL)
  raisedFloor?: number;
  // Zones within this floor
  zoneOrder: ZoneId[];
  // Sheet IDs assigned to this floor (cross-reference to existing flat sheet list)
  sheetIds: string[];
}

export type ZoneClassification =
  | 'office'
  | 'corridor'
  | 'plant-room'
  | 'electrical-riser'
  | 'data-room'
  | 'mechanical'
  | 'kitchen'
  | 'laboratory'
  | 'wet-area'
  | 'hazardous'
  | 'external'
  | 'retail'
  | 'storage'
  | 'circulation'
  | 'other';

export interface Zone {
  id: ZoneId;
  floorId: FloorId;
  name: string;
  classification: ZoneClassification;
  // Required IP rating for electrical equipment in this zone
  ipRating?: string; // e.g. "IP44"
  // Fire rating required for boundary walls (minutes)
  fireRating?: 0 | 30 | 60 | 90 | 120;
  // Uniclass classification code (e.g. "SL_25_10_70" for office)
  uniclass?: string;
  // Hazardous area zoning (ATEX/IECEx) where applicable
  hazardousZone?: '0' | '1' | '2' | '20' | '21' | '22' | 'safe';
  // Optional bounding rectangle of the zone (mm in floor's coordinate system)
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

// Logical electrical systems cut across the spatial hierarchy. They group
// containment, cables and equipment by function — power vs lighting vs
// fire alarm — independent of which building or floor they're on.
export type SystemKind =
  | 'power-mains'
  | 'power-distribution'
  | 'lighting'
  | 'small-power'
  | 'emergency-lighting'
  | 'fire-alarm'
  | 'security'
  | 'data'
  | 'comms'
  | 'bms'
  | 'av'
  | 'instrumentation'
  | 'earthing'
  | 'lightning-protection'
  | 'other';

export interface ElectricalSystem {
  id: SystemId;
  name: string;
  kind: SystemKind;
  // Display colour for this system on drawings and 3D
  color: string;
  // Cable separation band per BS 7671 (Band I = ELV/data, Band II = mains)
  band?: 'I' | 'II';
  description?: string;
}
