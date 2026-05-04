// Drawing revision and review tracking — supports BS EN ISO 19650
// approval workflow and per-reviewer markup layers.

export type RevisionStatus =
  | 'S0' // Work in progress
  | 'S1' // For coordination
  | 'S2' // For information
  | 'S3' // For review and comment
  | 'S4' // For construction (issued)
  | 'S5' // As-built
  | 'S6' // Superseded
  | 'S7'; // Withdrawn

export interface RevisionStatusInfo {
  code: RevisionStatus;
  name: string;
  description: string;
  // Whether the drawing can still be edited at this status
  editable: boolean;
}

export const REVISION_STATUSES: Record<RevisionStatus, RevisionStatusInfo> = {
  S0: { code: 'S0', name: 'Work in Progress', description: 'Internal use only', editable: true },
  S1: { code: 'S1', name: 'For Coordination', description: 'For inter-discipline coordination', editable: true },
  S2: { code: 'S2', name: 'For Information', description: 'For information / shared with team', editable: true },
  S3: { code: 'S3', name: 'For Review and Comment', description: 'Issued for client / consultant review', editable: false },
  S4: { code: 'S4', name: 'For Construction', description: 'Approved for construction — locked from editing', editable: false },
  S5: { code: 'S5', name: 'As-Built', description: 'Reflects actual installation', editable: true },
  S6: { code: 'S6', name: 'Superseded', description: 'Replaced by a newer revision', editable: false },
  S7: { code: 'S7', name: 'Withdrawn', description: 'No longer valid — do not use', editable: false },
};

// A single revision row on a drawing's revision table.
export interface DrawingRevision {
  id: string;
  // Revision code: P01..P02..C01..C02 etc.
  // P-prefix = pre-contract (S0–S2). C-prefix = post-contract (S3+).
  code: string;
  status: RevisionStatus;
  date: number;
  description: string;
  author: string;
  checkedBy?: string;
  approvedBy?: string;
}

// Drawing-level metadata that lives alongside Sheet. Existing sheets get
// `meta` populated lazily — absence is treated as a brand-new WIP drawing.
export interface SheetMeta {
  // BS EN ISO 19650 structured drawing number components
  drawingNumber?: string; // full assembled e.g. "PRJ-NGB-ZZ-01-DR-E-0001"
  // Component parts so the project can re-build numbers when fields change
  projectCode?: string;
  originator?: string;
  volume?: string;
  level?: string;
  type?: 'DR' | 'SK' | 'M3' | 'SP' | string;
  discipline?: 'E' | 'M' | 'A' | 'S' | 'C' | 'P' | string;
  sequenceNumber?: string;
  // Title / scale / paper size
  title?: string;
  subtitle?: string;
  scale?: string; // e.g. "1:50"
  paperSize?: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'B' | 'D' | 'E';
  // Current revision
  currentRevision?: string;
  status?: RevisionStatus;
  // Full revision history
  revisions?: DrawingRevision[];
  // Approval signatures
  drawnBy?: string;
  drawnDate?: number;
  checkedBy?: string;
  checkedDate?: number;
  approvedBy?: string;
  approvedDate?: number;
  // Disciplinary owner — who is responsible for this drawing
  designer?: string;
  // Reference to architectural background DWG/PDF imported as underlay
  underlayRef?: string;
}

// Markup / comment thread on a drawing — review feedback. Lives separate
// from drawing entities so review activity doesn't pollute the design.
export interface MarkupItem {
  id: string;
  sheetId: string;
  // Anchor — either coordinates or an entity reference
  anchorPoint?: { x: number; y: number };
  anchorEntityId?: string;
  // Markup kind
  kind: 'comment' | 'cloud' | 'callout' | 'strikeout' | 'dimension-check';
  // Text body
  text: string;
  // Author / timestamps
  author: string;
  authorRole?: string;
  createdAt: number;
  updatedAt: number;
  // Resolution
  status: 'open' | 'accepted' | 'rejected' | 'resolved' | 'will-not-fix';
  resolvedBy?: string;
  resolvedAt?: number;
  resolutionNote?: string;
  // Visual properties
  color?: string;
  // Reply thread
  replies?: MarkupReply[];
}

export interface MarkupReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

// Construction phase tagging — entities can be assigned to one of these
// phases for sequence planning and as-built progress tracking.
export type ConstructionPhase =
  | 'foundations'      // Phase 1: underground, slab-embedded
  | 'structure'        // Phase 2: rough-in, primary containment, fire barriers
  | 'services-fitout'  // Phase 3: secondary containment, conduit drops
  | 'cable-pull'       // Phase 4: cables installed
  | 'final-fix'        // Phase 5: covers, labels, commissioning
  | 'temporary'        // Temporary works, removed before handover
  | 'unassigned';

export interface PhaseInfo {
  code: ConstructionPhase;
  name: string;
  order: number;
  color: string;
}

export const PHASES: PhaseInfo[] = [
  { code: 'foundations', name: 'Foundations / Underground', order: 1, color: '#8b6f47' },
  { code: 'structure', name: 'Structure / Rough-in', order: 2, color: '#bb8cff' },
  { code: 'services-fitout', name: 'Services Fit-out', order: 3, color: '#5cdcff' },
  { code: 'cable-pull', name: 'Cable Installation', order: 4, color: '#ff8a3d' },
  { code: 'final-fix', name: 'Final Fix / Commissioning', order: 5, color: '#9ad65a' },
  { code: 'temporary', name: 'Temporary Works', order: 99, color: '#ffd84d' },
  { code: 'unassigned', name: 'Unassigned', order: 100, color: '#5d6473' },
];
