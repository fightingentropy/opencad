// Design standards profile — controls fill limits, derating tables,
// segregation rules and reporting language for the entire project.

export type StandardsCode = 'BS7671' | 'NEC' | 'IEC' | 'AS-NZS';

export type StandardsUnitSystem = 'SI' | 'US-customary' | 'mixed';
export type StandardsImplementationStatus = 'reference-snapshot' | 'partial';

export interface StandardsProfile {
  code: StandardsCode;
  // Edition / amendment string for display in reports.
  edition: string;
  amendments: string[];
  jurisdiction: string;
  documentId: string;
  effectiveDate: string;
  sourceUrl: string;
  unitSystem: StandardsUnitSystem;
  // OpenCAD-owned version and digest of the canonical lookup dataset. These
  // are deliberately separate from the publisher's document identifier: we
  // cannot fingerprint a licensed standards publication we do not ship.
  profileVersion: string;
  datasetHash: `sha256:${string}`;
  implementationStatus: StandardsImplementationStatus;
  // Default region for catalogue / pricing
  region?: 'UK' | 'EU' | 'US' | 'CA' | 'AU' | 'NZ' | 'ME' | 'APAC' | 'OTHER';
}

export type StandardsTableId =
  | 'fill-limits'
  | 'voltage-drop-limits'
  | 'space-factor-trunking-bs7671'
  | 'cable-factor-conduit-bs7671'
  | 'conduit-factor-bs7671'
  | 'grouping-enclosed-bs7671'
  | 'grouping-tray-bs7671'
  | 'ambient-xlpe-bs7671'
  | 'ambient-pvc-bs7671'
  | 'ampacity-ref-b-pvc-bs7671'
  | 'ampacity-ref-b-xlpe-bs7671'
  | 'voltage-drop-pvc-single-phase-bs7671'
  | 'voltage-drop-xlpe-three-phase-bs7671'
  | 'overload-coordination-bs7671'
  | 'support-spans-opencad'
  | 'segregation-bs7671';

export interface StandardsSourceTrace {
  profileCode: StandardsCode;
  jurisdiction: string;
  documentId: string;
  edition: string;
  amendments: string[];
  effectiveDate: string;
  tableOrSection: string;
  sourceUrl: string;
  sourceHash: `sha256:${string}`;
  unitSystem: StandardsUnitSystem;
  profileVersion: string;
}

export interface StandardsTrace {
  code: StandardsCode;
  jurisdiction: string;
  documentId: string;
  edition: string;
  amendments: string[];
  effectiveDate: string;
  unitSystem: StandardsUnitSystem;
  profileVersion: string;
  datasetHash: `sha256:${string}`;
  implementationStatus: StandardsImplementationStatus;
  sources: StandardsSourceTrace[];
}

export interface StandardsLookupRow<T = unknown> {
  key: string;
  value: T;
  provenance: StandardsSourceTrace;
}

