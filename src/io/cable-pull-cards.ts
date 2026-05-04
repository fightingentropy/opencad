// Cable pull cards — one printable card per cable with a turn-by-turn
// route the installer can follow drum-side. The pulling tension is a
// rough "first cut" using the well-known straight-pull plus bend
// multiplier formula:
//
//   T_total = T_initial × Π (1 + μ × cos θᵢ) per bend × Σ w·L per straight
//
// This is illustrative — not certified. The card flags it as ESTIMATE.

import type { Project, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import { dist } from '../lib/math';

export interface CablePullCardSegment {
  containmentRef: string;
  type: string;
  size: string;
  lengthM: number;
  bends: number;
  elevation: number;
}

export interface CablePullCard {
  ref: string;
  description: string;
  from: string;
  to: string;
  cableType: string;
  cableSize: string;
  totalLengthM: number;
  drumLengthM: number; // including allowance
  estimatedTensionN: number;
  segments: CablePullCardSegment[];
  terminations: string[];
  notes: string[];
}

const FRICTION_COEFFICIENT = 0.4;
const BEND_FACTOR = 1.6; // tension multiplier per 90° bend (rough)
const GRAVITY = 9.81;

const sizeLabel = (c: ContainmentEntity): string => {
  if (c.containmentType === 'conduit') return c.width ? `${c.width} mm Ø` : '';
  if (c.width && c.height) return `${c.width} × ${c.height} mm`;
  return c.width ? `${c.width} mm` : '';
};

const bendsInPolyline = (points: { x: number; y: number }[]): number => {
  if (points.length < 3) return 0;
  let n = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    if (Math.abs(ax * by - ay * bx) > 1e-3) n++;
  }
  return n;
};

const lengthMm = (points: { x: number; y: number }[]): number => {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
};

const findContainment = (
  project: Project,
  id: string,
): ContainmentEntity | null => {
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    const e = sheet?.entities[id];
    if (e && e.kind === 'containment') return e as ContainmentEntity;
  }
  return null;
};

const buildSegments = (
  project: Project,
  cable: Cable,
): CablePullCardSegment[] => {
  const segs: CablePullCardSegment[] = [];
  let auto = 1;
  for (const id of cable.route) {
    const c = findContainment(project, id);
    if (!c) continue;
    segs.push({
      containmentRef: c.label ?? `CT-${String(auto++).padStart(3, '0')}`,
      type: `${c.containmentType}${c.subType ? ` (${c.subType})` : ''}`,
      size: sizeLabel(c),
      lengthM: +(lengthMm(c.points ?? []) / 1000).toFixed(2),
      bends: bendsInPolyline(c.points ?? []),
      elevation: c.elevation ?? 0,
    });
  }
  return segs;
};

const estimateTensionN = (
  cable: Cable,
  segments: CablePullCardSegment[],
): number => {
  // Mass × g × length × friction for each straight
  const massPerM = cable.massPerMetre ?? 0.5; // crude default
  let tension = 50; // 50 N initial pull (slack)
  for (const s of segments) {
    const straight = massPerM * GRAVITY * s.lengthM * FRICTION_COEFFICIENT;
    tension = (tension + straight) * Math.pow(BEND_FACTOR, s.bends);
  }
  return Math.round(tension);
};

const formatTermination = (project: Project, cable: Cable): string[] => {
  const out: string[] = [];
  out.push(
    `From: ${cable.from}${cable.fromEntityId ? ` (entity ${cable.fromEntityId.slice(0, 8)})` : ''}`,
  );
  out.push(
    `To: ${cable.to}${cable.toEntityId ? ` (entity ${cable.toEntityId.slice(0, 8)})` : ''}`,
  );
  if (cable.systemId) {
    const sys = project.systems?.[cable.systemId];
    if (sys) out.push(`System: ${sys.name}`);
  }
  if (cable.protectiveDevice) {
    out.push(
      `Protection: ${cable.protectiveDevice}${cable.protectiveDeviceRating ? ` (${cable.protectiveDeviceRating} A)` : ''}`,
    );
  }
  return out;
};

