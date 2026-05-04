// Containment schedule — one row per containment route in the project.
// This complements the BOM: where the BOM aggregates by part number,
// the schedule is run-by-run (so a fitter can find C-101 on the
// drawing and read off length, size and fill % at a glance).

import type { Project, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import { dist } from '../lib/math';
import { FILL_LIMITS } from '../models/standards';

export interface ContainmentScheduleRow {
  ref: string;
  type: string;
  subType: string;
  size: string;
  material: string;
  length: number; // m
  elevation: number; // mm
  system: string;
  fillPct: number;
  cableCount: number;
  manufacturer: string;
  partNumber: string;
  sheet: string;
}

const csvEsc = (v: unknown): string => {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const sizeLabel = (c: ContainmentEntity): string => {
  if (c.containmentType === 'conduit') return c.width ? `${c.width} mm Ø` : '';
  if (c.width && c.height) return `${c.width} × ${c.height} mm`;
  if (c.width) return `${c.width} mm`;
  return '';
};

const innerCsa = (c: ContainmentEntity): number => {
  if (c.innerCsaMm2 && c.innerCsaMm2 > 0) return c.innerCsaMm2;
  if (c.containmentType === 'conduit' && c.width) {
    // Round conduit area, take 80% to allow for wall thickness if not given
    return Math.PI * (c.width / 2) ** 2 * 0.8;
  }
  if (c.width && c.height) {
    return c.width * c.height * 0.85;
  }
  return 0;
};

const cablesInContainment = (
  project: Project,
  containmentId: string,
): Cable[] => {
  const sched = project.cableSchedule;
  if (!sched) return [];
  const out: Cable[] = [];
  for (const id of sched.cableOrder) {
    const c = sched.cables[id];
    if (c && c.route.includes(containmentId)) out.push(c);
  }
  return out;
};

const fillLimitFor = (project: Project, c: ContainmentEntity): number => {
  const code = project.standardsProfile?.code ?? 'BS7671';
  const limits = FILL_LIMITS[code];
  switch (c.containmentType) {
    case 'trunking':
      return limits.trunking;
    case 'conduit':
      return limits.conduit;
    case 'tray':
      return limits.cableTray;
    case 'ladder':
      return limits.cableLadder;
    case 'basket':
      return limits.cableBasket;
    default:
      return 1.0;
  }
};

const routeLengthMm = (c: ContainmentEntity): number => {
  if (!c.points || c.points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < c.points.length; i++) {
    total += dist(c.points[i - 1], c.points[i]);
  }
  return total;
};

const systemName = (project: Project, systemId?: string): string => {
  if (!systemId) return '';
  return project.systems?.[systemId]?.name ?? systemId;
};

export const exportContainmentSchedule = (
  project: Project,
): ContainmentScheduleRow[] => {
  const rows: ContainmentScheduleRow[] = [];
  let auto = 1;
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e || e.kind !== 'containment') continue;
      const c = e as ContainmentEntity;
      const cables = cablesInContainment(project, c.id);
      const occupied = cables.reduce(
        (sum, cab) => sum + Math.PI * (cab.outerDiameter / 2) ** 2,
        0,
      );
      const csa = innerCsa(c);
      const fillRaw = csa > 0 ? occupied / csa : 0;
      const limit = fillLimitFor(project, c);
      const fillPct = +(fillRaw * 100).toFixed(1);
      rows.push({
        ref: c.label ?? `CT-${String(auto++).padStart(3, '0')}`,
        type: c.containmentType,
        subType: c.subType ?? '',
        size: sizeLabel(c),
        material: c.material ?? '',
        length: +(routeLengthMm(c) / 1000).toFixed(2),
        elevation: c.elevation ?? 0,
        system: systemName(project, c.systemId),
        fillPct,
        cableCount: cables.length,
        manufacturer: c.manufacturer ?? '',
        partNumber: c.catalogPartNumber ?? '',
        sheet: sheet.number,
      });
      // Note: fill limit only used to derive a status flag for reports
      // that consume this schedule; we keep the raw fillPct here so
      // downstream code can compare against any standard.
      void limit;
    }
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
};

export const containmentScheduleToCSV = (
  rows: ContainmentScheduleRow[],
): string => {
  const header = [
    'Ref',
    'Type',
    'SubType',
    'Size',
    'Material',
    'Length (m)',
    'Elevation (mm)',
    'System',
    'Fill (%)',
    'Cables',
    'Manufacturer',
    'PartNumber',
    'Sheet',
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.ref,
      r.type,
      r.subType,
      r.size,
      r.material,
      r.length.toFixed(2),
      r.elevation,
      r.system,
      r.fillPct.toFixed(1),
      r.cableCount,
      r.manufacturer,
      r.partNumber,
      r.sheet,
    ]
      .map(csvEsc)
      .join(','),
  );
  return [header, ...lines].join('\n');
};
