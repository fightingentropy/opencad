// COBie (Construction Operations Building Information Exchange).
// We export the core sheets as CSV so a facilities manager can import them
// into a CAFM/CMMS without needing a true .xlsx writer.

import type { Project } from '../types';

const csv = (rows: unknown[][]): string =>
  rows.map((r) =>
    r.map((v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(','),
  ).join('\n');

export const exportCOBie = (project: Project): { sheets: Record<string, string[][]> } => {
  const sheets: Record<string, string[][]> = {};

  // Facility (one row per project)
  sheets.Facility = [
    ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'ProjectName', 'SiteName', 'LinearUnits', 'AreaUnits', 'VolumeUnits', 'CurrencyUnit', 'AreaMeasurement', 'ExternalSystem', 'ExternalProjectObject', 'ExternalProjectIdentifier', 'ExternalSiteObject', 'ExternalSiteIdentifier', 'ExternalFacilityObject', 'ExternalFacilityIdentifier', 'Description', 'ProjectDescription', 'SiteDescription', 'Phase'],
    [project.name, project.engineer ?? 'OpenCAD', new Date(project.created).toISOString(), 'Office', project.name, 'Site', 'millimeters', 'square millimeters', 'cubic millimeters', 'GBP', 'External', 'OpenCAD', 'Project', project.id, 'Site', 'site-1', 'Facility', 'facility-1', project.description ?? '', '', '', 'design'],
  ];

  // Floor (one row per Floor)
  const floorRows: string[][] = [
    ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'ExternalSystem', 'ExternalObject', 'ExternalIdentifier', 'Description', 'Elevation', 'Height'],
  ];
  for (const id of Object.keys(project.floors ?? {})) {
    const f = project.floors![id];
    floorRows.push([
      f.name,
      project.engineer ?? 'OpenCAD',
      new Date(project.modified).toISOString(),
      'Floor',
      'OpenCAD',
      'Floor',
      f.id,
      `Level ${f.level}`,
      String(f.ffl),
      String(f.floorHeight),
    ]);
  }
  sheets.Floor = floorRows;

  // Space (one row per Zone or Room)
  const spaceRows: string[][] = [
    ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'FloorName', 'Description', 'ExternalSystem', 'ExternalObject', 'ExternalIdentifier', 'RoomTag', 'UsableHeight', 'GrossArea', 'NetArea'],
  ];
  for (const zid of Object.keys(project.zones ?? {})) {
    const z = project.zones![zid];
    const f = project.floors?.[z.floorId];
    spaceRows.push([
      z.name,
      project.engineer ?? 'OpenCAD',
      new Date(project.modified).toISOString(),
      z.classification,
      f?.name ?? '',
      z.classification,
      'OpenCAD',
      'Space',
      z.id,
      z.name,
      String(f?.floorHeight ?? 3000),
      '',
      '',
    ]);
  }
  sheets.Space = spaceRows;

  // Zone (one row per ElectricalSystem)
  const zoneRows: string[][] = [
    ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'SpaceNames', 'ExternalSystem', 'ExternalObject', 'ExternalIdentifier', 'Description'],
  ];
  for (const sid of Object.keys(project.systems ?? {})) {
    const s = project.systems![sid];
    zoneRows.push([
      s.name,
      project.engineer ?? 'OpenCAD',
      new Date(project.modified).toISOString(),
      s.kind,
      '',
      'OpenCAD',
      'Zone',
      s.id,
      s.description ?? s.name,
    ]);
  }
  sheets.Zone = zoneRows;

  // Component (one row per Equipment entity)
  const compRows: string[][] = [
    ['Name', 'CreatedBy', 'CreatedOn', 'TypeName', 'Space', 'Description', 'ExternalSystem', 'ExternalObject', 'ExternalIdentifier', 'SerialNumber', 'InstallationDate', 'WarrantyStartDate', 'TagNumber', 'BarCode', 'AssetIdentifier'],
  ];
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (!e || e.kind !== 'equipment') continue;
      compRows.push([
        e.tag,
        project.engineer ?? 'OpenCAD',
        new Date(project.modified).toISOString(),
        e.equipmentKind,
        sheet.name,
        e.description ?? '',
        'OpenCAD',
        'Component',
        e.id,
        '',
        '',
        '',
        e.tag,
        '',
        e.id,
      ]);
    }
  }
  sheets.Component = compRows;

  // Type (one row per distinct equipment kind / manufacturer combo)
  const typeKeys = new Set<string>();
  const typeRows: string[][] = [
    ['Name', 'CreatedBy', 'CreatedOn', 'Category', 'Description', 'AssetType', 'Manufacturer', 'ModelNumber', 'WarrantyGuarantorParts', 'WarrantyDurationParts', 'WarrantyGuarantorLabor', 'WarrantyDurationLabor', 'WarrantyDurationUnit', 'ExternalSystem', 'ExternalObject', 'ExternalIdentifier', 'ReplacementCost', 'ExpectedLife', 'DurationUnit', 'NominalLength', 'NominalWidth', 'NominalHeight', 'ModelReference', 'Shape', 'Size', 'Color', 'Finish', 'Grade', 'Material', 'Constituents', 'Features', 'AccessibilityPerformance', 'CodePerformance', 'SustainabilityPerformance'],
  ];
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (!e || e.kind !== 'equipment') continue;
      const key = `${e.equipmentKind}::${e.manufacturer ?? ''}::${e.partNumber ?? ''}`;
      if (typeKeys.has(key)) continue;
      typeKeys.add(key);
      typeRows.push([
        `${e.equipmentKind}-${e.manufacturer ?? 'generic'}-${e.partNumber ?? '0'}`,
        project.engineer ?? 'OpenCAD',
        new Date(project.modified).toISOString(),
        e.equipmentKind,
        e.description ?? '',
        'Fixed',
        e.manufacturer ?? 'Generic',
        e.partNumber ?? '',
        '', '', '', '', 'years',
        'OpenCAD',
        'Type',
        key,
        '', '', 'years',
        '', '', '',
        '', '', '', '', '', '',
        '', '',
        '', '', '', '',
      ]);
    }
  }
  sheets.Type = typeRows;

  return { sheets };
};

export const cobieToCSVZipText = (sheets: Record<string, string[][]>): string => {
  // Concatenated CSV bundle with sheet headers.
  const parts: string[] = [];
  for (const [name, rows] of Object.entries(sheets)) {
    parts.push(`### COBie Sheet: ${name}`);
    parts.push(csv(rows));
    parts.push('');
  }
  return parts.join('\n');
};

// Convenience wrapper accepting either the bare record or the wrapper
// returned from `exportCOBie` — matches the spec name `cobieToCSVZip`.
export const cobieToCSVZip = (
  input: Record<string, string[][]> | { sheets: Record<string, string[][]> },
): string => {
  const rec: Record<string, string[][]> =
    'sheets' in input
      ? (input as { sheets: Record<string, string[][]> }).sheets
      : (input as Record<string, string[][]>);
  return cobieToCSVZipText(rec);
};
