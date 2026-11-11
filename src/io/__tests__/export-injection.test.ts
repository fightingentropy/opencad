import { describe, expect, it } from 'vitest';
import { exportSheetSVG } from '../svg';
import { exportCOBie, cobieToCSVZipText } from '../cobie';
import { bomToCSVExtended } from '../xlsx';
import { createEmptyProject } from '../../state/store';
import type { Entity } from '../../types';

describe('SVG numeric attributes', () => {
  it('writes a non-numeric line width or coordinate as a plain number', () => {
    const project = createEmptyProject();
    const sheet = project.sheets[project.activeSheetId];
    const evil = {
      id: 'e1', layerId: project.activeLayerId, visible: true, locked: false,
      kind: 'line', a: { x: '1" onload="alert(1)', y: 0 }, b: { x: 5, y: 5 },
      lineWidth: '2" onload="alert(1)',
    } as unknown as Entity;
    sheet.entities[evil.id] = evil;
    sheet.entityOrder.push(evil.id);
    const svg = exportSheetSVG(project);
    expect(svg).not.toContain('onload');
    expect(svg).toContain('stroke-width="0"');
  });
});

describe('CSV formula neutralisation in remaining exports', () => {
  it('neutralises COBie cells', () => {
    const project = createEmptyProject();
    project.name = '=HYPERLINK("x")';
    const text = cobieToCSVZipText(exportCOBie(project).sheets);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('neutralises extended BOM cells', () => {
    const csv = bomToCSVExtended(
      [{ tag: '=1+1', name: 'n', description: '', manufacturer: '', partNumber: '', rating: '', quantity: 1, category: 'c', sheetNumbers: [1] } as never],
      createEmptyProject(),
    );
    expect(csv).toContain("'=1+1");
  });
});

describe('cable CSV round trip with neutralised cells', () => {
  it('restores identifiers that start with a formula character on re-import', async () => {
    const { cablesToCSV, cablesFromCSV, tabSeparated } = await import('../xlsx');
    const cable = {
      id: 'c1', reference: '-W1', from: '-F1', to: '-Q3', circuitType: 'power',
      construction: 'XLPE/SWA/LSOH', cores: 3, csa: 2.5, hasEarth: true,
      outerDiameter: 10, voltage: 230, route: [], notes: '=1+1',
    } as never;
    const csv = cablesToCSV([cable], createEmptyProject());
    expect(csv).toContain("'-F1");
    const back = cablesFromCSV(csv).cables[0];
    expect(back.reference).toBe('-W1');
    expect(back.from).toBe('-F1');
    expect(back.to).toBe('-Q3');
    expect(back.notes).toBe('=1+1');
    expect(tabSeparated([['=1+1', '5']])).toBe("'=1+1\t5");
  });

  it('keeps numeric strings in SVG coordinates', () => {
    const project = createEmptyProject();
    const sheet = project.sheets[project.activeSheetId];
    const e = {
      id: 'e2', layerId: project.activeLayerId, visible: true, locked: false,
      kind: 'line', a: { x: '5', y: 0 }, b: { x: 7, y: 7 },
    } as unknown as Entity;
    sheet.entities[e.id] = e;
    sheet.entityOrder.push(e.id);
    expect(exportSheetSVG(project)).toContain('x1="5"');
  });
});