export const DEFAULT_STANDARDS: Record<StandardsCode, StandardsProfile> = {
  BS7671: {
    code: 'BS7671',
    edition: '18th Edition',
    amendments: ['Amendment 2 (2022)', 'Corrigendum (May 2023)'],
    jurisdiction: 'United Kingdom',
    documentId: 'BS 7671:2018+A2:2022',
    effectiveDate: '2022-09-28',
    sourceUrl: 'https://electrical.theiet.org/guidance-and-codes-of-practice/publications-by-category/bs-7671-and-guidance/',
    unitSystem: 'SI',
    profileVersion: 'bs7671-a2.2',
    datasetHash: 'sha256:a620d8397d00d1718e200e3d9a0ac993c9445f8006dd5ea540fdeaf24c2b3d0e',
    implementationStatus: 'reference-snapshot',
    region: 'UK',
  },
  NEC: {
    code: 'NEC',
    edition: 'NFPA 70 (2023)',
    amendments: [],
    jurisdiction: 'United States (adoption varies by authority)',
    documentId: 'NFPA 70, 2023 edition',
    effectiveDate: 'jurisdiction-dependent',
    sourceUrl: 'https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70',
    unitSystem: 'US-customary',
    profileVersion: 'nec-2023.1',
    datasetHash: 'sha256:4d271542f5a12289ffb768a539bf7c345b7c291b27f0556151993aa2eb6889ce',
    implementationStatus: 'partial',
    region: 'US',
  },
  IEC: {
    code: 'IEC',
    edition: 'IEC 60364-1:2025 / IEC 60364-5-52:2009+A1:2024',
    amendments: ['IEC 60364-5-52 Amendment 1 (2024)'],
    jurisdiction: 'International (local adoption varies)',
    documentId: 'IEC 60364 series',
    effectiveDate: 'jurisdiction-dependent',
    sourceUrl: 'https://webstore.iec.ch/en/publication/63699',
    unitSystem: 'SI',
    profileVersion: 'iec60364-2025.1',
    datasetHash: 'sha256:f51a1472af10b256e1e45af86ad4eed94f2a961268545128fb38c07dff1e0a39',
    implementationStatus: 'partial',
    region: 'EU',
  },
  'AS-NZS': {
    code: 'AS-NZS',
    edition: 'AS/NZS 3000:2018',
    amendments: ['Amendment 1 (2020)', 'Amendment 2 (2021)', 'Amendment 3 (2023)'],
    jurisdiction: 'Australia and New Zealand',
    documentId: 'AS/NZS 3000:2018',
    effectiveDate: 'jurisdiction-dependent',
    sourceUrl: 'https://store.standards.org.au/product/as-nzs-3000-2018',
    unitSystem: 'SI',
    profileVersion: 'as-nzs-3000-2018-a3.1',
    datasetHash: 'sha256:41bb8566b472e98408fabb467764d123c1d7343149c44d87f21adcbc3b5fd2ea',
    implementationStatus: 'partial',
    region: 'AU',
  },
};

// Fill ratio limits — fraction of containment internal cross-section that
// may be occupied by cables. Above this is a code violation.
export interface FillLimits {
  trunking: number; // 0.45 per BS 7671 App 12
  conduit: number; // 0.40 per BS 7671 App 12
  cableTray: number; // typically up to 100% single layer touching
  cableLadder: number;
  cableBasket: number;
  // NEC variant when set
  nec1Conductor?: number; // 0.53
  nec2Conductor?: number; // 0.31
  nec3PlusConductor?: number; // 0.40
}

export const FILL_LIMITS: Record<StandardsCode, FillLimits> = {
  BS7671: {
    trunking: 0.45,
    conduit: 0.40,
    cableTray: 1.00,
    cableLadder: 1.00,
    cableBasket: 1.00,
  },
  NEC: {
    trunking: 0.40,
    conduit: 0.40,
    cableTray: 1.00,
    cableLadder: 1.00,
    cableBasket: 1.00,
    nec1Conductor: 0.53,
    nec2Conductor: 0.31,
    nec3PlusConductor: 0.40,
  },
  IEC: {
    trunking: 0.45,
    conduit: 0.40,
    cableTray: 1.00,
    cableLadder: 1.00,
    cableBasket: 1.00,
  },
  'AS-NZS': {
    trunking: 0.45,
    conduit: 0.40,
    cableTray: 1.00,
    cableLadder: 1.00,
    cableBasket: 1.00,
  },
};

// Voltage drop limits as fraction of nominal supply voltage.
export interface VoltageDropLimits {
  lighting: number;
  other: number;
  // For installations supplied directly by a public network the limits
  // are typically 3% lighting / 5% other from the origin. For private
  // supplies (generators / transformers) BS 7671 allows higher values.
}

export const VDROP_LIMITS: Record<StandardsCode, VoltageDropLimits> = {
  BS7671: { lighting: 0.03, other: 0.05 },
  NEC: { lighting: 0.03, other: 0.05 },
  IEC: { lighting: 0.03, other: 0.05 },
  'AS-NZS': { lighting: 0.03, other: 0.05 },
};

