import type { Project } from '../types';
import { createStandardsTrace, type StandardsTrace } from '../models/standards';

export interface ExportMetadata {
  schema: 'opencad.export-metadata.v1';
  artifact: string;
  generatedAt: string;
  projectId: string;
  projectModifiedAt: string;
  units: Project['units'];
  coordinateReferenceSystem: string;
  standards: StandardsTrace;
}

export const buildExportMetadata = (
  project: Project,
  artifact: string,
): ExportMetadata => ({
  schema: 'opencad.export-metadata.v1',
  artifact,
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  projectModifiedAt: new Date(project.modified).toISOString(),
  units: project.units,
  coordinateReferenceSystem: project.coordinateReferenceSystem ?? 'LOCAL-CARTESIAN-2D',
  standards: createStandardsTrace(project.standardsProfile),
});

export const exportMetadataSummary = (metadata: ExportMetadata): string =>
  [
    `units=${metadata.units}`,
    `crs=${metadata.coordinateReferenceSystem}`,
    `standards=${metadata.standards.code}@${metadata.standards.profileVersion}`,
    `hash=${metadata.standards.datasetHash}`,
  ].join('; ');

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

/**
 * A comment-style preamble that keeps ordinary exports human-readable while
 * carrying the exact project context needed to reproduce engineering results.
 * Importers maintained by OpenCAD ignore rows whose first non-space character
 * is `#`.
 */
export const csvExportMetadataPreamble = (
  project: Project,
  artifact: string,
): string => {
  const metadata = buildExportMetadata(project, artifact);
  const rows: unknown[][] = [
    ['# OpenCAD Export Metadata', metadata.schema],
    ['# Artifact', metadata.artifact],
    ['# Generated At', metadata.generatedAt],
    ['# Project ID', metadata.projectId],
    ['# Project Modified At', metadata.projectModifiedAt],
    ['# Units', metadata.units],
    ['# Coordinate Reference System', metadata.coordinateReferenceSystem],
    [
      '# Standards Profile',
      `${metadata.standards.code}@${metadata.standards.profileVersion}`,
    ],
    ['# Standards Dataset Hash', metadata.standards.datasetHash],
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
};

export const prependCSVExportMetadata = (
  csv: string,
  project: Project,
  artifact: string,
): string => `${csvExportMetadataPreamble(project, artifact)}\n${csv}`;

export const textExportMetadataPreamble = (
  project: Project,
  artifact: string,
): string => {
  const metadata = buildExportMetadata(project, artifact);
  return [
    'OPENCAD EXPORT METADATA',
    `Schema: ${metadata.schema}`,
    `Artifact: ${metadata.artifact}`,
    `Generated at: ${metadata.generatedAt}`,
    `Project ID: ${metadata.projectId}`,
    `Project modified at: ${metadata.projectModifiedAt}`,
    `Units: ${metadata.units}`,
    `Coordinate reference system: ${metadata.coordinateReferenceSystem}`,
    `Standards profile: ${metadata.standards.code}@${metadata.standards.profileVersion}`,
    `Standards dataset hash: ${metadata.standards.datasetHash}`,
    'END OPENCAD EXPORT METADATA',
  ].join('\n');
};
