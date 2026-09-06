import { nanoid } from 'nanoid';
import type { CatalogueProduct } from '../models/catalogue';
import { SYMBOL_LIST } from '../symbols/library';
import type {
  ContainmentEntity, ContainmentFinish, ContainmentMaterial, ContainmentSubType,
  ContainmentType, Entity, EquipmentKind, Project, SupportKind, Vec2,
} from '../types';

type ContainmentDefinition = {
  kind: 'containment';
  containmentType: ContainmentType;
  width: number;
  height?: number;
  length: number;
  subType?: ContainmentSubType;
  material?: ContainmentMaterial;
  finish?: ContainmentFinish;
  innerCsaMm2?: number;
  manufacturer?: string;
  catalogProductId?: string;
  catalogPartNumber?: string;
};

/** Search entries contain data only; no entity IDs, mesh objects or callbacks. */
export interface InsertableComponent {
  id: string;
  title: string;
  detail: string;
  keywords: string;
  identifiers?: string[];
  kind: 'containment' | 'symbol' | 'equipment' | 'support';
  containmentType?: ContainmentType;
  definition: ContainmentDefinition
    | { kind: 'symbol'; symbolId: string; tagPrefix?: string }
    | { kind: 'equipment'; equipmentKind: EquipmentKind; width: number; depth: number; height: number; tagPrefix: string }
    | { kind: 'support'; supportKind: SupportKind; channelLength?: number; rodLength?: number };
}

const dimensionLabel = (definition: ContainmentDefinition): string => definition.containmentType === 'conduit'
  ? `Ø${definition.width} mm · ${definition.length} mm length`
  : `${definition.width} × ${definition.height} mm · ${definition.length} mm length`;

const containment = (
  title: string, containmentType: ContainmentType, width: number, height: number | undefined,
  subType: ContainmentSubType, material: ContainmentMaterial = 'pre-galvanised-steel',
): InsertableComponent => {
  const definition: ContainmentDefinition = { kind: 'containment', containmentType, width, length: 3000, subType, material };
  if (height !== undefined) definition.height = height;
  return {
    id: `containment:${containmentType}:${width}:${height ?? 'round'}`,
    kind: 'containment', containmentType, title,
    detail: dimensionLabel(definition),
    keywords: `add insert ${title} ${containmentType} ${subType} ${material} ${width} ${height ?? ''} cable containment 3m 3000`,
    definition,
  };
};

const CONTAINMENT_COMPONENTS = [
  ...[150, 300, 600].map((width) => containment(`Perforated tray ${width} × 50`, 'tray', width, 50, 'perforated')),
  ...[50, 100, 150].map((width) => containment(`Steel trunking ${width} × ${width}`, 'trunking', width, width, 'standard')),
  ...[150, 300, 600].map((width) => containment(`Wire basket ${width} × 54`, 'basket', width, 54, 'wire-mesh', 'hot-dip-galvanised')),
  ...[20, 25, 32].map((width) => containment(`Steel conduit Ø${width}`, 'conduit', width, undefined, 'rigid-steel', 'galvanised-steel')),
  ...[300, 600].map((width) => containment(`Cable ladder ${width} × 100`, 'ladder', width, 100, 'standard-ladder')),
  containment('Underground duct 150 × 150', 'duct', 150, 150, 'underground-duct', 'pvc'),
  containment('Busbar trunking 150 × 100', 'busbar', 150, 100, 'feeder-busbar'),
];

// Editable generic envelopes, using the same height conventions as EquipmentRender3D.
// They deliberately carry no manufacturer identity or electrical ratings.
const EQUIPMENT: Record<EquipmentKind, [string, string, number, number, number]> = {
  'distribution-board': ['Distribution board', 'DB', 1200, 450, 2000],
  mcc: ['Motor control centre', 'MCC', 2400, 600, 2200],
  panelboard: ['Panelboard', 'PB', 800, 300, 1500],
  switchboard: ['Switchboard', 'SWB', 2400, 900, 2200],
  transformer: ['Transformer', 'TX', 2200, 1800, 1800],
  generator: ['Generator', 'GEN', 3000, 1200, 2200],
  ups: ['UPS', 'UPS', 1300, 1000, 1800],
  motor: ['Motor', 'M', 800, 500, 600],
  pump: ['Pump', 'P', 1200, 600, 800],
  fan: ['Fan', 'FAN', 1000, 600, 1000],
  'air-handling-unit': ['Air handling unit', 'AHU', 4200, 2400, 2200],
  'control-panel': ['Control panel', 'CP', 1200, 800, 1800],
  'fire-alarm-panel': ['Fire alarm panel', 'FAP', 800, 300, 800],
  'comms-rack': ['Communications rack', 'CR', 800, 1000, 2200],
  cabinet: ['Cabinet', 'CAB', 800, 600, 1800],
  enclosure: ['Enclosure', 'ENC', 600, 300, 600],
  meter: ['Meter', 'MTR', 300, 200, 400],
  'busbar-tap-off': ['Busbar tap off', 'BTO', 400, 250, 350],
  other: ['Equipment', 'EQ', 800, 600, 1500],
};