// Cable space factors (mm²) for trunking fill — BS 7671 Table 12A.
// Maps PVC/SWA/XLPE conductor CSA in mm² to a tabulated space factor.
// These are conservative compared to using OD² directly.
export const SPACE_FACTOR_TRUNKING_BS7671: Record<number, number> = {
  1.0: 7.1,
  1.5: 8.1,
  2.5: 11.4,
  4.0: 15.2,
  6.0: 22.9,
  10.0: 36.3,
  16.0: 50.3,
  25.0: 75.4,
  35.0: 95.0,
  50.0: 132.7,
  70.0: 176.7,
  95.0: 227.0,
  120.0: 284.0,
  150.0: 346.0,
  185.0: 410.0,
  240.0: 530.0,
  300.0: 660.0,
  400.0: 855.0,
};

// Cable factors for conduit fill — BS 7671 Table 12C.
export const CABLE_FACTOR_CONDUIT_BS7671: Record<number, number> = {
  1.0: 22,
  1.5: 27,
  2.5: 39,
  4.0: 52,
  6.0: 80,
  10.0: 105,
  16.0: 145,
  25.0: 217,
};

// Conduit factors — BS 7671 Table 12B (straight runs ≤3m, 1 bend).
export const CONDUIT_FACTOR_BS7671: Record<number, number> = {
  16: 290,
  20: 460,
  25: 800,
  32: 1400,
};

// Grouping factor (Cg) per BS 7671 Table 4C1 for thermoplastic / thermosetting
// in trunking or conduit — reduces ampacity as more circuits share the route.
export const GROUPING_FACTORS_ENCLOSED: Record<number, number> = {
  1: 1.00,
  2: 0.80,
  3: 0.70,
  4: 0.65,
  5: 0.60,
  6: 0.57,
  7: 0.54,
  8: 0.52,
  9: 0.50,
  10: 0.48,
  12: 0.45,
  14: 0.43,
  16: 0.41,
  18: 0.39,
  20: 0.38,
};

// Single-layer on tray (touching) — Table 4C3.
export const GROUPING_FACTORS_TRAY: Record<number, number> = {
  1: 1.00,
  2: 0.85,
  3: 0.79,
  4: 0.75,
  5: 0.73,
  6: 0.72,
  7: 0.72,
  8: 0.71,
  9: 0.70,
  // For 10+ a single-layer tray is treated as 0.70
};

// Ambient temperature correction Ca (Table 4B1) — XLPE 90°C cables.
export const AMBIENT_FACTORS_XLPE: Record<number, number> = {
  10: 1.15,
  15: 1.12,
  20: 1.08,
  25: 1.04,
  30: 1.00,
  35: 0.96,
  40: 0.91,
  45: 0.87,
  50: 0.82,
  55: 0.76,
  60: 0.71,
  65: 0.65,
  70: 0.58,
  75: 0.50,
  80: 0.41,
};

// Ambient temperature correction Ca (Table 4B1) — PVC 70°C cables.
export const AMBIENT_FACTORS_PVC: Record<number, number> = {
  10: 1.22,
  15: 1.17,
  20: 1.12,
  25: 1.06,
  30: 1.00,
  35: 0.94,
  40: 0.87,
  45: 0.79,
  50: 0.71,
  55: 0.61,
  60: 0.50,
};

// Reference (un-derated) ampacity seed tables — BS 7671 Reference Method B
// (single-core copper conductors in conduit on a wall / trunking). Values in
// amperes for two loaded conductors. Using these values for another cable
// construction or installation method requires independent verification.
//
// These let the calc engine give a "first cut" sizing without a full
// installation method matrix. A more complete implementation would
// include all reference methods (A through G) per Appendix 4.
export const AMPACITY_REF_B_PVC_COPPER: Record<number, number> = {
  1.0: 13.5,
  1.5: 17.5,
  2.5: 24,
  4.0: 32,
  6.0: 41,
  10.0: 57,
  16.0: 76,
  25.0: 101,
  35.0: 125,
  50.0: 151,
  70.0: 192,
  95.0: 232,
  120.0: 269,
  150.0: 309,
  185.0: 353,
  240.0: 415,
  300.0: 477,
};

