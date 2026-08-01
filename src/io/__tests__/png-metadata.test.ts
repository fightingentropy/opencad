import { describe, expect, it } from 'vitest';
import { embedPngExportMetadata } from '../png-metadata';
import type { ExportMetadata } from '../export-metadata';

const ONE_PIXEL_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
), (char) => char.charCodeAt(0));

describe('PNG export metadata', () => {
  it('adds an uncompressed UTF-8 iTXt chunk before IEND', async () => {
    const metadata = {
      schema: 'opencad.export-metadata.v1',
      artifact: 'sheet-png',
      generatedAt: '2026-08-01T00:00:00.000Z',
      projectId: 'golden',
      projectModifiedAt: '2026-08-01T00:00:00.000Z',
      units: 'mm',
      coordinateReferenceSystem: 'LOCAL-CARTESIAN-2D',
      standards: {
        code: 'BS7671',
        jurisdiction: 'United Kingdom',
        documentId: 'BS 7671:2018+A2:2022',
        edition: '18th Edition',
        amendments: ['Amendment 2 (2022)'],
        effectiveDate: '2022-09-28',
        unitSystem: 'SI',
        profileVersion: 'bs7671-a2.1',
        datasetHash: 'sha256:test',
        implementationStatus: 'reference-snapshot',
        sources: [],
      },
    } satisfies ExportMetadata;
    const result = await embedPngExportMetadata(
      new Blob([ONE_PIXEL_PNG], { type: 'image/png' }),
      metadata,
    );
    const text = new TextDecoder().decode(await result.arrayBuffer());
    expect(text).toContain('iTXtOpenCAD.Metadata');
    expect(text).toContain('opencad.export-metadata.v1');
    expect(text).toContain('bs7671-a2.1');
  });
});
