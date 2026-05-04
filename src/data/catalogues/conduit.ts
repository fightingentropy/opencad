// Rigid and flexible conduit catalogue.
//
// Covers Schneider Univolt PVC, Atkore steel and Adaptaflex / Flexicon
// flexible conduit. Sizes are nominal outside diameter in mm. Inner
// diameter approximated for fill calculations from the BS 4568 / BS EN
// 61386 wall-thickness tables.
import type { CatalogueProduct } from '../../models/catalogue';

interface Spec {
  od: number;
  family: 'pvc-light' | 'pvc-heavy' | 'steel' | 'flex-metal' | 'flex-plastic';
  wall: number;
  manufacturer: string;
  cost: number;
}

const specs: Spec[] = [
  // PVC light gauge — house wiring
  { od: 16, family: 'pvc-light', wall: 1.0, manufacturer: 'Univolt', cost: 0.85 },
  { od: 20, family: 'pvc-light', wall: 1.0, manufacturer: 'Univolt', cost: 0.95 },
  { od: 25, family: 'pvc-light', wall: 1.2, manufacturer: 'Univolt', cost: 1.20 },
  { od: 32, family: 'pvc-light', wall: 1.5, manufacturer: 'Univolt', cost: 1.65 },
  // PVC heavy gauge — commercial / industrial
  { od: 16, family: 'pvc-heavy', wall: 1.6, manufacturer: 'Univolt', cost: 1.20 },
  { od: 20, family: 'pvc-heavy', wall: 1.6, manufacturer: 'Univolt', cost: 1.45 },
  { od: 25, family: 'pvc-heavy', wall: 1.8, manufacturer: 'Univolt', cost: 1.80 },
  { od: 32, family: 'pvc-heavy', wall: 2.0, manufacturer: 'Univolt', cost: 2.50 },
  { od: 40, family: 'pvc-heavy', wall: 2.4, manufacturer: 'Univolt', cost: 3.40 },
  { od: 50, family: 'pvc-heavy', wall: 2.8, manufacturer: 'Univolt', cost: 4.80 },
  // Steel galv (BS 4568 class 4)
  { od: 16, family: 'steel', wall: 1.6, manufacturer: 'Atkore', cost: 2.40 },
  { od: 20, family: 'steel', wall: 1.6, manufacturer: 'Atkore', cost: 2.85 },
  { od: 25, family: 'steel', wall: 1.6, manufacturer: 'Atkore', cost: 3.50 },
  { od: 32, family: 'steel', wall: 1.8, manufacturer: 'Atkore', cost: 4.40 },
  { od: 40, family: 'steel', wall: 2.0, manufacturer: 'Atkore', cost: 5.80 },
  { od: 50, family: 'steel', wall: 2.0, manufacturer: 'Atkore', cost: 7.30 },
  // Flexible metal
  { od: 16, family: 'flex-metal', wall: 0.6, manufacturer: 'Adaptaflex', cost: 4.20 },
  { od: 20, family: 'flex-metal', wall: 0.6, manufacturer: 'Adaptaflex', cost: 4.80 },
  { od: 25, family: 'flex-metal', wall: 0.8, manufacturer: 'Adaptaflex', cost: 5.90 },
  { od: 32, family: 'flex-metal', wall: 0.8, manufacturer: 'Adaptaflex', cost: 7.50 },
  // Flexible plastic
  { od: 16, family: 'flex-plastic', wall: 1.4, manufacturer: 'Flexicon', cost: 1.80 },
  { od: 20, family: 'flex-plastic', wall: 1.4, manufacturer: 'Flexicon', cost: 2.10 },
  { od: 25, family: 'flex-plastic', wall: 1.6, manufacturer: 'Flexicon', cost: 2.65 },
  { od: 32, family: 'flex-plastic', wall: 1.8, manufacturer: 'Flexicon', cost: 3.40 },
];

const subtypeMap: Record<Spec['family'], string> = {
  'pvc-light': 'rigid-pvc',
  'pvc-heavy': 'rigid-pvc',
  steel: 'rigid-steel',
  'flex-metal': 'flexible-metal',
  'flex-plastic': 'flexible-plastic',
};

const materialMap: Record<Spec['family'], string> = {
  'pvc-light': 'pvc',
  'pvc-heavy': 'pvc',
  steel: 'galvanised-steel',
  'flex-metal': 'galvanised-steel',
  'flex-plastic': 'pvc',
};

const codeMap: Record<Spec['family'], string> = {
  'pvc-light': 'PVCL',
  'pvc-heavy': 'PVCH',
  steel: 'STL',
  'flex-metal': 'FXM',
  'flex-plastic': 'FXP',
};

const ipMap: Record<Spec['family'], string> = {
  'pvc-light': 'IP40',
  'pvc-heavy': 'IP54',
  steel: 'IP54',
  'flex-metal': 'IP54',
  'flex-plastic': 'IP54',
};

export const CONDUIT_PRODUCTS: CatalogueProduct[] = specs.map((s) => {
  const innerD = Math.max(0, s.od - s.wall * 2);
  const innerCsa = Math.PI * (innerD / 2) ** 2;
  const partNumber = `CN-${codeMap[s.family]}-${s.od}-3M`;
  return {
    id: `conduit/${partNumber}`,
    manufacturer: s.manufacturer,
    partNumber,
    description: `${s.family.replace('-', ' ')} conduit Ø${s.od} mm × 3 m`,
    category: 'conduit',
    subType: subtypeMap[s.family],
    material: materialMap[s.family],
    finish: s.family === 'steel' ? 'pre-galv' : 'natural',
    stockLength: s.family.startsWith('flex') ? 30000 : 3000,
    diameter: s.od,
    width: s.od,
    innerDiameter: innerD,
    innerCsaMm2: innerCsa,
    wallThickness: s.wall,
    ipRating: ipMap[s.family],
    unitCost: s.cost,
    currency: 'GBP',
    standards: s.family === 'steel' ? 'BS 4568' : 'BS EN 61386',
    leadTimeWeeks: 1,
    substitutionGroup: `conduit-${subtypeMap[s.family]}-${s.od}`,
  } satisfies CatalogueProduct;
});
