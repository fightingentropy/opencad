import { describe, expect, it } from 'vitest';
import { fitViewportToSheet } from '../fit';
import { MIN_ZOOM, zoomAtPoint } from '../viewport';
import { createEmptyProject } from '../../state/store';
import type { LineEntity, Sheet } from '../../types';

const sheetWithLine = (b: { x: number; y: number }): Sheet => {
  const project = createEmptyProject();
  const sheet = project.sheets[project.activeSheetId];
  const line: LineEntity = {
    id: 'l1', kind: 'line', layerId: project.activeLayerId, visible: true, locked: false,
    a: { x: 0, y: 0 }, b,
  };
  return { ...sheet, entities: { l1: line }, entityOrder: ['l1'] };
};

describe('2D zoom range', () => {
  it('fits a building-scale plan entirely on screen', () => {
    // A 60 m × 40 m floor in a 600 × 400 px canvas with 30 px padding.
    const v = fitViewportToSheet(sheetWithLine({ x: 60000, y: 40000 }), 600, 400);
    expect(v.zoom).toBeCloseTo(340 / 40000, 6);
    expect(60000 * v.zoom).toBeLessThanOrEqual(540);
    expect(v).toMatchObject({ x: 30000, y: 20000 });
  });

  it('stops zooming out at the minimum', () => {
    const v = zoomAtPoint({ x: 0, y: 0, zoom: MIN_ZOOM * 1.5 }, { x: 0, y: 0 }, 800, 600, 0.1);
    expect(v.zoom).toBe(MIN_ZOOM);
  });
});