const SUPPORTS: Record<SupportKind, string> = {
  'wall-bracket': 'Wall bracket', 'cantilever-arm': 'Cantilever arm',
  'trapeze-hanger': 'Trapeze hanger', 'ceiling-bracket': 'Ceiling bracket',
  'floor-stand': 'Floor stand', 'a-frame': 'A frame', 'beam-clamp': 'Beam clamp',
  'saddle-clip': 'Saddle clip', 'multi-saddle': 'Multi saddle',
  'channel-bracket': 'Channel bracket', 'unistrut-frame': 'Unistrut frame',
};

const GENERIC_COMPONENTS: InsertableComponent[] = [
  ...CONTAINMENT_COMPONENTS,
  ...SYMBOL_LIST.map((symbol): InsertableComponent => ({
    id: `symbol:${symbol.id}`, kind: 'symbol', title: symbol.name,
    detail: `${symbol.category.replaceAll('-', ' ')} · ${symbol.standard ?? 'Electrical'} symbol`,
    keywords: `add insert symbol schematic ${symbol.id} ${symbol.name} ${symbol.category} ${symbol.description ?? ''} ${symbol.tagPrefix ?? ''}`,
    identifiers: [symbol.id, ...(symbol.tagPrefix ? [symbol.tagPrefix] : [])],
    definition: { kind: 'symbol', symbolId: symbol.id, ...(symbol.tagPrefix ? { tagPrefix: symbol.tagPrefix } : {}) },
  })),
  ...Object.entries(EQUIPMENT).map(([equipmentKind, [title, tagPrefix, width, depth, height]]): InsertableComponent => ({
    id: `equipment:${equipmentKind}`, kind: 'equipment', title,
    detail: `${width} × ${depth} × ${height} mm · Generic equipment`,
    keywords: `add insert equipment ${equipmentKind} ${title} ${tagPrefix} ${width} ${depth} ${height}`,
    identifiers: [equipmentKind, tagPrefix],
    definition: { kind: 'equipment', equipmentKind: equipmentKind as EquipmentKind, width, depth, height, tagPrefix },
  })),
  ...Object.entries(SUPPORTS).map(([supportKind, title]): InsertableComponent => ({
    id: `support:${supportKind}`, kind: 'support', title, detail: 'Generic support',
    keywords: `add insert support bracket hanger fixing ${supportKind} ${title}`,
    definition: { kind: 'support', supportKind: supportKind as SupportKind },
  })),
];

const CATEGORY_TYPES: Partial<Record<CatalogueProduct['category'], ContainmentType>> = {
  'cable-tray': 'tray', 'cable-ladder': 'ladder', 'cable-basket': 'basket',
  trunking: 'trunking', conduit: 'conduit', busbar: 'busbar',
};
const SUBTYPES: ContainmentSubType[] = [
  'perforated', 'solid-bottom', 'return-flange', 'standard-ladder', 'heavy-duty-ladder', 'wire-mesh',
  'mini', 'standard', 'maxi', 'dado', 'skirting', 'floor', 'bench', 'duct-trunking',
  'rigid-pvc', 'rigid-steel', 'flexible-metal', 'flexible-plastic', 'lsoh-conduit',
  'underground-duct', 'cable-trench', 'lighting-busbar', 'feeder-busbar', 'plug-in-busbar', 'sandwich-busbar',
];
const MATERIALS: ContainmentMaterial[] = [
  'galvanised-steel', 'pre-galvanised-steel', 'hot-dip-galvanised', 'stainless-304', 'stainless-316',
  'stainless-316L', 'aluminium', 'pvc', 'lsoh', 'grp', 'frp', 'copper', 'other',
];
const FINISHES: ContainmentFinish[] = ['mill', 'painted', 'powder-coat', 'hot-dip-galv', 'electro-galv', 'plastic-coat', 'pre-galv', 'natural'];
const positive = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;

/** Only straight stock with an actual cross-section and length is insertable.
 * Cable, fixings, fittings and incomplete equipment records stay in the catalogue.
 */
