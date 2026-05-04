// Generic cable ladder catalogue.
//
// Cable ladders are the heaviest containment family — typical use is
// large feeder runs and any external installation where load class IV
// is required. Sizes mirror the Unistrut / Atkore / Cooper B-Line
// "Eaton" ranges. Stock length 3 metres.
import type { CatalogueProduct } from '../../models/catalogue';

// (width, sideRailHeight, material code, base unit cost £)
type Spec = readonly [number, number, string, number];

const widths = [150, 300, 450, 600, 750, 900] as const;
const heights = [75, 100, 125, 150] as const;

const specs: Spec[] = [];
for (const w of widths) {
  for (const h of heights) {
    // Pre-galv, hot-dip galv, stainless 316L
    specs.push([w, h, 'PG', 0.080 * w + 0.10 * h]);
    specs.push([w, h, 'HDG', 0.120 * w + 0.15 * h]);
    if (w >= 300 && h >= 100) specs.push([w, h, 'SS316', 0.380 * w + 0.45 * h]);
  }
}

const matName: Record<string, string> = {
  PG: 'pre-galvanised-steel',
  HDG: 'hot-dip-galvanised',
  SS316: 'stainless-316L',
};
const matLabel: Record<string, string> = {
  PG: 'Pre-galvanised',
  HDG: 'Hot-dip galvanised',
  SS316: 'Stainless 316L',
};
const matFinish: Record<string, string> = {
  PG: 'pre-galv',
  HDG: 'hot-dip-galv',
  SS316: 'mill',
};

export const CABLE_LADDER_PRODUCTS: CatalogueProduct[] = specs.map(
  ([w, h, mat, cost]) => {
    const partNumber = `CL-${mat}-${w}x${h}-3M`;
    return {
      id: `cable-ladder/${partNumber}`,
      manufacturer: mat === 'SS316' ? 'Unistrut' : 'Generic',
      partNumber,
      description: `${matLabel[mat]} cable ladder ${w}×${h} mm × 3 m`,
      category: 'cable-ladder',
      subType: w >= 600 ? 'heavy-duty-ladder' : 'standard-ladder',
      material: matName[mat],
      finish: matFinish[mat],
      stockLength: 3000,
      width: w,
      height: h,
      innerCsaMm2: w * h * 0.95,
      wallThickness: w >= 600 ? 2.0 : 1.5,
      loadRatingKgPerM: w >= 600 ? 200 : w >= 300 ? 120 : 80,
      ipRating: 'IP20',
      unitCost: Math.round(cost * 100) / 100,
      currency: 'GBP',
      standards: 'BS EN 61537 Class IV',
      leadTimeWeeks: mat === 'SS316' ? 8 : 2,
      substitutionGroup: `ladder-${w}x${h}`,
      notes: mat === 'PG' ? undefined : 'External / corrosive duty',
    } satisfies CatalogueProduct;
  }
);