export const AMPACITY_REF_B_XLPE_COPPER: Record<number, number> = {
  1.0: 17,
  1.5: 22,
  2.5: 30,
  4.0: 40,
  6.0: 51,
  10.0: 70,
  16.0: 94,
  25.0: 119,
  35.0: 148,
  50.0: 180,
  70.0: 232,
  95.0: 282,
  120.0: 328,
  150.0: 379,
  185.0: 434,
  240.0: 514,
  300.0: 593,
};

// mV/A/m drop for PVC twin-and-earth, single-phase, copper — Table 4D2B.
export const VDROP_MV_A_M_PVC_SP: Record<number, number> = {
  1.0: 44,
  1.5: 29,
  2.5: 18,
  4.0: 11,
  6.0: 7.3,
  10.0: 4.4,
  16.0: 2.8,
  25.0: 1.75,
  35.0: 1.25,
  50.0: 0.93,
  70.0: 0.63,
  95.0: 0.46,
  120.0: 0.36,
  150.0: 0.29,
  185.0: 0.23,
  240.0: 0.18,
  300.0: 0.14,
};

// mV/A/m for XLPE three-phase copper — Table 4E2B.
export const VDROP_MV_A_M_XLPE_3P: Record<number, number> = {
  1.5: 25,
  2.5: 15,
  4.0: 9.5,
  6.0: 6.4,
  10.0: 3.8,
  16.0: 2.4,
  25.0: 1.5,
  35.0: 1.10,
  50.0: 0.81,
  70.0: 0.55,
  95.0: 0.41,
  120.0: 0.33,
  150.0: 0.27,
  185.0: 0.21,
  240.0: 0.165,
  300.0: 0.135,
  400.0: 0.110,
};

// Maximum support spans (mm) for typical containment per BS EN 61537 /
// manufacturer data. Indexed by [containment kind][nominal width or size].
//
// "Span" is centre-to-centre between adjacent supports for a horizontal
// run of medium load class. Vertical and external runs use different
// rules — see SUPPORT_RULES.
export const SUPPORT_SPANS_HORIZONTAL_MM = {
  ladder: { 150: 3000, 300: 3000, 450: 3000, 600: 3000, 750: 2500, 900: 2500 },
  tray: { 100: 2000, 150: 2000, 200: 1800, 300: 1500, 450: 1500, 600: 1500 },
  basket: { 60: 1500, 100: 1500, 150: 1500, 200: 1500, 300: 1200, 400: 1200, 500: 1000, 600: 1000 },
  trunking: { 25: 1200, 50: 1200, 75: 1200, 100: 1200, 150: 1200 },
  conduit_steel: { 16: 1500, 20: 1750, 25: 2000, 32: 2250, 40: 2500, 50: 3000, 63: 3000 },
  conduit_pvc: { 16: 600, 20: 750, 25: 900, 32: 1000, 40: 1100, 50: 1200, 63: 1500 },
} as const;

// Segregation distances (mm) between cable categories.
// Power vs data is the canonical example — BS 7671 528.1 / IET GN1.
export const SEGREGATION_MIN_MM: Record<string, Record<string, number>> = {
  power: { data: 50, comms: 50, 'fire-alarm': 0, emergency: 0, instrumentation: 50 },
  data: { power: 50, comms: 0, 'fire-alarm': 25, emergency: 25, instrumentation: 25 },
  'fire-alarm': { power: 0, data: 25, emergency: 0, comms: 25, instrumentation: 25 },
};

interface TableReference {
  profileCode?: StandardsCode;
  tableOrSection: string;
  documentId?: string;
  edition?: string;
  sourceUrl?: string;
}