const buildNotes = (cable: Cable, tension: number): string[] => {
  const notes: string[] = [];
  notes.push('ESTIMATE ONLY — verify against manufacturer tension limits.');
  if (cable.calculated?.vdropOk === false) {
    notes.push(
      `Voltage drop limit exceeded (${(cable.calculated.voltageDropPct ?? 0).toFixed(1)}%) — review sizing before pull.`,
    );
  }
  if (cable.calculated?.ampacityOk === false) {
    notes.push('Ampacity check failed — confirm correction factors.');
  }
  if (tension > 5000) {
    notes.push(
      'High pulling tension predicted — consider an intermediate pull-pit or lubricant.',
    );
  }
  return notes;
};

export const generateCablePullCards = (
  project: Project,
): CablePullCard[] => {
  const sched = project.cableSchedule;
  if (!sched) return [];
  const cards: CablePullCard[] = [];
  for (const id of sched.cableOrder) {
    const cable = sched.cables[id];
    if (!cable) continue;
    const segments = buildSegments(project, cable);
    const totalLengthM = segments.reduce((a, b) => a + b.lengthM, 0);
    const drumLengthM = +(
      totalLengthM * 1.05 +
      (cable.lengthAllowance ?? 0)
    ).toFixed(2);
    const tension = estimateTensionN(cable, segments);
    cards.push({
      ref: cable.reference,
      description: cable.description ?? '',
      from: cable.from,
      to: cable.to,
      cableType: `${cable.construction} / ${cable.circuitType}`,
      cableSize: `${cable.cores} × ${cable.csa} mm² @ ${cable.voltage} V`,
      totalLengthM: +totalLengthM.toFixed(2),
      drumLengthM,
      estimatedTensionN: tension,
      segments,
      terminations: formatTermination(project, cable),
      notes: buildNotes(cable, tension),
    });
  }
  return cards;
};

const pad = (s: string, w: number): string =>
  s.length >= w ? s : s + ' '.repeat(w - s.length);

const cardToText = (card: CablePullCard): string => {
  const lines: string[] = [];
  const bar = '─'.repeat(70);
  lines.push(bar);
  lines.push(`CABLE PULL CARD  ${card.ref}`);
  lines.push(bar);
  lines.push(`Cable        : ${card.cableSize}  ${card.cableType}`);
  if (card.description) lines.push(`Description  : ${card.description}`);
  lines.push(`From         : ${card.from}`);
  lines.push(`To           : ${card.to}`);
  lines.push(`Total length : ${card.totalLengthM.toFixed(2)} m`);
  lines.push(
    `Drum length  : ${card.drumLengthM.toFixed(2)} m  (incl. 5% + allowance)`,
  );
  lines.push(`Pull tension : ~${card.estimatedTensionN} N (estimate)`);
  lines.push('');
  lines.push('ROUTE');
  lines.push('  ' + pad('Segment', 12) + pad('Type', 26) + pad('Size', 16) + pad('Len(m)', 8) + 'Bends');
  for (const s of card.segments) {
    lines.push(
      '  ' +
        pad(s.containmentRef, 12) +
        pad(s.type, 26) +
        pad(s.size, 16) +
        pad(s.lengthM.toFixed(2), 8) +
        String(s.bends),
    );
  }
  lines.push('');
  lines.push('TERMINATIONS');
  for (const t of card.terminations) lines.push('  ' + t);
  if (card.notes.length) {
    lines.push('');
    lines.push('NOTES');
    for (const n of card.notes) lines.push('  • ' + n);
  }
  lines.push('');
  return lines.join('\n');
};

export const cablePullCardsToText = (cards: CablePullCard[]): string => {
  if (cards.length === 0) return 'No cables in schedule.\n';
  return cards.map(cardToText).join('\n');
};
