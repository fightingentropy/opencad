// PVC trunking catalogue.
//
// Covers Marshall-Tufflex Mini, Maxi, Sterling and dado ranges plus
// Schneider-Mita / generic equivalents. All are extruded rigid PVC,
// stock length 3 metres, supplied with a snap-fit lid in matching part
// numbers (lid SKUs are appended below the body SKUs).
import type { CatalogueProduct } from '../../models/catalogue';

type TrunkingFamily = 'mini' | 'standard' | 'maxi' | 'dado';

interface Body {
  width: number;
  height: number;
  family: TrunkingFamily;
  compartments: number;
}

const bodies: Body[] = [
  // Mini-trunking
  { width: 16, height: 16, family: 'mini', compartments: 1 },
  { width: 16, height: 25, family: 'mini', compartments: 1 },
  { width: 25, height: 16, family: 'mini', compartments: 1 },
  { width: 25, height: 25, family: 'mini', compartments: 1 },
  { width: 38, height: 16, family: 'mini', compartments: 1 },
  { width: 38, height: 25, family: 'mini', compartments: 1 },
  // Standard
  { width: 50, height: 37.5, family: 'standard', compartments: 1 },
  { width: 50, height: 50, family: 'standard', compartments: 1 },
  { width: 75, height: 37.5, family: 'standard', compartments: 1 },
  { width: 75, height: 50, family: 'standard', compartments: 1 },
  { width: 75, height: 75, family: 'standard', compartments: 1 },
  { width: 100, height: 37.5, family: 'standard', compartments: 1 },
  { width: 100, height: 50, family: 'standard', compartments: 1 },
  { width: 100, height: 75, family: 'standard', compartments: 1 },
  { width: 100, height: 100, family: 'standard', compartments: 1 },
  // Maxi
  { width: 150, height: 100, family: 'maxi', compartments: 1 },
  { width: 150, height: 150, family: 'maxi', compartments: 1 },
  // Dado / multi-compartment
  { width: 50, height: 170, family: 'dado', compartments: 3 },
  { width: 75, height: 170, family: 'dado', compartments: 3 },
];

function priceFor(b: Body): number {
  return Math.round(((b.width + b.height) * 0.05 + (b.family === 'dado' ? 8 : 1.5)) * 100) / 100;
}

export const TRUNKING_PRODUCTS: CatalogueProduct[] = [];

for (const b of bodies) {
  const sizeStr = `${b.width}x${b.height}`;
  const partNumber = `TR-${b.family.toUpperCase()}-${sizeStr}-3M`;
  TRUNKING_PRODUCTS.push({
    id: `trunking/${partNumber}`,
    manufacturer: 'Marshall-Tufflex',
    partNumber,
    description: `PVC ${b.family} trunking ${sizeStr} mm × 3 m${b.compartments > 1 ? ` (${b.compartments}-compartment)` : ''}`,
    category: 'trunking',
    subType: b.family,
    material: 'pvc',
    finish: 'natural',
    stockLength: 3000,
    width: b.width,
    height: b.height,
    innerCsaMm2: b.width * b.height * 0.85,
    ipRating: 'IP40',
    unitCost: priceFor(b),
    currency: 'GBP',
    standards: 'BS EN 50085-1',
    leadTimeWeeks: 1,
    substitutionGroup: `trunking-${b.family}-${sizeStr}`,
    notes: b.family === 'dado'
      ? `${b.compartments}-compartment dado trunking for office data / power segregation`
      : undefined,
  });
  // Matching snap-fit lid
  const lidPart = `TR-${b.family.toUpperCase()}-${b.width}-LID-3M`;
  TRUNKING_PRODUCTS.push({
    id: `trunking/${lidPart}`,
    manufacturer: 'Marshall-Tufflex',
    partNumber: lidPart,
    description: `Snap-fit lid for ${b.width} mm ${b.family} trunking × 3 m`,
    category: 'trunking',
    subType: 'mini', // lids share the family of the body
    material: 'pvc',
    finish: 'natural',
    stockLength: 3000,
    width: b.width,
    unitCost: Math.round(priceFor(b) * 0.4 * 100) / 100,
    currency: 'GBP',
    standards: 'BS EN 50085-1',
    leadTimeWeeks: 1,
    substitutionGroup: `trunking-lid-${b.family}-${b.width}`,
    notes: 'Lid only — matches trunking body SKU',
  });
}

// Generic alternative for the most common standard sizes
const genericExtras: Body[] = [
  { width: 100, height: 50, family: 'standard', compartments: 1 },
  { width: 100, height: 75, family: 'standard', compartments: 1 },
  { width: 50, height: 50, family: 'standard', compartments: 1 },
];
for (const b of genericExtras) {
  const sizeStr = `${b.width}x${b.height}`;
  const partNumber = `TR-GEN-${sizeStr}-3M`;
  TRUNKING_PRODUCTS.push({
    id: `trunking/${partNumber}`,
    manufacturer: 'Generic',
    partNumber,
    description: `Generic PVC trunking ${sizeStr} mm × 3 m`,
    category: 'trunking',
    subType: b.family,
    material: 'pvc',
    finish: 'natural',
    stockLength: 3000,
    width: b.width,
    height: b.height,
    innerCsaMm2: b.width * b.height * 0.85,
    ipRating: 'IP40',
    unitCost: Math.round(priceFor(b) * 0.7 * 100) / 100,
    currency: 'GBP',
    standards: 'BS EN 50085-1',
    leadTimeWeeks: 1,
    substitutionGroup: `trunking-${b.family}-${sizeStr}`,
  });
}
