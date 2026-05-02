import type { Project, Entity, Sheet, Layer, SymbolEntity } from '../types';
import { getSymbol, renderSymbolPreview } from '../symbols';
import { transformSymbolPoint } from '../lib/hittest';

export const exportSheetSVG = (project: Project): string => {
  const sheet = project.sheets[project.activeSheetId];
  const w = sheet.width;
  const h = sheet.height;
  // SVG y is down; we keep CAD coords (y-up) by flipping the group transform
  const xform = `translate(0 ${h}) scale(1 -1)`;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" style="background:#0a0e14">`);
  parts.push(`<g transform="${xform}">`);

  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (!e || !e.visible) continue;
    const layer = project.layers[e.layerId];
    if (!layer || !layer.visible) continue;
    parts.push(entitySVG(e, layer, project));
  }

  parts.push('</g>');
  // Title block
  parts.push(`<g font-family="sans-serif" fill="#e6e6e6">
    <rect x="${w - 65}" y="${h - 35}" width="60" height="30" fill="none" stroke="#445575" />
    <text x="${w - 60}" y="${h - 25}" font-size="3.2" fill="#9aa3b2">OPENCAD ELECTRICAL</text>
    <text x="${w - 60}" y="${h - 18}" font-size="4">${escapeXml(sheet.name)}</text>
    <text x="${w - 60}" y="${h - 9}" font-size="2.6" fill="#9aa3b2">SHEET ${sheet.number} • ${escapeXml(project.name)}</text>
  </g>`);
  parts.push('</svg>');
  return parts.join('\n');
};

