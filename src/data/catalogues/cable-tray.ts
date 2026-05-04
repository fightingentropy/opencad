// Generic perforated cable tray catalogue.
//
// Sizes derived from Legrand Cablofil "P31 perforated tray" and the
// equivalent Atkore / Pemsa ranges. Stock length 3 metres in line with
// BS EN 61537. Inner CSA approximated as (width × height × 0.92) to
// account for return flanges; precise figures vary by manufacturer.
import type { CatalogueProduct } from '../../models/catalogue';

// (width, height, material code, finish suffix, base unit cost in GBP)
type Spec = readonly [number, number, string, string, number];

const widths = [100, 150, 200, 300, 450, 600, 750, 900] as const;
const heights = [50, 75, 100, 150] as const;

// Substitution-equivalent product groups are keyed on the
// width × height pair so that pre-galvanised, hot-dip galv and
// stainless equivalents from any vendor can be auto-substituted.
function group(w: number, h: number): string {
  return `tray-perforated-${w}x${h}`;
}

const specs: Spec[] = [];
for (const w of widths) {
  for (const h of heights) {
    // Skip sizes that aren't manufactured (typical industry SKUs)
    if (w === 100 && h > 75) continue;
    if (w === 150 && h > 100) continue;
    if (w === 750 && h < 75) continue;
    if (w === 900 && h < 100) continue;
    // Pre-galv (most common, cheapest)
    specs.push([w, h, 'PG', 'pre-galv', 0.045 * w + 0.06 * h] as const);
    // Hot-dip galvanised (corrosive environments)
    specs.push([w, h, 'HDG', 'hot-dip-galv', 0.075 * w + 0.10 * h] as const);
    // Stainless 316L (food / pharma / coastal)
    specs.push([w, h, 'SS316', 'mill', 0.250 * w + 0.30 * h] as const);
  }
}

export const CABLE_TRAY_PRODUCTS: CatalogueProduct[] = specs.map(
  ([w, h, mat, finish, cost]) => {
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
    const partNumber = `CT-${mat}-${w}x${h}-3M`;
    return {
      id: `cable-tray/${partNumber}`,
      manufacturer: mat === 'SS316' ? 'Cablofil' : 'Generic',
      partNumber,
      description: `${matLabel[mat]} perforated cable tray ${w}×${h} mm × 3 m`,
      category: 'cable-tray',
      subType: 'perforated',
      material: matName[mat],
      finish: finish,
      stockLength: 3000,
      width: w,
      height: h,
      innerCsaMm2: w * h * 0.92,
      wallThickness: w >= 600 ? 1.5 : 1.0,
      loadRatingKgPerM: w >= 600 ? 80 : 50,
      ipRating: 'IP20',
      unitCost: Math.round(cost * 100) / 100,
      currency: 'GBP',
      standards: 'BS EN 61537 Class III',
      leadTimeWeeks: mat === 'SS316' ? 6 : 1,
      substitutionGroup: group(w, h),
      notes: mat === 'SS316' ? 'Acid-resistant stainless steel' : undefined,
    } satisfies CatalogueProduct;
  }
);
