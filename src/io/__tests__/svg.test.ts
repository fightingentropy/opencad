import { describe, expect, it } from 'vitest';
import { exportSheetSVG } from '../svg';
import { createEmptyProject } from '../../state/store';
import type { Entity } from '../../types';

// Exports a fresh project holding the entities `build` returns for its active layer.
const exportWith = (build: (layerId: string) => Entity[]): string => {
  const project = createEmptyProject();
  const sheet = project.sheets[project.activeSheetId];
  for (const e of build(project.activeLayerId)) {
    sheet.entities[e.id] = e;
    sheet.entityOrder.push(e.id);
  }
  return exportSheetSVG(project);
};

const base = (id: string, layerId: string) => ({ id, layerId, visible: true, locked: false });

const startTags = (svg: string): string[] => svg.match(/<[a-zA-Z][^>]*>/g) ?? [];

// Start tags that repeat an attribute. One of these makes the document
// ill-formed, so browsers refuse to load it as an image.
const tagsWithRepeatedAttributes = (svg: string): string[] =>
  startTags(svg).filter((tag) => {
    const names = [...tag.matchAll(/\s([\w:-]+)="[^"]*"/g)].map((m) => m[1]);
    return new Set(names).size !== names.length;
  });

const tagContaining = (svg: string, marker: string): string =>
  startTags(svg).find((tag) => tag.includes(marker)) ?? '';

describe('exportSheetSVG', () => {
  it('never repeats an attribute on an element', () => {
    const svg = exportWith((layer) => [
      { ...base('closed', layer), kind: 'polyline', closed: true, points: [{ x: 11, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 9 }] },
      { ...base('rect', layer), kind: 'rectangle', a: { x: 13, y: 0 }, b: { x: 23, y: 8 }, fill: '#102030' },
      { ...base('plain-rect', layer), kind: 'rectangle', a: { x: 14, y: 0 }, b: { x: 24, y: 8 } },
      { ...base('circle', layer), kind: 'circle', center: { x: 15, y: 15 }, radius: 4, fill: '#405060', lineDash: [2, 1] },
      { ...base('line', layer), kind: 'line', a: { x: 16, y: 0 }, b: { x: 26, y: 3 } },
    ]);

    expect(tagsWithRepeatedAttributes(svg)).toEqual([]);
    expect(tagContaining(svg, 'x="13"')).toContain('fill="#102030"');
    expect(tagContaining(svg, 'x="14"')).toContain('fill="none"');
    expect(tagContaining(svg, 'cx="15"')).toContain('fill="#405060"');
    expect(tagContaining(svg, 'cx="15"')).toContain('stroke-dasharray="2 1"');
    expect(tagContaining(svg, 'x1="16"')).toContain('fill="none"');
  });

  it('exports a closed polyline as an unfilled polygon and an open one as a polyline', () => {
    const svg = exportWith((layer) => [
      { ...base('closed', layer), kind: 'polyline', closed: true, points: [{ x: 11, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 9 }] },
      { ...base('open', layer), kind: 'polyline', closed: false, points: [{ x: 12, y: 0 }, { x: 22, y: 5 }] },
    ]);

    const closed = tagContaining(svg, 'points="11,0 21,0 21,9"');
    expect(closed.startsWith('<polygon ')).toBe(true);
    expect(closed).toContain('fill="none"');
    expect(tagContaining(svg, 'points="12,0 22,5"').startsWith('<polyline ')).toBe(true);
  });

  it('escapes colours so they cannot break out of the attribute', () => {
    const svg = exportWith((layer) => [{
      ...base('hostile', layer), kind: 'rectangle', a: { x: 17, y: 0 }, b: { x: 27, y: 8 },
      color: 'red" onload="x', fill: '"><script>',
    }]);

    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('onload="x');
    expect(tagsWithRepeatedAttributes(svg)).toEqual([]);
  });
});
