// Containment schedule — one row per containment route in the project.
// This complements the BOM: where the BOM aggregates by part number,
// the schedule is run-by-run (so a fitter can find C-101 on the
// drawing and read off length, size and fill % at a glance).

import type { Project, ContainmentEntity } from '../types';
import type { Cable } from '../models/cable';
import { routeLength } from '../lib/route-path';
import { DEFAULT_STANDARDS } from '../models/standards';
import { computeContainmentFill, type FillStatus } from '../calc/fill';
import { prependCSVExportMetadata } from './export-metadata';

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
  fillStatus: FillStatus;
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

const systemName = (project: Project, systemId?: string): string => {
  if (!systemId) return '';
  return project.systems?.[systemId]?.name ?? systemId;
};

export const exportContainmentSchedule = (
  project: Project,
): ContainmentScheduleRow[] => {
  const rows: ContainmentScheduleRow[] = [];
  const standards = project.standardsProfile ?? DEFAULT_STANDARDS.BS7671;
  let auto = 1;
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e || e.kind !== 'containment') continue;
      const c = e as ContainmentEntity;
      const cables = cablesInContainment(project, c.id);
      // Same model as the dashboard and 3D overlay, so the figures agree.
      const fill = computeContainmentFill(c, cables, standards);
      const fillPct = +fill.fillPct.toFixed(1);
      rows.push({
        ref: c.label ?? `CT-${String(auto++).padStart(3, '0')}`,
        type: c.containmentType,
        subType: c.subType ?? '',
        size: sizeLabel(c),
        material: c.material ?? '',
        length: +(routeLength(c, project.floors?.[sheet.floorId ?? '']) / 1000).toFixed(2),
        elevation: c.elevation ?? 0,
        system: systemName(project, c.systemId),
        fillPct,
        fillStatus: fill.fillStatus,
        cableCount: cables.length,
        manufacturer: c.manufacturer ?? '',
        partNumber: c.catalogPartNumber ?? '',
        sheet: sheet.number,
      });
    }
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
};

export const containmentScheduleToCSV = (
  rows: ContainmentScheduleRow[],
  project: Project,
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
    'Fill status',
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
      r.fillStatus,
      r.cableCount,
      r.manufacturer,
      r.partNumber,
      r.sheet,
    ]
      .map(csvEsc)
      .join(','),
  );
  return prependCSVExportMetadata(
    [header, ...lines].join('\n'),
    project,
    'containment-schedule-csv',
  );
};
