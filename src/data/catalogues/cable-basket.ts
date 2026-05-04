// Wire mesh cable basket catalogue.
//
// Wire-mesh basket is favoured for data / comms installations because
// cables can drop in at any point along the run and unused capacity is
// instantly visible. Cablofil invented the format and remains the
// reference range — equivalents from Atkore / Pemsa / Marco are
// dimensionally compatible.
import type { CatalogueProduct } from '../../models/catalogue';

type Spec = readonly [number, number, string, number];

const widths = [60, 100, 150, 200, 300, 400, 500, 600] as const;
const standardDepth = 60;

const specs: Spec[] = [];
for (const w of widths) {
  // Pre-galv (electro-zinc plated)
  specs.push([w, standardDepth, 'EZ', 0.030 * w + 4]);
  // Hot-dip galvanised
  specs.push([w, standardDepth, 'HDG', 0.060 * w + 6]);
  // Stainless 304 (data-room favourite)
  specs.push([w, standardDepth, 'SS304', 0.180 * w + 14]);
}

const matName: Record<string, string> = {
  EZ: 'pre-galvanised-steel',
  HDG: 'hot-dip-galvanised',
  SS304: 'stainless-304',
};
const matLabel: Record<string, string> = {
  EZ: 'Electro-zinc',
  HDG: 'Hot-dip galvanised',
  SS304: 'Stainless 304',
};
const matFinish: Record<string, string> = {
  EZ: 'electro-galv',
  HDG: 'hot-dip-galv',
  SS304: 'mill',
};

export const CABLE_BASKET_PRODUCTS: CatalogueProduct[] = specs.map(
  ([w, h, mat, cost]) => {
    const partNumber = `CB-${mat}-${w}x${h}-3M`;
    return {
      id: `cable-basket/${partNumber}`,
      manufacturer: mat === 'EZ' ? 'Cablofil' : 'Generic',
      partNumber,
      description: `${matLabel[mat]} wire mesh cable basket ${w}×${h} mm × 3 m`,
      category: 'cable-basket',
      subType: 'wire-mesh',
      material: matName[mat],
      finish: matFinish[mat],
      stockLength: 3000,
      width: w,
      height: h,
      innerCsaMm2: w * h * 0.97,
      wallThickness: 4, // wire diameter
      loadRatingKgPerM: w >= 400 ? 60 : 40,
      ipRating: 'IP20',
      unitCost: Math.round(cost * 100) / 100,
      currency: 'GBP',
      standards: 'BS EN 61537 Class II',
      leadTimeWeeks: mat === 'SS304' ? 4 : 1,
      substitutionGroup: `basket-${w}x${h}`,
      notes: 'Allows cable drop-out at any point',
    } satisfies CatalogueProduct;
  }
);
