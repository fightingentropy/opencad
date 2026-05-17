// Shared test fixture builders for the calc test suite.

import type {
  ContainmentEntity,
  ContainmentType,
  Entity,
  EntityId,
  Project,
  Sheet,
  SheetId,
  Vec2,
  SupportEntity,
} from '../../types';
import type { Cable, CableConstruction, CableCircuitType } from '../../models/cable';
import type { StandardsProfile } from '../../models/standards';
import { DEFAULT_STANDARDS } from '../../models/standards';

let nextId = 1;
const id = (prefix: string): string => `${prefix}-${nextId++}`;

export const resetIds = (): void => {
  nextId = 1;
};

export const bs7671: StandardsProfile = DEFAULT_STANDARDS.BS7671;
export const nec: StandardsProfile = DEFAULT_STANDARDS.NEC;

export interface MakeContainmentOpts {
  containmentType?: ContainmentType;
  width?: number;
  height?: number;
  points?: Vec2[];
  innerCsaMm2?: number;
  compartments?: number;
  cableCategory?: ContainmentEntity['cableCategory'];
  subType?: ContainmentEntity['subType'];
  material?: ContainmentEntity['material'];
  elevation?: number;
  manufacturer?: string;
  catalogPartNumber?: string;
  label?: string;
}

export const makeContainment = (
  opts: MakeContainmentOpts = {},
): ContainmentEntity => ({
  id: id('cont'),
  kind: 'containment',
  layerId: 'layer-default',
  visible: true,
  locked: false,
  containmentType: opts.containmentType ?? 'trunking',
  width: opts.width ?? 100,
  height: opts.height ?? 50,
  points: opts.points ?? [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
  ],
  innerCsaMm2: opts.innerCsaMm2,
  compartments: opts.compartments,
  cableCategory: opts.cableCategory,
  subType: opts.subType,
  material: opts.material,
  elevation: opts.elevation,
  manufacturer: opts.manufacturer,
  catalogPartNumber: opts.catalogPartNumber,
  label: opts.label,
});

export interface MakeCableOpts {
  csa?: number;
  cores?: number;
  outerDiameter?: number;
  circuitType?: CableCircuitType;
  construction?: CableConstruction;
  reference?: string;
  voltage?: number;
  designCurrent?: number;
  estimatedLength?: number;
  massPerMetre?: number;
  route?: EntityId[];
}

export const makeCable = (opts: MakeCableOpts = {}): Cable => ({
  id: id('cable'),
  reference: opts.reference ?? 'C-001',
  from: 'A',
  to: 'B',
  circuitType: opts.circuitType ?? 'power',
  construction: opts.construction ?? 'PVC/PVC',
  cores: opts.cores ?? 2,
  csa: opts.csa ?? 2.5,
  hasEarth: true,
  outerDiameter: opts.outerDiameter ?? 12,
  voltage: opts.voltage ?? 230,
  designCurrent: opts.designCurrent,
  estimatedLength: opts.estimatedLength,
  massPerMetre: opts.massPerMetre,
  route: opts.route ?? [],
});

export const makeSupport = (
  containmentId: EntityId,
  swl: number = 50,
): SupportEntity => ({
  id: id('sup'),
  kind: 'support',
  layerId: 'layer-default',
  visible: true,
  locked: false,
  supportKind: 'trapeze-hanger',
  position: { x: 0, y: 0 },
  rotation: 0,
  supportingContainmentIds: [containmentId],
  safeWorkingLoadKg: swl,
});

export interface MakeProjectOpts {
  containments?: ContainmentEntity[];
  supports?: SupportEntity[];
  cables?: Cable[];
  standardsProfile?: StandardsProfile;
}

export const makeProject = (opts: MakeProjectOpts = {}): Project => {
  const sheetId: SheetId = id('sheet');
  const containments = opts.containments ?? [];
  const supports = opts.supports ?? [];
  const cables = opts.cables ?? [];
  const entities: Record<EntityId, Entity> = {};
  for (const c of containments) entities[c.id] = c;
  for (const s of supports) entities[s.id] = s;
  const sheet: Sheet = {
    id: sheetId,
    name: 'Test Sheet',
    number: 'TS-001',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities,
    entityOrder: [...containments.map((c) => c.id), ...supports.map((s) => s.id)],
  };
  const project: Project = {
    id: id('proj'),
    name: 'Test Project',
    created: 0,
    modified: 0,
    layers: {},
    layerOrder: [],
    sheets: { [sheetId]: sheet },
    sheetOrder: [sheetId],
    activeSheetId: sheetId,
    activeLayerId: 'layer-default',
    units: 'mm',
    standard: 'IEC',
    standardsProfile: opts.standardsProfile ?? bs7671,
    cableSchedule: {
      cables: Object.fromEntries(cables.map((c) => [c.id, c])),
      cableOrder: cables.map((c) => c.id),
    },
  };
  return project;
};
