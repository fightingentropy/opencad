// Support hardware catalogue.
//
// Channel sections, threaded rod, beam clamps, brackets and saddle clips
// from Unistrut / Hilti and generic equivalents. The placer references
// these by substitutionGroup so the engineer can specify "Hilti only"
// per the Material Spec without breaking the auto-place logic.
import type { CatalogueProduct } from '../../models/catalogue';

interface RodSpec {
  thread: 'M8' | 'M10' | 'M12';
  length: number;
  cost: number;
}

const rodSpecs: RodSpec[] = [
  { thread: 'M8', length: 1000, cost: 2.40 },
  { thread: 'M8', length: 2000, cost: 4.30 },
  { thread: 'M10', length: 1000, cost: 3.10 },
  { thread: 'M10', length: 2000, cost: 5.80 },
  { thread: 'M12', length: 1000, cost: 4.20 },
  { thread: 'M12', length: 2000, cost: 7.90 },
];

const rods: CatalogueProduct[] = rodSpecs.map((s) => ({
  id: `support/RD-${s.thread}-${s.length}`,
  manufacturer: 'Generic',
  partNumber: `RD-${s.thread}-${s.length / 1000}M`,
  description: `${s.thread} threaded rod × ${s.length / 1000} m, BZP`,
  category: 'support',
  subType: 'threaded-rod',
  material: 'galvanised-steel',
  finish: 'electro-galv',
  stockLength: s.length,
  unitCost: s.cost,
  currency: 'GBP',
  standards: 'BS 4190 grade 4.6',
  leadTimeWeeks: 1,
  substitutionGroup: `rod-${s.thread}`,
} satisfies CatalogueProduct));

interface ChannelSpec {
  series: 'P1000' | 'P1001' | 'P3300';
  length: number;
  width: number;
  height: number;
  cost: number;
}

const channelSpecs: ChannelSpec[] = [];
for (const len of [1000, 2000, 3000] as const) {
  channelSpecs.push({ series: 'P1000', length: len, width: 41, height: 41, cost: (len / 1000) * 8.40 });
  channelSpecs.push({ series: 'P1001', length: len, width: 41, height: 21, cost: (len / 1000) * 6.80 });
  channelSpecs.push({ series: 'P3300', length: len, width: 41, height: 82, cost: (len / 1000) * 14.50 });
}

const channels: CatalogueProduct[] = channelSpecs.map((s) => ({
  id: `support/CH-${s.series}-${s.length}`,
  manufacturer: 'Unistrut',
  partNumber: `${s.series}-${s.length / 1000}M`,
  description: `Unistrut ${s.series} channel ${s.width}×${s.height} mm × ${s.length / 1000} m`,
  category: 'support',
  subType: 'channel',
  material: 'pre-galvanised-steel',
  finish: 'pre-galv',
  stockLength: s.length,
  width: s.width,
  height: s.height,
  unitCost: Math.round(s.cost * 100) / 100,
  currency: 'GBP',
  standards: 'BS 6946',
  leadTimeWeeks: 1,
  substitutionGroup: `channel-${s.series}`,
} satisfies CatalogueProduct));

const trapezeWidths = [200, 300, 450, 600, 750, 900] as const;
const trapezes: CatalogueProduct[] = trapezeWidths.map((w) => ({
  id: `support/TRP-${w}`,
  manufacturer: 'Unistrut',
  partNumber: `TRP-${w}`,
  description: `Pre-fabricated trapeze hanger, ${w} mm wide`,
  category: 'support',
  subType: 'trapeze-hanger',
  material: 'pre-galvanised-steel',
  finish: 'pre-galv',
  width: w,
  unitCost: Math.round((10 + 0.06 * w) * 100) / 100,
  currency: 'GBP',
  standards: 'BS EN 61537',
  leadTimeWeeks: 2,
  substitutionGroup: `trapeze-${w}`,
} satisfies CatalogueProduct));

const wallBracketWidths = [100, 150, 200, 300, 450] as const;
const wallBrackets: CatalogueProduct[] = wallBracketWidths.map((w) => ({
  id: `support/WB-${w}`,
  manufacturer: 'Unistrut',
  partNumber: `WB-${w}`,
  description: `Cantilever wall bracket, ${w} mm projection`,
  category: 'support',
  subType: 'wall-bracket',
  material: 'pre-galvanised-steel',
  finish: 'pre-galv',
  width: w,
  unitCost: Math.round((6 + 0.04 * w) * 100) / 100,
  currency: 'GBP',
  standards: 'BS EN 61537',
  leadTimeWeeks: 1,
  substitutionGroup: `wall-bracket-${w}`,
} satisfies CatalogueProduct));

const beamClampFlanges = [75, 100, 150, 200] as const;
const beamClamps: CatalogueProduct[] = beamClampFlanges.map((f) => ({
  id: `support/BC-${f}`,
  manufacturer: 'Hilti',
  partNumber: `MQT-${f}`,
  description: `Beam clamp for I-beam ${f} mm flange`,
  category: 'support',
  subType: 'beam-clamp',
  material: 'galvanised-steel',
  finish: 'electro-galv',
  unitCost: Math.round((4 + 0.08 * f) * 100) / 100,
  currency: 'GBP',
  standards: 'BS EN 61537',
  leadTimeWeeks: 2,
  substitutionGroup: `beam-clamp-${f}`,
} satisfies CatalogueProduct));

const saddleSizes = [16, 20, 25, 32, 40, 50] as const;
const saddleClips: CatalogueProduct[] = saddleSizes.map((d) => ({
  id: `support/SC-${d}`,
  manufacturer: 'Generic',
  partNumber: `SC-${d}`,
  description: `Saddle clip for Ø${d} mm conduit`,
  category: 'support',
  subType: 'saddle-clip',
  material: 'pre-galvanised-steel',
  finish: 'pre-galv',
  diameter: d,
  unitCost: Math.round((0.4 + 0.02 * d) * 100) / 100,
  currency: 'GBP',
  standards: 'BS EN 61386',
  leadTimeWeeks: 1,
  substitutionGroup: `saddle-clip-${d}`,
} satisfies CatalogueProduct));

export const SUPPORT_PRODUCTS: CatalogueProduct[] = [
  ...rods,
  ...channels,
  ...trapezes,
  ...wallBrackets,
  ...beamClamps,
  ...saddleClips,
];
