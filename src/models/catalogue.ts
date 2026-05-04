// Manufacturer catalogue — real product data referenced by containment
// entities, fittings, supports and BOMs.

export type CatalogueCategory =
  | 'cable-tray'
  | 'cable-ladder'
  | 'cable-basket'
  | 'trunking'
  | 'conduit'
  | 'busbar'
  | 'fitting'
  | 'support'
  | 'fixing'
  | 'fire-stop'
  | 'cable'
  | 'accessory'
  | 'distribution-board'
  | 'other';

export type Manufacturer =
  | 'Legrand'
  | 'Cablofil'
  | 'Schneider'
  | 'Eaton-BLine'
  | 'Unistrut'
  | 'Atkore'
  | 'Marco'
  | 'Pemsa'
  | 'OBO Bettermann'
  | 'Marshall-Tufflex'
  | 'Hager'
  | 'ABB'
  | 'Siemens'
  | 'Hilti'
  | 'STI'
  | 'Quelfire'
  | 'Promat'
  | 'Adaptaflex'
  | 'Flexicon'
  | 'Univolt'
  | 'Prysmian'
  | 'Nexans'
  | 'Generic'
  | string;

export interface CatalogueProduct {
  id: string;
  manufacturer: Manufacturer;
  partNumber: string;
  description: string;
  category: CatalogueCategory;
  // Sub-classification within the category (e.g. 'perforated' for tray)
  subType?: string;
  // Material e.g. galvanised-steel, stainless, aluminium, pvc
  material?: string;
  finish?: string;
  // Stock length in mm (for straight containment)
  stockLength?: number;
  // Cross-section
  width?: number;
  height?: number;
  // Diameter for round products (conduit)
  diameter?: number;
  // Internal diameter / area for fill calcs
  innerDiameter?: number;
  innerCsaMm2?: number;
  // Wall thickness for steel containment / depth of side flanges
  wallThickness?: number;
  // Load rating for tray / ladder (kg/m at typical span)
  loadRatingKgPerM?: number;
  // IP / IK ratings
  ipRating?: string;
  ikRating?: string;
  // Fire rating where applicable (for fire-stop products)
  fireRating?: string;
  // Approximate unit cost (project currency) for estimation
  unitCost?: number;
  // Currency for the unit cost
  currency?: string;
  // Standards compliance string e.g. "BS EN 61537 Class III"
  standards?: string;
  // Lead time in weeks
  leadTimeWeeks?: number;
  // Group of substitution-equivalent products (same group → interchangeable)
  substitutionGroup?: string;
  // Free-form notes
  notes?: string;
  // External datasheet/spec URL
  url?: string;
}

// A catalogue is a collection of products keyed by id. Multiple
// catalogues can be loaded simultaneously (e.g. one per manufacturer).
export interface Catalogue {
  id: string;
  name: string;
  manufacturer?: Manufacturer;
  products: Record<string, CatalogueProduct>;
  productOrder: string[];
}

// A material specification list — the project's "preferred manufacturers"
// for each containment / fitting type. The UI uses this to filter the
// catalogue browser and warn on substitutions outside the spec.
export interface MaterialSpec {
  id: string;
  name: string;
  // For each catalogue category, the primary manufacturer plus approved
  // alternatives. A substitution outside the approved list flags a warning.
  preferred: Partial<Record<CatalogueCategory, {
    primaryManufacturer: Manufacturer;
    primarySubstitutionGroup?: string;
    approvedAlternatives: Manufacturer[];
  }>>;
}

// A request to substitute one product for another — tracked for QA.
export interface SubstitutionRequest {
  id: string;
  // The product the spec calls for
  specifiedProductId: string;
  // The product being proposed
  proposedProductId: string;
  status: 'pending' | 'approved' | 'rejected' | 'conditional';
  reviewedBy?: string;
  reviewDate?: number;
  reasonForSubstitution?: string;
  conditions?: string;
}
