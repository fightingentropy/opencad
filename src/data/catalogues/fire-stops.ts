// Fire stop products — Hilti CFS, STI, Quelfire and Promat ranges.

import type { CatalogueProduct } from '../../models/catalogue';

const SUB_PILLOW = 'firestop-pillow';
const SUB_BATT = 'firestop-batt';
const SUB_COLLAR = 'firestop-collar';
const SUB_MORTAR = 'firestop-mortar';
const SUB_SEALANT = 'firestop-sealant';

export const FIRE_STOP_PRODUCTS: CatalogueProduct[] = [
  // ----- Intumescent pillows -----
  { id: 'fs-pillow-s', manufacturer: 'Hilti', partNumber: 'CFS-CT-S',
    description: 'Hilti CFS-CT pillow, small (200 × 100 × 30mm)',
    category: 'fire-stop', subType: 'pillow', material: 'intumescent',
    fireRating: 'EI 120', unitCost: 6.50, currency: 'GBP',
    standards: 'BS EN 1366-3 / EN 13501-2', substitutionGroup: SUB_PILLOW },
  { id: 'fs-pillow-m', manufacturer: 'Hilti', partNumber: 'CFS-CT-M',
    description: 'Hilti CFS-CT pillow, medium (300 × 200 × 30mm)',
    category: 'fire-stop', subType: 'pillow', material: 'intumescent',
    fireRating: 'EI 120', unitCost: 11.00, currency: 'GBP',
    standards: 'BS EN 1366-3 / EN 13501-2', substitutionGroup: SUB_PILLOW },
  { id: 'fs-pillow-sti-s', manufacturer: 'STI', partNumber: 'EZ-FB-1100',
    description: 'STI EZ-Path pillow small',
    category: 'fire-stop', subType: 'pillow', material: 'intumescent',
    fireRating: 'EI 120', unitCost: 7.20, currency: 'GBP',
    standards: 'BS EN 1366-3', substitutionGroup: SUB_PILLOW },

  // ----- Fire batts (mineral fibre with intumescent coating) -----
  { id: 'fs-batt-50-60', manufacturer: 'Promat', partNumber: 'PROMASTOP-CC',
    description: 'Promat batt, 50mm, EI 60',
    category: 'fire-stop', subType: 'batt', material: 'mineral-fibre',
    fireRating: 'EI 60', unitCost: 38.00, currency: 'GBP',
    wallThickness: 50, standards: 'BS EN 1366-3', substitutionGroup: SUB_BATT },
  { id: 'fs-batt-50-90', manufacturer: 'Promat', partNumber: 'PROMASTOP-EI90',
    description: 'Promat batt, 50mm, EI 90',
    category: 'fire-stop', subType: 'batt', material: 'mineral-fibre',
    fireRating: 'EI 90', unitCost: 44.00, currency: 'GBP',
    wallThickness: 50, standards: 'BS EN 1366-3', substitutionGroup: SUB_BATT },
  { id: 'fs-batt-60-120', manufacturer: 'Quelfire', partNumber: 'QM-CB60',
    description: 'Quelfire coated batt, 60mm, EI 120',
    category: 'fire-stop', subType: 'batt', material: 'mineral-fibre',
    fireRating: 'EI 120', unitCost: 56.00, currency: 'GBP',
    wallThickness: 60, standards: 'BS EN 1366-3', substitutionGroup: SUB_BATT },

  // ----- Intumescent collars (sized for conduit) -----
  ...[16, 20, 25, 32, 40, 50].map<CatalogueProduct>((d) => ({
    id: `fs-collar-${d}`,
    manufacturer: 'Hilti',
    partNumber: `CFS-C-EL-${d}`,
    description: `Hilti CFS-C-EL intumescent collar, ${d}mm`,
    category: 'fire-stop',
    subType: 'collar',
    material: 'intumescent',
    diameter: d,
    fireRating: 'EI 120',
    unitCost: 5 + d * 0.4,
    currency: 'GBP',
    standards: 'BS EN 1366-3',
    substitutionGroup: SUB_COLLAR,
  })),

  // ----- Mortar / sealant -----
  { id: 'fs-mortar-25', manufacturer: 'Promat', partNumber: 'PROMASTOP-M',
    description: 'Promat fire-rated mortar, 25kg bag',
    category: 'fire-stop', subType: 'mortar', material: 'cementitious',
    fireRating: 'EI 240', unitCost: 42.00, currency: 'GBP',
    standards: 'BS EN 1366-3', substitutionGroup: SUB_MORTAR },
  { id: 'fs-sealant-310', manufacturer: 'Hilti', partNumber: 'CFS-S-ACR',
    description: 'Hilti acrylic firestop sealant, 310ml',
    category: 'fire-stop', subType: 'sealant', material: 'acrylic',
    fireRating: 'EI 240', unitCost: 9.80, currency: 'GBP',
    standards: 'BS EN 1366-3', substitutionGroup: SUB_SEALANT },
  { id: 'fs-sealant-quelfire', manufacturer: 'Quelfire', partNumber: 'QM-AS',
    description: 'Quelfire acrylic intumescent sealant, 310ml',
    category: 'fire-stop', subType: 'sealant', material: 'acrylic',
    fireRating: 'EI 240', unitCost: 8.40, currency: 'GBP',
    standards: 'BS EN 1366-3', substitutionGroup: SUB_SEALANT },

  // ----- Composite systems -----
  { id: 'fs-stop-stop', manufacturer: 'STI', partNumber: 'EZ-PATH-22',
    description: 'STI EZ-Path 22 firestop pathway device for cable bundles',
    category: 'fire-stop', subType: 'composite', material: 'steel-intumescent',
    fireRating: 'EI 120', unitCost: 95.00, currency: 'GBP',
    standards: 'BS EN 1366-3', substitutionGroup: 'firestop-composite' },
];
