// Sample cable schedule data — produces a representative selection of
// cables for a multi-floor commercial / light-industrial project. Used by
// the whole-site sample, but exported standalone so a fresh project can
// also pull in a starter schedule for testing the cable schedule UI.

import { nanoid } from 'nanoid';
import type {
  Cable,
  CableConstruction,
  CableSchedule,
  CableCircuitType,
} from './models/cable';
import { emptyCableSchedule } from './models/cable';

const newCableId = (): string => nanoid(10);

export interface SampleCableRefs {
  // Equipment tag to entity-id map. Optional — when absent we leave
  // fromEntityId / toEntityId undefined and rely on the free-text from/to.
  byTag?: Record<string, string>;
  // System-id map keyed by simple system kind.
  systems?: {
    powerDistribution?: string;
    lighting?: string;
    fireAlarm?: string;
    data?: string;
    emergencyLighting?: string;
  };
}

interface CableTemplate {
  ref: string;
  description: string;
  from: string;
  to: string;
  circuitType: CableCircuitType;
  construction: CableConstruction;
  cores: number;
  csa: number;
  hasEarth: boolean;
  earthCsa?: number;
  outerDiameter: number;
  voltage: number;
  designCurrent?: number;
  protectiveDevice?: string;
  protectiveDeviceRating?: number;
  estimatedLength?: number;
  systemKey?: keyof NonNullable<SampleCableRefs['systems']>;
}

