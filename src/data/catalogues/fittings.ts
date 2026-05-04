// Containment fittings catalogue.
//
// One product per fitting kind × parent containment size. The router
// looks these up by substitutionGroup so a tray bend can be substituted
// for a basket bend of the same width if specified by the engineer.
import type { CatalogueProduct } from '../../models/catalogue';

const trayWidths = [100, 150, 200, 300, 450, 600] as const;
const conduitSizes = [16, 20, 25, 32, 40, 50] as const;

interface TrayFitKind {
  code: string;
  name: string;
  description: (w: number) => string;
  costFactor: number;
}

const trayFittingKinds: TrayFitKind[] = [
  {
    code: 'BND90F',
    name: 'flat-bend',
    description: (w) => `90° flat bend, ${w} mm tray`,
    costFactor: 1.4,
  },
  {
    code: 'BND45F',
    name: 'flat-bend',
    description: (w) => `45° flat bend, ${w} mm tray`,
    costFactor: 1.1,
  },
  {
    code: 'RSI90',
    name: 'inside-riser',
    description: (w) => `90° inside riser (vertical bend), ${w} mm tray`,
    costFactor: 1.6,
  },
  {
    code: 'RSO90',
    name: 'outside-riser',
    description: (w) => `90° outside riser (vertical bend), ${w} mm tray`,
    costFactor: 1.6,
  },
  {
    code: 'TEE',
    name: 'tee',
    description: (w) => `Tee piece, ${w} mm tray`,
    costFactor: 1.7,
  },
  {
    code: 'CRX',
    name: 'cross',
    description: (w) => `4-way cross, ${w} mm tray`,
    costFactor: 2.1,
  },
  {
    code: 'RED',
    name: 'reducer',
    description: (w) => `Reducer to next size down, ${w} mm tray`,
    costFactor: 0.9,
  },
  {
    code: 'EC',
    name: 'end-cap',
    description: (w) => `End cap, ${w} mm tray`,
    costFactor: 0.25,
  },
  {
    code: 'CPL',
    name: 'coupler',
    description: (w) => `Splice coupler, ${w} mm tray`,
    costFactor: 0.35,
  },
];

const trayFittings: CatalogueProduct[] = [];
for (const w of trayWidths) {
  for (const k of trayFittingKinds) {
    const partNumber = `CT-${k.code}-${w}`;
    trayFittings.push({
      id: `fitting/${partNumber}`,
      manufacturer: 'Generic',
      partNumber,
      description: k.description(w),
      category: 'fitting',
      subType: k.name,
      material: 'pre-galvanised-steel',
      finish: 'pre-galv',
      width: w,
      height: 75,
      unitCost: Math.round((6 + 0.04 * w) * k.costFactor * 100) / 100,
      currency: 'GBP',
      standards: 'BS EN 61537',
      leadTimeWeeks: 1,
      substitutionGroup: `fitting-tray-${k.name}-${w}`,
    });
  }
}

interface ConduitFitKind {
  code: string;
  name: string;
  description: (d: number) => string;
  costFactor: number;
}

const conduitFittingKinds: ConduitFitKind[] = [
  {
    code: 'BND90LR',
    name: 'flat-bend',
    description: (d) => `90° long-radius bend, Ø${d} mm conduit`,
    costFactor: 1.6,
  },
  {
    code: 'BND90STD',
    name: 'flat-bend',
    description: (d) => `90° standard bend, Ø${d} mm conduit`,
    costFactor: 1.0,
  },
  {
    code: 'TEE',
    name: 'tee',
    description: (d) => `Tee, Ø${d} mm conduit`,
    costFactor: 1.4,
  },
  {
    code: 'CPL',
    name: 'coupler',
    description: (d) => `Coupler, Ø${d} mm conduit`,
    costFactor: 0.3,
  },
  {
    code: 'BX',
    name: 'adaptable-box',
    description: (d) => `Adaptable box for Ø${d} mm conduit (4-way)`,
    costFactor: 3.5,
  },
];

const conduitFittings: CatalogueProduct[] = [];
for (const d of conduitSizes) {
  for (const k of conduitFittingKinds) {
    const partNumber = `CN-${k.code}-${d}`;
    conduitFittings.push({
      id: `fitting/${partNumber}`,
      manufacturer: 'Univolt',
      partNumber,
      description: k.description(d),
      category: 'fitting',
      subType: k.name,
      material: 'pvc',
      finish: 'natural',
      diameter: d,
      width: d,
      unitCost: Math.round((1.2 + 0.05 * d) * k.costFactor * 100) / 100,
      currency: 'GBP',
      standards: 'BS EN 61386',
      leadTimeWeeks: 1,
      substitutionGroup: `fitting-conduit-${k.name}-${d}`,
    });
  }
}

export const FITTING_PRODUCTS: CatalogueProduct[] = [
  ...trayFittings,
  ...conduitFittings,
];
