// Fire compartmentation and penetration sealing.
//
// Fire boundaries are walls or floors with a fire rating. Containment
// crossing them needs a sealed penetration that restores the rating.

import type { EntityId } from '../types';

export type FireRating = 0 | 30 | 60 | 90 | 120 | 240;

export type SealType =
  | 'pillow' // intumescent pillow / bag
  | 'batt' // mineral fibre batt with intumescent coating
  | 'collar' // intumescent collar around conduit / sleeve
  | 'mortar' // fire-rated mortar
  | 'sealant' // fire-rated sealant / mastic
  | 'sleeve' // pre-installed steel sleeve with intumescent insert
  | 'wrap' // intumescent wrap around containment
  | 'composite' // proprietary system with multiple components
  | 'other';

export type PenetrationStatus =
  | 'flagged' // detected automatically, not yet designed
  | 'designed'
  | 'submitted'
  | 'approved'
  | 'installed'
  | 'inspected'
  | 'failed';

export interface PenetrationSeal {
  id: string;
  // Reference number — e.g. "FS-001"
  reference: string;
  // The wall or floor entity that is the fire boundary
  boundaryEntityId: EntityId;
  // The containment / cable entity passing through the boundary
  penetrationEntityId: EntityId;
  // Where on the boundary the penetration occurs (world coords)
  crossingPoint: { x: number; y: number };
  // The wall's fire rating that this seal must restore
  requiredRating: FireRating;
  // The seal product / system selected
  sealType?: SealType;
  productId?: string;
  productPartNumber?: string;
  // Achieved rating (must be >= requiredRating)
  achievedRating?: FireRating;
  // Dimensions of the opening (mm)
  openingWidth?: number;
  openingHeight?: number;
  // Status
  status: PenetrationStatus;
  // Inspection
  inspectedBy?: string;
  inspectedAt?: number;
  certificateRef?: string;
  // Photos / evidence
  photoUrls?: string[];
  // Free-form notes
  notes?: string;
}

// A fire compartment — defined by a set of boundary entities.
// Useful when checking overall compliance at the project level.
export interface FireCompartment {
  id: string;
  name: string;
  // The walls / floors that form the boundary
  boundaryEntityIds: EntityId[];
  // Required fire rating for the compartment
  rating: FireRating;
  // Floors this compartment exists on
  floorIds?: string[];
}

// Inspection / Test Plan item. Used for QC tracking on installed work.
export type ITPControlPoint = 'H' | 'W' | 'R' | 'I'; // Hold, Witness, Review, Inspection

export interface ITPItem {
  id: string;
  reference: string;
  activity: string;
  acceptanceCriteria: string;
  controlPoint: ITPControlPoint;
  responsibility: string;
  status: 'pending' | 'in-progress' | 'inspected-pass' | 'inspected-fail' | 'cleared';
  // Reference to design entities the inspection applies to
  appliedTo?: EntityId[];
  inspector?: string;
  inspectedAt?: number;
  notes?: string;
  evidenceUrls?: string[];
}