const TABLE_REFERENCES: Record<StandardsTableId, TableReference> = {
  'fill-limits': { tableOrSection: 'Containment fill limits (profile-specific)' },
  'voltage-drop-limits': { tableOrSection: 'Voltage-drop design limits (profile-specific)' },
  'space-factor-trunking-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 12, Table 12A' },
  'cable-factor-conduit-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 12, Table 12C' },
  'conduit-factor-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 12, Table 12B' },
  'grouping-enclosed-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4C1' },
  'grouping-tray-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4C3' },
  'ambient-xlpe-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4B1 (90 C thermosetting)' },
  'ambient-pvc-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4B1 (70 C thermoplastic)' },
  'ampacity-ref-b-pvc-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4D1A, reference method B, two loaded conductors (PVC copper seed values)' },
  'ampacity-ref-b-xlpe-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4E1A, reference method B, two loaded conductors (XLPE copper seed values)' },
  'voltage-drop-pvc-single-phase-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4D2B seed values' },
  'voltage-drop-xlpe-three-phase-bs7671': { profileCode: 'BS7671', tableOrSection: 'Appendix 4, Table 4E2B seed values' },
  'overload-coordination-bs7671': { profileCode: 'BS7671', tableOrSection: 'Regulation 433.1.1 (Ib <= In <= Iz; I2 <= 1.45 Iz)' },
  'support-spans-opencad': {
    profileCode: 'BS7671',
    tableOrSection: 'OpenCAD conservative seed spans; verify against the selected manufacturer load/span table',
    documentId: 'OpenCAD support-span engineering policy',
    edition: '1',
    sourceUrl: 'https://webstore.iec.ch/en/publication/31963',
  },
  'segregation-bs7671': { profileCode: 'BS7671', tableOrSection: 'Section 528 / IET Guidance Note 1 seed distances' },
};

/**
 * Canonical payload covered by a profile's dataset hash. A failing hash test
 * forces a deliberate profile-version/hash update whenever a lookup changes.
 */
export const standardsDatasetSnapshot = (code: StandardsCode): string => {
  const profile = DEFAULT_STANDARDS[code];
  const common = {
    code: profile.code,
    documentId: profile.documentId,
    edition: profile.edition,
    amendments: profile.amendments,
    effectiveDate: profile.effectiveDate,
    profileVersion: profile.profileVersion,
    fillLimits: FILL_LIMITS[code],
    voltageDropLimits: VDROP_LIMITS[code],
  };
  if (code !== 'BS7671') return JSON.stringify(common);
  return JSON.stringify({
    ...common,
    spaceFactorTrunking: SPACE_FACTOR_TRUNKING_BS7671,
    cableFactorConduit: CABLE_FACTOR_CONDUIT_BS7671,
    conduitFactor: CONDUIT_FACTOR_BS7671,
    groupingEnclosed: GROUPING_FACTORS_ENCLOSED,
    groupingTray: GROUPING_FACTORS_TRAY,
    ambientXlpe: AMBIENT_FACTORS_XLPE,
    ambientPvc: AMBIENT_FACTORS_PVC,
    ampacityRefBPvcCopper: AMPACITY_REF_B_PVC_COPPER,
    ampacityRefBXlpeCopper: AMPACITY_REF_B_XLPE_COPPER,
    voltageDropPvcSinglePhase: VDROP_MV_A_M_PVC_SP,
    voltageDropXlpeThreePhase: VDROP_MV_A_M_XLPE_3P,
    overloadCoordination: { Ib_le_In: true, In_le_Iz: true, I2_le_1_45_Iz: true },
    supportSpans: SUPPORT_SPANS_HORIZONTAL_MM,
    segregation: SEGREGATION_MIN_MM,
  });
};

export const normalizeStandardsProfile = (
  profile?: Partial<StandardsProfile> | null,
): StandardsProfile => {
  const code = profile?.code && profile.code in DEFAULT_STANDARDS
    ? profile.code
    : 'BS7671';
  const canonical = DEFAULT_STANDARDS[code];
  // Canonical provenance always wins over stale persisted display fields;
  // region remains project-selectable.
  return { ...canonical, region: profile?.region ?? canonical.region };
};

const sourceTraceFor = (
  tableId: StandardsTableId,
  requestedCode: StandardsCode,
): StandardsSourceTrace => {
  const ref = TABLE_REFERENCES[tableId];
  const profile = DEFAULT_STANDARDS[ref.profileCode ?? requestedCode];
  return {
    profileCode: profile.code,
    jurisdiction: profile.jurisdiction,
    documentId: ref.documentId ?? profile.documentId,
    edition: ref.edition ?? profile.edition,
    amendments: [...profile.amendments],
    effectiveDate: profile.effectiveDate,
    tableOrSection: ref.tableOrSection,
    sourceUrl: ref.sourceUrl ?? profile.sourceUrl,
    sourceHash: profile.datasetHash,
    unitSystem: profile.unitSystem,
    profileVersion: profile.profileVersion,
  };
};

