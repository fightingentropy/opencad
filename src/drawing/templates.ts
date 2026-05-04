// Pre-built sheet templates. Each helper returns a fully-formed Sheet
// sized to the requested paper, with a SheetMeta seeded for the BS EN
// ISO 19650 numbering scheme. Callers add the result to project.sheets
// + project.sheetOrder. Entities are intentionally left empty — the
// renderer paints the title block from sheet.meta on top of the sheet
// background, and view-generators populate the entities map.

import { nanoid } from 'nanoid';
import type { Sheet, SheetId } from '../types';
import type { Building, Floor, Site } from '../models/site';
import type { SheetMeta } from '../models/revision';
import { PAPER_SIZES, type PaperSize } from './title-block';

// Sheet IDs are short nanoids — the rest of the app relies on stable
// 10-char IDs so undo / structuredClone behave predictably.
const newSheetId = (): SheetId => nanoid(10);

// Common base for every template — any template-specific overrides
// merge on top.
const baseSheet = (
  name: string,
  number: string,
  paperSize: PaperSize,
  meta: Partial<SheetMeta>,
): Sheet => {
  const dims = PAPER_SIZES[paperSize];
  return {
    id: newSheetId(),
    name,
    number,
    kind: 'panel-layout', // overridden per template below
    width: dims.width,
    height: dims.height,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
    meta: {
      paperSize,
      title: name,
      type: 'DR',
      ...meta,
    },
  };
};

// --- Floor Plan -----------------------------------------------------------
//
// One sheet per floor of a building. Building/floor IDs go onto the sheet
// so 3D and riser-diagram views can pivot off them. Sheet number defaults
// to a level-derived three-digit code (e.g. ground = "100").
export const createFloorPlanSheet = (
  name: string,
  building: Building,
  floor: Floor,
  paperSize: PaperSize = 'A1',
): Sheet => {
  // Level number for the BS EN ISO 19650 "Level" field — two-digit signed
  // string. Ground = "00", upper = "01..", basement = "B1..".
  const levelCode =
    floor.level >= 0
      ? String(floor.level).padStart(2, '0')
      : `B${String(Math.abs(floor.level))}`;

  // Sheet number convention: 100 + level offset → "100", "101", ...
  const sheetNumber = `${100 + floor.level * 10}`;

  const sheet = baseSheet(name, sheetNumber, paperSize, {
    title: name,
    subtitle: building.name,
    scale: '1:50',
    level: levelCode,
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'floor-plan';
  sheet.sceneStyle = 'building';
  sheet.buildingId = building.id;
  sheet.floorId = floor.id;
  return sheet;
};

// --- Site Plan ------------------------------------------------------------
//
// The whole-site overview drawing. Volume = "ZZ" (applies everywhere) and
// level = "ZZ" (no specific floor) per the standard's placeholders.
export const createSitePlanSheet = (
  name: string,
  site: Site,
  paperSize: PaperSize = 'A1',
): Sheet => {
  const sheet = baseSheet(name, '001', paperSize, {
    title: name,
    subtitle: site.name,
    scale: '1:200',
    volume: 'ZZ',
    level: 'ZZ',
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'site-plan';
  sheet.sceneStyle = 'site';
  return sheet;
};

// --- Cross Section --------------------------------------------------------
//
// A vertical cut through the building. ref is the section marker label
// (e.g. "A-A") which is reflected in the sheet number / title.
export const createCrossSectionSheet = (
  name: string,
  ref: string,
  paperSize: PaperSize = 'A1',
): Sheet => {
  const sheet = baseSheet(name, `200-${ref}`, paperSize, {
    title: name,
    subtitle: `Section ${ref}`,
    scale: '1:50',
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'cross-section';
  return sheet;
};

// --- Elevation ------------------------------------------------------------
//
// Looking horizontally at a wall or facade. ref typically encodes the
// view direction or wall name (e.g. "North", "Wall-A").
export const createElevationSheet = (
  name: string,
  ref: string,
  paperSize: PaperSize = 'A1',
): Sheet => {
  const sheet = baseSheet(name, `300-${ref}`, paperSize, {
    title: name,
    subtitle: `Elevation ${ref}`,
    scale: '1:50',
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'elevation';
  return sheet;
};

// --- Riser Diagram --------------------------------------------------------
//
// Schematic of vertical distribution — never to scale, so the descriptive
// scale is set to "NTS" by convention.
export const createRiserDiagramSheet = (
  name: string,
  paperSize: PaperSize = 'A1',
): Sheet => {
  const sheet = baseSheet(name, '400', paperSize, {
    title: name,
    subtitle: 'Riser Diagram',
    scale: 'NTS',
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'riser-diagram';
  return sheet;
};

// --- Detail ---------------------------------------------------------------
//
// Auto-generated installation details. Defaults to A3 because most
// detail bundles ship at smaller paper.
export const createDetailSheet = (
  name: string,
  ref: string,
  paperSize: PaperSize = 'A3',
): Sheet => {
  const sheet = baseSheet(name, `500-${ref}`, paperSize, {
    title: name,
    subtitle: `Detail ${ref}`,
    scale: '1:5',
    discipline: 'E',
    type: 'DR',
  });
  sheet.kind = 'detail';
  return sheet;
};

// --- Cable Schedule -------------------------------------------------------
//
// A tabular drawing — A3 portrait fits a typical cable schedule layout.
export const createCableScheduleSheet = (
  name: string = 'Cable Schedule',
  paperSize: PaperSize = 'A3',
): Sheet => {
  const sheet = baseSheet(name, '600', paperSize, {
    title: name,
    scale: 'NTS',
    discipline: 'E',
    type: 'SH',
  });
  sheet.kind = 'cable-schedule';
  return sheet;
};
