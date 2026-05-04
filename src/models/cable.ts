// Cable schedule — first-class model of every physical cable in a project.
//
// A `Cable` is distinct from a `WireEntity` (which is a schematic line on
// a drawing). One cable typically appears on one schematic and is then
// routed through many containment segments. The `route` is the ordered
// list of containment entity IDs the cable passes through.

import type { EntityId } from '../types';
import type { SystemId } from './site';

export type CableId = string;

// Cable insulation / construction codes.
export type CableConstruction =
  | 'XLPE/SWA/LSOH' // SWA armoured, LSZH outer
  | 'XLPE/SWA/PVC'
  | 'XLPE/PVC'
  | 'PVC/PVC'
  | 'LSF/LSF' // low smoke fume
  | 'FP200' // fire-rated (Prysmian/MICC)
  | 'FP400'
  | 'MICC' // mineral-insulated copper-clad
  | 'CY' // overall screened (instrumentation)
  | 'SY' // steel-wire-braided
  | 'YY' // unscreened control
  | 'fibre-OS2'
  | 'fibre-OM3'
  | 'fibre-OM4'
  | 'fibre-OM5'
  | 'cat5e'
  | 'cat6'
  | 'cat6a'
  | 'cat7'
  | 'coax'
  | 'other';

export type CableCircuitType =
  | 'power'
  | 'control'
  | 'data'
  | 'fire-alarm'
  | 'emergency'
  | 'instrumentation'
  | 'comms'
  | 'av'
  | 'earthing';

export interface Cable {
  id: CableId;
  // Project-unique reference (e.g. "C-101", "PW-MCC-DB1-001")
  reference: string;
  description?: string;
  // From / To equipment tags. Free text references; link via `fromEntityId`
  // and `toEntityId` if the equipment is modelled.
  from: string;
  to: string;
  fromEntityId?: EntityId;
  toEntityId?: EntityId;
  // System assignment (power, fire, data, ...)
  systemId?: SystemId;
  circuitType: CableCircuitType;
  // Construction
  construction: CableConstruction;
  // Number of cores (excluding earth/screen)
  cores: number;
  // Cross-sectional area per core (mm²)
  csa: number;
  // Whether the cable has an integral earth/CPC (typically reduced size)
  hasEarth: boolean;
  // CSA of the earth/CPC if present (mm²)
  earthCsa?: number;
  // Outer diameter (mm) — used for fill calculations
  outerDiameter: number;
  // Mass per unit length (kg/m) — used for support load calculations
  massPerMetre?: number;
  // Voltage rating (V), e.g. 230, 400, 1000
  voltage: number;
  // Manufacturer / part number
  manufacturer?: string;
  partNumber?: string;
  // Route through containment — ordered list of containment entity IDs.
  // Cumulative segment lengths give the cable run length.
  route: EntityId[];
  // Estimated installed length (m) — calculated from route + allowances
  estimatedLength?: number;
  // Actual measured length (m) — populated as-built
  actualLength?: number;
  // Site-cut length allowance in m on top of straight route distance
  // (for slack at terminations, looping etc.)
  lengthAllowance?: number;
  // Electrical design data
  designCurrent?: number; // Ib in A
  protectiveDevice?: string; // e.g. "MCB B16", "MCCB 100A"
  protectiveDeviceRating?: number; // In in A
  // Calculated values (populated by calc engine, never stored as truth)
  calculated?: CableCalculatedValues;
  // Status in the project lifecycle
  status?: 'design' | 'tendered' | 'ordered' | 'delivered' | 'installed' | 'tested' | 'commissioned';
  // Free-form notes / tags
  notes?: string;
}

export interface CableCalculatedValues {
  // Base ampacity from cable type/CSA (Iz_base, A)
  baseAmpacity?: number;
  // Final derated capacity after all factors (Iz, A)
  ampacity?: number;
  // Active correction factors
  groupingFactor?: number; // Cg
  ambientFactor?: number; // Ca
  insulationFactor?: number; // Ci
  installationFactor?: number; // Cc
  // Voltage drop in mV per A per metre at the chosen size (from tables)
  vdropMvAm?: number;
  // Total voltage drop (V) and as a percentage of nominal supply
  voltageDropV?: number;
  voltageDropPct?: number;
  // Verdict
  ampacityOk?: boolean;
  vdropOk?: boolean;
}

// A standardised set of cable sizes (mm² CSA) per BS 7671 Table 4D1.
export const STANDARD_CSA = [
  1.0, 1.5, 2.5, 4.0, 6.0, 10.0, 16.0, 25.0, 35.0, 50.0,
  70.0, 95.0, 120.0, 150.0, 185.0, 240.0, 300.0, 400.0, 500.0, 630.0,
] as const;

// Project-level cable schedule. Cables are global to the project, even
// though their routes pass through specific sheets/floors.
export interface CableSchedule {
  cables: Record<CableId, Cable>;
  cableOrder: CableId[];
}

export const emptyCableSchedule = (): CableSchedule => ({
  cables: {},
  cableOrder: [],
});