export const createStandardsTrace = (
  profileOrCode: StandardsProfile | StandardsCode | undefined,
  tableIds: readonly StandardsTableId[] = [],
): StandardsTrace => {
  const requested = typeof profileOrCode === 'string'
    ? DEFAULT_STANDARDS[profileOrCode]
    : normalizeStandardsProfile(profileOrCode);
  return {
    code: requested.code,
    jurisdiction: requested.jurisdiction,
    documentId: requested.documentId,
    edition: requested.edition,
    amendments: [...requested.amendments],
    effectiveDate: requested.effectiveDate,
    unitSystem: requested.unitSystem,
    profileVersion: requested.profileVersion,
    datasetHash: requested.datasetHash,
    implementationStatus: requested.implementationStatus,
    sources: tableIds.map((tableId) => sourceTraceFor(tableId, requested.code)),
  };
};

const flatRows = (
  tableId: StandardsTableId,
  values: Record<string | number, unknown>,
  code: StandardsCode,
): StandardsLookupRow[] => {
  const provenance = sourceTraceFor(tableId, code);
  return Object.entries(values).map(([key, value]) => ({ key, value, provenance }));
};

const nestedRows = (
  tableId: StandardsTableId,
  values: Record<string, Record<string | number, unknown>>,
  code: StandardsCode,
): StandardsLookupRow[] => Object.entries(values).flatMap(([group, entries]) =>
  flatRows(tableId, entries, code).map((row) => ({ ...row, key: `${group}.${row.key}` })),
);

/** Every lookup value with its complete, exportable provenance. */
export const standardsLookupRows = (
  tableId: StandardsTableId,
  code: StandardsCode = 'BS7671',
): StandardsLookupRow[] => {
  switch (tableId) {
    case 'fill-limits': return flatRows(tableId, FILL_LIMITS[code] as unknown as Record<string, unknown>, code);
    case 'voltage-drop-limits': return flatRows(tableId, VDROP_LIMITS[code] as unknown as Record<string, unknown>, code);
    case 'space-factor-trunking-bs7671': return flatRows(tableId, SPACE_FACTOR_TRUNKING_BS7671, code);
    case 'cable-factor-conduit-bs7671': return flatRows(tableId, CABLE_FACTOR_CONDUIT_BS7671, code);
    case 'conduit-factor-bs7671': return flatRows(tableId, CONDUIT_FACTOR_BS7671, code);
    case 'grouping-enclosed-bs7671': return flatRows(tableId, GROUPING_FACTORS_ENCLOSED, code);
    case 'grouping-tray-bs7671': return flatRows(tableId, GROUPING_FACTORS_TRAY, code);
    case 'ambient-xlpe-bs7671': return flatRows(tableId, AMBIENT_FACTORS_XLPE, code);
    case 'ambient-pvc-bs7671': return flatRows(tableId, AMBIENT_FACTORS_PVC, code);
    case 'ampacity-ref-b-pvc-bs7671': return flatRows(tableId, AMPACITY_REF_B_PVC_COPPER, code);
    case 'ampacity-ref-b-xlpe-bs7671': return flatRows(tableId, AMPACITY_REF_B_XLPE_COPPER, code);
    case 'voltage-drop-pvc-single-phase-bs7671': return flatRows(tableId, VDROP_MV_A_M_PVC_SP, code);
    case 'voltage-drop-xlpe-three-phase-bs7671': return flatRows(tableId, VDROP_MV_A_M_XLPE_3P, code);
    case 'overload-coordination-bs7671': return flatRows(tableId, { Ib_le_In: true, In_le_Iz: true, I2_le_1_45_Iz: true }, code);
    case 'support-spans-opencad': return nestedRows(tableId, SUPPORT_SPANS_HORIZONTAL_MM as unknown as Record<string, Record<string, unknown>>, code);
    case 'segregation-bs7671': return nestedRows(tableId, SEGREGATION_MIN_MM, code);
  }
};
