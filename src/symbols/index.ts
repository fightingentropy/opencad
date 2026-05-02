import type { SymbolDef, SymbolPrimitive } from '../types';
export {
  SYMBOLS,
  SYMBOL_LIST,
  getSymbol,
  symbolsByCategory,
  CATEGORY_LABELS,
} from './library';
import { SYMBOL_LIST } from './library';

export const searchSymbols = (query: string): SymbolDef[] => {
  const q = query.trim().toLowerCase();
  if (!q) return SYMBOL_LIST;
  return SYMBOL_LIST.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
  );
};

// SVG renderer for previews / exports
export const renderSymbolPreview = (def: SymbolDef, size: number): string => {
  const b = def.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const pad = Math.max(w, h) * 0.12;
  const vbX = b.minX - pad;
  const vbY = b.minY - pad;
  const vbW = w + pad * 2;
  const vbH = h + pad * 2;
  // SVG y is down; flip y-axis so coordinates match canvas (y-up)
  const xform = `scale(1,-1) translate(0, ${-(2 * vbY + vbH)})`;
  const parts: string[] = [];
  for (const p of def.primitives) parts.push(svgPrim(p));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round">
<g transform="${xform}">${parts.join('')}</g>
</svg>`;
};

const svgPrim = (p: SymbolPrimitive): string => {
  switch (p.kind) {
    case 'line':
      return `<line x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" stroke-width="${p.lineWidth ?? 0.5}" />`;
    case 'circle':
      return `<circle cx="${p.c.x}" cy="${p.c.y}" r="${p.r}" stroke-width="${p.lineWidth ?? 0.5}" ${p.fill ? `fill="${p.fill}"` : ''} />`;
    case 'arc': {
      const sx = p.c.x + p.r * Math.cos(p.start);
      const sy = p.c.y + p.r * Math.sin(p.start);
      const ex = p.c.x + p.r * Math.cos(p.end);
      const ey = p.c.y + p.r * Math.sin(p.end);
      const dAng = ((p.end - p.start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const large = dAng > Math.PI ? 1 : 0;
      return `<path d="M ${sx} ${sy} A ${p.r} ${p.r} 0 ${large} 1 ${ex} ${ey}" stroke-width="${p.lineWidth ?? 0.5}" />`;
    }
    case 'rect': {
      const x = Math.min(p.a.x, p.b.x);
      const y = Math.min(p.a.y, p.b.y);
      const w = Math.abs(p.b.x - p.a.x);
      const h = Math.abs(p.b.y - p.a.y);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-width="${p.lineWidth ?? 0.5}" ${p.fill ? `fill="${p.fill}"` : ''} />`;
    }
    case 'polyline': {
      const pts = p.points.map((q) => `${q.x},${q.y}`).join(' ');
      const tag = p.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${pts}" stroke-width="${p.lineWidth ?? 0.5}" ${p.fill ? `fill="${p.fill}"` : ''} />`;
    }
    case 'text':
      return `<g transform="translate(${p.p.x} ${p.p.y}) scale(1,-1)"><text font-size="${p.size}" text-anchor="${p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}" fill="currentColor" stroke="none" dominant-baseline="middle">${escapeXml(p.text)}</text></g>`;
  }
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type { SymbolDef };