const entitySVG = (e: Entity, layer: Layer, project: Project): string => {
  const stroke = e.color ?? layer.color;
  const lw = e.lineWidth ?? layer.lineWidth;
  const dash = e.lineDash ?? layer.lineDash;
  const dashAttr = dash ? `stroke-dasharray="${dash.join(' ')}"` : '';
  const lineAttrs = `stroke="${stroke}" stroke-width="${lw}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${dashAttr}`;

  switch (e.kind) {
    case 'line':
      return `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" ${lineAttrs} />`;
    case 'polyline':
      return `<polyline points="${e.points.map(p => `${p.x},${p.y}`).join(' ')}" ${lineAttrs} ${e.closed ? 'fill="none"' : ''} />`;
    case 'wire':
      return `<polyline points="${e.points.map(p => `${p.x},${p.y}`).join(' ')}" stroke="${stroke || '#ff3a3a'}" stroke-width="${lw}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    case 'bus':
      return `<polyline points="${e.points.map(p => `${p.x},${p.y}`).join(' ')}" stroke="${stroke}" stroke-width="${lw * 3}" fill="none" stroke-linecap="round" />`;
    case 'rectangle': {
      const x = Math.min(e.a.x, e.b.x);
      const y = Math.min(e.a.y, e.b.y);
      const w = Math.abs(e.b.x - e.a.x);
      const h = Math.abs(e.b.y - e.a.y);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${lineAttrs} ${(e as any).fill ? `fill="${(e as any).fill}"` : ''} />`;
    }
    case 'circle':
      return `<circle cx="${e.center.x}" cy="${e.center.y}" r="${e.radius}" ${lineAttrs} ${(e as any).fill ? `fill="${(e as any).fill}"` : ''} />`;
    case 'arc': {
      const sx = e.center.x + e.radius * Math.cos(e.startAngle);
      const sy = e.center.y + e.radius * Math.sin(e.startAngle);
      const ex = e.center.x + e.radius * Math.cos(e.endAngle);
      const ey = e.center.y + e.radius * Math.sin(e.endAngle);
      const dAng = ((e.endAngle - e.startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const large = dAng > Math.PI ? 1 : 0;
      return `<path d="M ${sx} ${sy} A ${e.radius} ${e.radius} 0 ${large} 1 ${ex} ${ey}" ${lineAttrs} />`;
    }
    case 'ellipse':
      return `<ellipse cx="${e.center.x}" cy="${e.center.y}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${e.rotation * 180 / Math.PI} ${e.center.x} ${e.center.y})" ${lineAttrs} />`;
    case 'text':
      return `<g transform="translate(${e.position.x} ${e.position.y}) scale(1 -1) rotate(${-e.rotation * 180 / Math.PI})"><text font-size="${e.fontSize}" fill="${stroke}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${escapeXml(e.text)}</text></g>`;
    case 'symbol': {
      const def = getSymbol(e.symbolId);
      if (!def) return '';
      const t = `translate(${e.position.x} ${e.position.y}) rotate(${e.rotation * 180 / Math.PI}) scale(${e.scale * (e.mirror ? -1 : 1)} ${e.scale})`;
      const inner = renderSymbolPreviewSVG(e, layer);
      const tag = e.tag ? `<g transform="translate(${e.position.x} ${e.position.y + def.bounds.maxY * e.scale + 1.5}) scale(1 -1)"><text font-size="3" fill="#9ad65a" text-anchor="middle" font-family="monospace" font-weight="bold">${escapeXml(e.tag)}</text></g>` : '';
      return `<g transform="${t}">${inner}</g>${tag}`;
    }
    case 'wire-label':
      return `<g transform="translate(${e.position.x} ${e.position.y}) scale(1 -1) rotate(${-e.rotation * 180 / Math.PI})"><text font-size="3" fill="#ffd84d" text-anchor="middle" font-family="monospace">${escapeXml(e.text)}</text></g>`;
    case 'dimension':
      return ''; // simplified
    default:
      return '';
  }
};

const renderSymbolPreviewSVG = (sym: SymbolEntity, layer: Layer): string => {
  const def = getSymbol(sym.symbolId);
  if (!def) return '';
  const stroke = sym.color ?? layer.color;
  const lw = sym.lineWidth ?? layer.lineWidth;
  const parts: string[] = [];
  for (const p of def.primitives) {
    switch (p.kind) {
      case 'line':
        parts.push(`<line x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" stroke="${stroke}" stroke-width="${p.lineWidth ?? lw}" fill="none" stroke-linecap="round" />`);
        break;
      case 'circle':
        parts.push(`<circle cx="${p.c.x}" cy="${p.c.y}" r="${p.r}" stroke="${stroke}" stroke-width="${p.lineWidth ?? lw}" fill="${p.fill ?? 'none'}" />`);
        break;
      case 'arc': {
        const sx = p.c.x + p.r * Math.cos(p.start);
        const sy = p.c.y + p.r * Math.sin(p.start);
        const ex = p.c.x + p.r * Math.cos(p.end);
        const ey = p.c.y + p.r * Math.sin(p.end);
        const dAng = ((p.end - p.start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const large = dAng > Math.PI ? 1 : 0;
        parts.push(`<path d="M ${sx} ${sy} A ${p.r} ${p.r} 0 ${large} 1 ${ex} ${ey}" stroke="${stroke}" stroke-width="${p.lineWidth ?? lw}" fill="none" />`);
        break;
      }
      case 'rect': {
        const x = Math.min(p.a.x, p.b.x);
        const y = Math.min(p.a.y, p.b.y);
        const w = Math.abs(p.b.x - p.a.x);
        const h = Math.abs(p.b.y - p.a.y);
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}" stroke-width="${p.lineWidth ?? lw}" fill="${p.fill ?? 'none'}" />`);
        break;
      }
      case 'polyline':
        parts.push(`<${p.closed ? 'polygon' : 'polyline'} points="${p.points.map(q => `${q.x},${q.y}`).join(' ')}" stroke="${stroke}" stroke-width="${p.lineWidth ?? lw}" fill="${p.fill ?? 'none'}" />`);
        break;
      case 'text':
        parts.push(`<g transform="translate(${p.p.x} ${p.p.y}) scale(1 -1)"><text font-size="${p.size}" fill="${stroke}" text-anchor="${p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}" dominant-baseline="middle">${escapeXml(p.text)}</text></g>`);
        break;
    }
  }
  return parts.join('');
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
