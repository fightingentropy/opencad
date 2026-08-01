import { describe, expect, it } from 'vitest';
import type { Project, Sheet } from '../../types';
import type { Cable } from '../../models/cable';
import { DEFAULT_STANDARDS } from '../../models/standards';
import { exportProjectJSON } from '../project';
import { exportSheetSVG } from '../svg';
import { exportIFC } from '../ifc-export';
import { complianceReportToPDF, generateComplianceReport } from '../compliance-report';
import { bomToCSV } from '../bom';
import { containmentBOMToCSV } from '../containment-bom';
import { cableScheduleToCSV, cableScheduleToPDF } from '../cable-schedule-export';
import { containmentScheduleToCSV } from '../containment-schedule';
import { bomToCSVExtended, cablesFromCSV, cablesToCSV } from '../xlsx';
import { costEstimateToCSV, costEstimateToHTML, generateCostEstimate } from '../cost-estimate';
import { exportCOBie, cobieToCSVZip } from '../cobie';
import { fireStopScheduleToCSV, fireStopScheduleToPDF } from '../fire-stop-schedule';
import { cablePullCardsToText } from '../cable-pull-cards';

const projectFixture = (): Project => {
  const sheet: Sheet = {
    id: 'sheet-1',
    name: 'Metadata',
    number: 'M-001',
    kind: 'floor-plan',
    width: 420,
    height: 297,
    entities: {},
    entityOrder: [],
  };
  return {
    id: 'metadata-project',
    name: 'Metadata Project',
    created: 1,
    modified: 2,
    layers: {},
    layerOrder: [],
    sheets: { [sheet.id]: sheet },
    sheetOrder: [sheet.id],
    activeSheetId: sheet.id,
    activeLayerId: 'layer-1',
    units: 'mm',
    coordinateReferenceSystem: 'EPSG:27700',
    standard: 'IEC',
    standardsProfile: DEFAULT_STANDARDS.BS7671,
  };
};

describe('export provenance metadata', () => {
  it('embeds units, CRS and exact standards version/hash in project JSON and SVG', () => {
    const project = projectFixture();
    const json = JSON.parse(exportProjectJSON(project));
    expect(json.metadata).toMatchObject({
      units: 'mm',
      coordinateReferenceSystem: 'EPSG:27700',
      standards: {
        code: 'BS7671',
        profileVersion: DEFAULT_STANDARDS.BS7671.profileVersion,
        datasetHash: DEFAULT_STANDARDS.BS7671.datasetHash,
      },
    });
    const svg = exportSheetSVG(project);
    expect(svg).toContain('opencad-export-metadata');
    expect(svg).toContain(DEFAULT_STANDARDS.BS7671.profileVersion);
    expect(svg).toContain(DEFAULT_STANDARDS.BS7671.datasetHash);
    expect(svg).toContain('EPSG:27700');
  });

  it('embeds the same trace in IFC and compliance reports', () => {
    const project = projectFixture();
    const ifc = exportIFC(project);
    expect(ifc).toContain('OPENCAD_EXPORT_METADATA');
    expect(ifc).toContain(DEFAULT_STANDARDS.BS7671.datasetHash);
    const report = generateComplianceReport(project);
    expect(report.standards.profileVersion).toBe(DEFAULT_STANDARDS.BS7671.profileVersion);
    expect(report.metadata.coordinateReferenceSystem).toBe('EPSG:27700');
  });

  it('prepends reproducibility metadata to every tabular CSV export', () => {
    const project = projectFixture();
    const cable: Cable = {
      id: 'cable-1',
      reference: 'C-001',
      from: 'DB-1',
      to: 'L-1',
      circuitType: 'power',
      construction: 'PVC/PVC',
      cores: 2,
      csa: 2.5,
      hasEarth: true,
      outerDiameter: 10,
      voltage: 230,
      route: [],
    };
    const estimate = generateCostEstimate(project);
    const exports = [
      bomToCSV([], project),
      containmentBOMToCSV([], project),
      cableScheduleToCSV([], project),
      containmentScheduleToCSV([], project),
      cablesToCSV([cable], project),
      bomToCSVExtended([], project),
      costEstimateToCSV(estimate, project),
      fireStopScheduleToCSV([], project),
    ];

    for (const csv of exports) {
      expect(csv).toContain('# Units,mm');
      expect(csv).toContain('# Coordinate Reference System,EPSG:27700');
      expect(csv).toContain(
        `# Standards Profile,BS7671@${DEFAULT_STANDARDS.BS7671.profileVersion}`,
      );
      expect(csv).toContain(
        `# Standards Dataset Hash,${DEFAULT_STANDARDS.BS7671.datasetHash}`,
      );
    }

    const roundTrip = cablesFromCSV(cablesToCSV([cable], project));
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.cables).toHaveLength(1);
    expect(roundTrip.cables[0].reference).toBe(cable.reference);
  });

  it('embeds metadata in COBie, HTML and text artifacts', () => {
    const project = projectFixture();
    const estimate = generateCostEstimate(project);
    const artifacts = [
      cobieToCSVZip(exportCOBie(project)),
      costEstimateToHTML(estimate, project),
      cablePullCardsToText([], project),
    ];

    for (const artifact of artifacts) {
      expect(artifact).toContain('EPSG:27700');
      expect(artifact).toContain(DEFAULT_STANDARDS.BS7671.profileVersion);
      expect(artifact).toContain(DEFAULT_STANDARDS.BS7671.datasetHash);
    }
  });

  it('renders metadata-bearing PDFs with the upgraded jsPDF runtime', async () => {
    const project = projectFixture();
    const report = generateComplianceReport(project);
    const pdf = await complianceReportToPDF(report);
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.size).toBeGreaterThan(1_000);

    const schedulePdf = await cableScheduleToPDF([], project);
    expect(schedulePdf.type).toBe('application/pdf');
    expect(schedulePdf.size).toBeGreaterThan(1_000);

    const fireStopPdf = await fireStopScheduleToPDF([], project);
    expect(fireStopPdf.type).toBe('application/pdf');
    expect(fireStopPdf.size).toBeGreaterThan(1_000);
  });
});
