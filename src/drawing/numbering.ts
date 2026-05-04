// BS EN ISO 19650-2 structured drawing numbering.
//
// Format:  PROJECT-ORIGINATOR-VOLUME-LEVEL-TYPE-DISCIPLINE-SEQUENCE
// Example: PRJ-NGB-ZZ-01-DR-E-0001
//
// All seven fields are upper-case alphanumeric. Sequence is zero-padded
// to four digits — the project-wide counter is independent for each
// (volume, level, discipline, type) tuple.

import type { Project } from '../types';
import type { SheetMeta } from '../models/revision';

// Discipline codes — the trade responsible for the drawing.
// E = Electrical, M = Mechanical, A = Architectural, S = Structural,
// C = Civil, P = Plumbing/Public-Health, F = Fire, T = Telecoms,
// L = Landscape, G = General/Coordination, X = Multidisciplinary.
export const DISCIPLINES = [
  'E',
  'M',
  'A',
  'S',
  'C',
  'P',
  'F',
  'T',
  'L',
  'G',
  'X',
] as const;
export type DisciplineCode = (typeof DISCIPLINES)[number];

// Document types — the kind of information the drawing carries.
// DR = Drawing, SK = Sketch, M3 = 3D model, SP = Specification,
// RP = Report, SH = Schedule, CA = Calculation, ME = Memo,
// VS = Visualisation, MR = Minutes of meeting.
export const DOC_TYPES = [
  'DR',
  'SK',
  'M3',
  'SP',
  'RP',
  'SH',
  'CA',
  'ME',
  'VS',
  'MR',
] as const;
export type DocTypeCode = (typeof DOC_TYPES)[number];

// "ZZ" is the universal "applies-everywhere" volume / level placeholder.
const DEFAULT_VOLUME = 'ZZ';
const DEFAULT_LEVEL = 'ZZ';

// Pad a numeric or numeric-like string to the canonical 4 digits.
const padSeq = (seq: string | number | undefined): string => {
  if (seq === undefined || seq === null || seq === '') return '0001';
  const n =
    typeof seq === 'number' ? seq : parseInt(String(seq).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n) || n < 0) return '0001';
  return String(n).padStart(4, '0');
};

// Sanitize a free-form code field into the alphanumeric upper-case form
// the standard expects. Non-alphanumerics collapse to nothing.
const sanitize = (s: string | undefined, fallback: string): string => {
  if (!s) return fallback;
  const cleaned = s
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned || fallback;
};

// Build a complete drawing number from a SheetMeta. Missing optional
// parts fall back to safe defaults so a half-populated sheet still gets
// a syntactically-valid number.
export const assembleDrawingNumber = (parts: Partial<SheetMeta>): string => {
  const proj = sanitize(parts.projectCode, 'PRJ');
  const orig = sanitize(parts.originator, 'ZZZ');
  const vol = sanitize(parts.volume, DEFAULT_VOLUME);
  const lvl = sanitize(parts.level, DEFAULT_LEVEL);
  const type = sanitize(parts.type, 'DR');
  const disc = sanitize(parts.discipline, 'E');
  const seq = padSeq(parts.sequenceNumber);
  return `${proj}-${orig}-${vol}-${lvl}-${type}-${disc}-${seq}`;
};

// Best-effort parse — returns whichever fields could be recovered.
// Tolerant of extra trailing tokens (treated as part of sequence) and
// of any case in the input.
export const parseDrawingNumber = (num: string): Partial<SheetMeta> => {
  if (!num) return {};
  const tokens = num.toUpperCase().trim().split('-');
  if (tokens.length < 2) return { drawingNumber: num };
  const out: Partial<SheetMeta> = { drawingNumber: num };
  if (tokens[0]) out.projectCode = tokens[0];
  if (tokens[1]) out.originator = tokens[1];
  if (tokens[2]) out.volume = tokens[2];
  if (tokens[3]) out.level = tokens[3];
  if (tokens[4]) out.type = tokens[4];
  if (tokens[5]) out.discipline = tokens[5];
  if (tokens[6]) {
    // Anything after the 6th hyphen is treated as the sequence so a
    // suffix like "-A" or "-REVA" doesn't break the parse.
    out.sequenceNumber = tokens.slice(6).join('-');
  }
  return out;
};

// Validate the canonical 7-field shape. Returns ok=true with no reason
// when the number conforms.
export const validateDrawingNumber = (
  num: string,
): { ok: boolean; reason?: string } => {
  if (!num || typeof num !== 'string') {
    return { ok: false, reason: 'Drawing number is empty' };
  }
  const tokens = num.trim().split('-');
  if (tokens.length !== 7) {
    return {
      ok: false,
      reason: `Expected 7 fields separated by '-', got ${tokens.length}`,
    };
  }
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) {
      return { ok: false, reason: `Field ${i + 1} is empty` };
    }
    if (!/^[A-Za-z0-9]+$/.test(tokens[i])) {
      return {
        ok: false,
        reason: `Field ${i + 1} '${tokens[i]}' contains non-alphanumeric characters`,
      };
    }
  }
  const disc = tokens[5].toUpperCase() as DisciplineCode;
  if (!(DISCIPLINES as readonly string[]).includes(disc)) {
    return { ok: false, reason: `Unknown discipline '${disc}'` };
  }
  const type = tokens[4].toUpperCase() as DocTypeCode;
  if (!(DOC_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: `Unknown document type '${type}'` };
  }
  if (!/^\d{1,6}$/.test(tokens[6])) {
    return { ok: false, reason: `Sequence '${tokens[6]}' must be numeric` };
  }
  return { ok: true };
};

// Find the next free sequence number for the given (discipline, type,
// volume, level) tuple by scanning every sheet's stored meta. Returns a
// 4-digit zero-padded string. Volume/level default to "ZZ" so a project
// with no level breakdown still gets coherent numbering.
export const nextSequenceNumber = (
  project: Project,
  discipline: string,
  type: string,
  volume: string = DEFAULT_VOLUME,
  level: string = DEFAULT_LEVEL,
): string => {
  const targetDisc = sanitize(discipline, 'E');
  const targetType = sanitize(type, 'DR');
  const targetVol = sanitize(volume, DEFAULT_VOLUME);
  const targetLvl = sanitize(level, DEFAULT_LEVEL);

  let max = 0;
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    const meta = sheet?.meta;
    if (!meta) continue;
    // Try the structured fields first; fall back to parsing the assembled
    // string if the components weren't stored separately.
    const parts = meta.drawingNumber
      ? { ...parseDrawingNumber(meta.drawingNumber), ...meta }
      : meta;
    const d = sanitize(parts.discipline, '');
    const t = sanitize(parts.type, '');
    const v = sanitize(parts.volume, DEFAULT_VOLUME);
    const l = sanitize(parts.level, DEFAULT_LEVEL);
    if (
      d !== targetDisc ||
      t !== targetType ||
      v !== targetVol ||
      l !== targetLvl
    ) {
      continue;
    }
    const seqStr = parts.sequenceNumber;
    if (!seqStr) continue;
    const n = parseInt(String(seqStr).replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return padSeq(max + 1);
};