function catalogueComponent(catalogueId: string, product: CatalogueProduct): InsertableComponent | null {
  const containmentType = CATEGORY_TYPES[product.category];
  const width = containmentType === 'conduit' ? product.diameter ?? product.width : product.width;
  if (!containmentType || !positive(width) || !positive(product.stockLength)
    || (containmentType !== 'conduit' && !positive(product.height))) return null;
  const definition: ContainmentDefinition = {
    kind: 'containment', containmentType, width, length: product.stockLength,
    manufacturer: product.manufacturer, catalogPartNumber: product.partNumber, catalogProductId: product.id,
  };
  if (containmentType !== 'conduit') definition.height = product.height;
  if (SUBTYPES.includes(product.subType as ContainmentSubType)) definition.subType = product.subType as ContainmentSubType;
  if (MATERIALS.includes(product.material as ContainmentMaterial)) definition.material = product.material as ContainmentMaterial;
  if (FINISHES.includes(product.finish as ContainmentFinish)) definition.finish = product.finish as ContainmentFinish;
  if (positive(product.innerCsaMm2)) definition.innerCsaMm2 = product.innerCsaMm2;
  else if (containmentType === 'conduit' && positive(product.innerDiameter) && product.innerDiameter < width) {
    definition.innerCsaMm2 = Math.PI * (product.innerDiameter / 2) ** 2;
  }
  return {
    id: `catalogue:${encodeURIComponent(catalogueId)}:${encodeURIComponent(product.id)}`,
    kind: 'containment', containmentType, title: product.description || product.partNumber,
    detail: `${product.manufacturer} · ${product.partNumber} · ${dimensionLabel(definition)}`,
    keywords: `add insert catalogue ${containmentType} ${product.category} ${product.description} ${product.manufacturer} ${product.partNumber} ${product.id} ${product.subType ?? ''} ${product.material ?? ''} ${width} ${product.height ?? ''} ${product.stockLength}`,
    identifiers: [product.partNumber, product.id, product.manufacturer], definition,
  };
}

export function getInsertableComponents(project: Project): InsertableComponent[] {
  const components = [...GENERIC_COMPONENTS];
  for (const [catalogueId, catalogue] of Object.entries(project.catalogues ?? {})) {
    const productIds = new Set([...catalogue.productOrder, ...Object.keys(catalogue.products)]);
    for (const productId of productIds) {
      const product = catalogue.products[productId];
      if (!product) continue;
      const component = catalogueComponent(catalogueId, product);
      if (component) components.push(component);
    }
  }
  return components;
}

function insertionLayer(project: Project, kind: InsertableComponent['kind']): string {
  const preferred = kind === 'symbol' ? ['symbols'] : kind === 'equipment'
    ? ['equipment', 'panel layout'] : kind === 'support' ? ['supports', 'containment'] : ['containment'];
  const layers = Object.values(project.layers).filter((layer) => layer.visible && !layer.locked);
  const layer = layers.find((candidate) => preferred.includes(candidate.name.toLowerCase()))
    ?? layers.find((candidate) => candidate.id === project.activeLayerId) ?? layers[0];
  if (!layer) throw new Error('Make a layer visible and unlocked before placing a component.');
  return layer.id;
}

function nextTag(project: Project, prefix: string): string {
  const tags = new Set(Object.values(project.sheets).flatMap((sheet) => Object.values(sheet.entities)
    .flatMap((entity) => (entity.kind === 'equipment' || entity.kind === 'symbol') && entity.tag ? [entity.tag] : [])));
  let number = 1;
  while (tags.has(`${prefix}-${String(number).padStart(2, '0')}`)) number++;
  return `${prefix}-${String(number).padStart(2, '0')}`;
}

/** Create one entity centred at the pointer; inserting it is the caller's transaction. */
export function createComponentEntity(component: InsertableComponent, position: Vec2, project: Project): Entity {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('Choose a valid placement position.');
  const sheet = project.sheets[project.activeSheetId];
  if (!sheet) throw new Error('Choose a sheet before placing a component.');
  const base = { id: nanoid(10), layerId: insertionLayer(project, component.kind), visible: true, locked: false };
  const definition = component.definition;
  switch (definition.kind) {
    case 'containment': {
      const { length, ...fields } = definition;
      const entity: ContainmentEntity = {
        ...base, ...fields, color: '#bcc1c8', label: component.title,
        points: [{ x: position.x - length / 2, y: position.y }, { x: position.x + length / 2, y: position.y }],
      };
      if (sheet.sceneStyle === 'containment') entity.elevation = 0;
      return entity;
    }
    case 'symbol': return {
      ...base, kind: 'symbol', symbolId: definition.symbolId, position: { ...position }, rotation: 0, scale: 1,
      ...(definition.tagPrefix ? { tag: nextTag(project, definition.tagPrefix) } : {}),
    };
    case 'equipment': return {
      ...base, kind: 'equipment', equipmentKind: definition.equipmentKind,
      a: { x: position.x - definition.width / 2, y: position.y - definition.depth / 2 },
      b: { x: position.x + definition.width / 2, y: position.y + definition.depth / 2 },
      height: definition.height, elevation: 0, rotation: 0,
      tag: nextTag(project, definition.tagPrefix), description: component.title,
    };
    case 'support': return {
      ...base, ...definition, position: { ...position }, rotation: 0,
      supportingContainmentIds: [], autoGenerated: false,
      ...(sheet.sceneStyle === 'containment' ? { elevation: 0 } : {}),
    };
  }
}