// 18 representative cables — power feeders, sub-mains, lighting, fire
// alarm loop and data backbone. References follow a consistent project
// numbering scheme: <type>-<from>-<to>-<seq>.
const TEMPLATES: CableTemplate[] = [
  // ---- Sub-mains: incomer to MCC, MCC out to building DBs ----
  {
    ref: 'PW-INC-MCC-001',
    description: '11 kV/400 V transformer to Main MCC',
    from: 'TX-01',
    to: 'MCC-01',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 240,
    hasEarth: true,
    earthCsa: 95,
    outerDiameter: 58,
    voltage: 1000,
    designCurrent: 380,
    protectiveDevice: 'ACB 630A',
    protectiveDeviceRating: 630,
    estimatedLength: 35,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-MCC-DB1A-001',
    description: 'MCC sub-main to Office G-DB1',
    from: 'MCC-01',
    to: 'DB-OF-G',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 70,
    hasEarth: true,
    earthCsa: 35,
    outerDiameter: 32,
    voltage: 1000,
    designCurrent: 145,
    protectiveDevice: 'MCCB 200A',
    protectiveDeviceRating: 200,
    estimatedLength: 48,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-MCC-DB1B-002',
    description: 'MCC sub-main to Office L1-DB1',
    from: 'MCC-01',
    to: 'DB-OF-1',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 70,
    hasEarth: true,
    earthCsa: 35,
    outerDiameter: 32,
    voltage: 1000,
    designCurrent: 145,
    protectiveDevice: 'MCCB 200A',
    protectiveDeviceRating: 200,
    estimatedLength: 62,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-MCC-DB2A-003',
    description: 'MCC sub-main to Plant G-DB1',
    from: 'MCC-01',
    to: 'DB-PL-G',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 95,
    hasEarth: true,
    earthCsa: 50,
    outerDiameter: 36,
    voltage: 1000,
    designCurrent: 175,
    protectiveDevice: 'MCCB 250A',
    protectiveDeviceRating: 250,
    estimatedLength: 85,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-MCC-DB2B-004',
    description: 'MCC sub-main to Plant Deck-DB1',
    from: 'MCC-01',
    to: 'DB-PL-D',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 50,
    hasEarth: true,
    earthCsa: 25,
    outerDiameter: 28,
    voltage: 1000,
    designCurrent: 110,
    protectiveDevice: 'MCCB 125A',
    protectiveDeviceRating: 125,
    estimatedLength: 110,
    systemKey: 'powerDistribution',
  },
  // ---- Lighting circuits ----
  {
    ref: 'LT-DB1A-OF-G-001',
    description: 'Office G general lighting circuit 1',
    from: 'DB-OF-G',
    to: 'LT-OF-G-01',
    circuitType: 'power',
    construction: 'PVC/PVC',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 9,
    voltage: 230,
    designCurrent: 8,
    protectiveDevice: 'MCB B16',
    protectiveDeviceRating: 16,
    estimatedLength: 32,
    systemKey: 'lighting',
  },
  {
    ref: 'LT-DB1A-OF-G-002',
    description: 'Office G general lighting circuit 2',
    from: 'DB-OF-G',
    to: 'LT-OF-G-02',
    circuitType: 'power',
    construction: 'PVC/PVC',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 9,
    voltage: 230,
    designCurrent: 9,
    protectiveDevice: 'MCB B16',
    protectiveDeviceRating: 16,
    estimatedLength: 38,
    systemKey: 'lighting',
  },
  {
    ref: 'LT-DB1B-OF-1-001',
    description: 'Office L1 general lighting circuit 1',
    from: 'DB-OF-1',
    to: 'LT-OF-1-01',
    circuitType: 'power',
    construction: 'PVC/PVC',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 9,
    voltage: 230,
    designCurrent: 9,
    protectiveDevice: 'MCB B16',
    protectiveDeviceRating: 16,
    estimatedLength: 36,
    systemKey: 'lighting',
  },
  // ---- Small power / sockets ----
  {
    ref: 'PW-DB1A-OF-G-RING',
    description: 'Office G ring final circuit (sockets)',
    from: 'DB-OF-G',
    to: 'SK-OF-G-RING',
    circuitType: 'power',
    construction: 'PVC/PVC',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 9,
    voltage: 230,
    designCurrent: 26,
    protectiveDevice: 'MCB B32',
    protectiveDeviceRating: 32,
    estimatedLength: 55,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-DB1B-OF-1-RING',
    description: 'Office L1 ring final circuit (sockets)',
    from: 'DB-OF-1',
    to: 'SK-OF-1-RING',
    circuitType: 'power',
    construction: 'PVC/PVC',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 9,
    voltage: 230,
    designCurrent: 28,
    protectiveDevice: 'MCB B32',
    protectiveDeviceRating: 32,
    estimatedLength: 58,
    systemKey: 'powerDistribution',
  },
  // ---- Plant motors and HVAC ----
  {
    ref: 'PW-DB2A-AHU01',
    description: 'AHU-01 motor feed',
    from: 'DB-PL-G',
    to: 'AHU-01',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 16,
    hasEarth: true,
    earthCsa: 16,
    outerDiameter: 19,
    voltage: 400,
    designCurrent: 38,
    protectiveDevice: 'MCCB 50A',
    protectiveDeviceRating: 50,
    estimatedLength: 28,
    systemKey: 'powerDistribution',
  },
  {
    ref: 'PW-DB2A-PUMP01',
    description: 'Booster pump P-01',
    from: 'DB-PL-G',
    to: 'P-01',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 4,
    csa: 6,
    hasEarth: true,
    earthCsa: 6,
    outerDiameter: 14,
    voltage: 400,
    designCurrent: 14,
    protectiveDevice: 'MCB C20',
    protectiveDeviceRating: 20,
    estimatedLength: 22,
    systemKey: 'powerDistribution',
  },
  // ---- Fire alarm loop ----
  {
    ref: 'FA-PNL-LOOP1',
    description: 'Fire alarm addressable loop 1',
    from: 'FAP-01',
    to: 'FA-LOOP-1',
    circuitType: 'fire-alarm',
    construction: 'FP200',
    cores: 2,
    csa: 1.5,
    hasEarth: false,
    outerDiameter: 7,
    voltage: 50,
    designCurrent: 0.5,
    protectiveDevice: 'Loop card 1',
    estimatedLength: 145,
    systemKey: 'fireAlarm',
  },
  {
    ref: 'FA-PNL-LOOP2',
    description: 'Fire alarm addressable loop 2 (Plant)',
    from: 'FAP-01',
    to: 'FA-LOOP-2',
    circuitType: 'fire-alarm',
    construction: 'FP200',
    cores: 2,
    csa: 1.5,
    hasEarth: false,
    outerDiameter: 7,
    voltage: 50,
    designCurrent: 0.5,
    protectiveDevice: 'Loop card 2',
    estimatedLength: 165,
    systemKey: 'fireAlarm',
  },
  // ---- Emergency lighting ----
  {
    ref: 'EM-DB1A-OF-G-001',
    description: 'Emergency lighting circuit Office G',
    from: 'DB-OF-G',
    to: 'EM-OF-G-01',
    circuitType: 'emergency',
    construction: 'FP200',
    cores: 3,
    csa: 1.5,
    hasEarth: true,
    earthCsa: 1.5,
    outerDiameter: 8,
    voltage: 230,
    designCurrent: 3,
    protectiveDevice: 'MCB B6',
    protectiveDeviceRating: 6,
    estimatedLength: 42,
    systemKey: 'emergencyLighting',
  },
  // ---- Data backbone ----
  {
    ref: 'DT-CR-OF-G-OS2',
    description: 'Comms-room to Office G IDF — fibre OS2',
    from: 'CR-01',
    to: 'IDF-OF-G',
    circuitType: 'data',
    construction: 'fibre-OS2',
    cores: 12,
    csa: 0.125,
    hasEarth: false,
    outerDiameter: 9,
    voltage: 0,
    estimatedLength: 38,
    systemKey: 'data',
  },
  {
    ref: 'DT-CR-OF-1-OS2',
    description: 'Comms-room to Office L1 IDF — fibre OS2',
    from: 'CR-01',
    to: 'IDF-OF-1',
    circuitType: 'data',
    construction: 'fibre-OS2',
    cores: 12,
    csa: 0.125,
    hasEarth: false,
    outerDiameter: 9,
    voltage: 0,
    estimatedLength: 52,
    systemKey: 'data',
  },
  {
    ref: 'DT-CR-PL-G-CAT6A',
    description: 'Comms-room to Plant Cabinet — Cat 6A',
    from: 'CR-01',
    to: 'CAB-PL-G',
    circuitType: 'data',
    construction: 'cat6a',
    cores: 4,
    csa: 0.5,
    hasEarth: false,
    outerDiameter: 8,
    voltage: 0,
    estimatedLength: 78,
    systemKey: 'data',
  },
];

export const createSampleCableSchedule = (
  refs: SampleCableRefs = {},
): CableSchedule => {
  const schedule = emptyCableSchedule();
  const tagMap = refs.byTag ?? {};
  const systems = refs.systems ?? {};
  for (const t of TEMPLATES) {
    const id = newCableId();
    const cable: Cable = {
      id,
      reference: t.ref,
      description: t.description,
      from: t.from,
      to: t.to,
      fromEntityId: tagMap[t.from],
      toEntityId: tagMap[t.to],
      systemId: t.systemKey ? systems[t.systemKey] : undefined,
      circuitType: t.circuitType,
      construction: t.construction,
      cores: t.cores,
      csa: t.csa,
      hasEarth: t.hasEarth,
      earthCsa: t.earthCsa,
      outerDiameter: t.outerDiameter,
      voltage: t.voltage,
      route: [],
      estimatedLength: t.estimatedLength,
      designCurrent: t.designCurrent,
      protectiveDevice: t.protectiveDevice,
      protectiveDeviceRating: t.protectiveDeviceRating,
      status: 'design',
    };
    schedule.cables[id] = cable;
    schedule.cableOrder.push(id);
  }
  return schedule;
};

// Convenience export — number of cables produced by the standard sample.
export const SAMPLE_CABLE_COUNT = TEMPLATES.length;
