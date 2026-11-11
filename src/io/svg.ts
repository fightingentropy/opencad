import type { Project, Entity, Sheet, Layer, SymbolEntity } from '../types';
import { getSymbol, renderSymbolPreview } from '../symbols';
import { transformSymbolPoint } from '../lib/hittest';
import { buildExportMetadata } from './export-metadata';

export const exportSheetSVG = (project: Project): string => {
  const sheet = project.sheets[project.activeSheetId];
  const w = num(sheet.width);
  const h = num(sheet.height);
  // SVG y is down; we keep CAD coords (y-up) by flipping the group transform
  const xform = `translate(0 ${h}) scale(1 -1)`;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" style="background:#0a0e14">`);
  parts.push(`<metadata id="opencad-export-metadata">${escapeXml(JSON.stringify(buildExportMetadata(project, 'sheet-svg')))}</metadata>`);
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
    <text x="${w - 60}" y="${h - 9}" font-size="2.6" fill="#9aa3b2">SHEET ${escapeXml(String(sheet.number))} • ${escapeXml(project.name)}</text>
  </g>`);
  parts.push('</svg>');
  return parts.join('\n');
};

const entitySVG = (e: Entity, layer: Layer, project: Project): string => {
  const stroke = escapeXml(e.color ?? layer.color);
  const lw = e.lineWidth ?? layer.lineWidth;
  const dash = e.lineDash ?? layer.lineDash;
  const dashAttr = dash ? ` stroke-dasharray="${escapeXml(dash.join(' '))}"` : '';
  // The fill is added once per shape. An element that repeats an attribute is
  // not well-formed XML, and then the whole SVG fails to load.
  const strokeAttrs = `stroke="${stroke}" stroke-width="${num(lw)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}`;
  const lineAttrs = `${strokeAttrs} fill="none"`;
  const filledAttrs = (fill?: string) => `${strokeAttrs} fill="${fill ? escapeXml(fill) : 'none'}"`;

  switch (e.kind) {
    case 'line':
      return `<line x1="${num(e.a.x)}" y1="${num(e.a.y)}" x2="${num(e.b.x)}" y2="${num(e.b.y)}" ${lineAttrs} />`;
    case 'polyline':
      // A polygon draws the closing segment; a polyline would leave the shape open.
      return `<${e.closed ? 'polygon' : 'polyline'} points="${e.points.map(p => `${num(p.x)},${num(p.y)}`).join(' ')}" ${lineAttrs} />`;
    case 'wire':
      return `<polyline points="${e.points.map(p => `${num(p.x)},${num(p.y)}`).join(' ')}" stroke="${stroke || '#ff3a3a'}" stroke-width="${num(lw)}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    case 'bus':
      return `<polyline points="${e.points.map(p => `${num(p.x)},${num(p.y)}`).join(' ')}" stroke="${stroke}" stroke-width="${num(lw * 3)}" fill="none" stroke-linecap="round" />`;
    case 'rectangle': {
      const x = Math.min(e.a.x, e.b.x);
      const y = Math.min(e.a.y, e.b.y);
      const w = Math.abs(e.b.x - e.a.x);
      const h = Math.abs(e.b.y - e.a.y);
      return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${filledAttrs(e.fill)} />`;
    }
    case 'circle':
      return `<circle cx="${num(e.center.x)}" cy="${num(e.center.y)}" r="${num(e.radius)}" ${filledAttrs(e.fill)} />`;
    case 'arc': {
      const sx = e.center.x + e.radius * Math.cos(e.startAngle);
      const sy = e.center.y + e.radius * Math.sin(e.startAngle);
      const ex = e.center.x + e.radius * Math.cos(e.endAngle);
      const ey = e.center.y + e.radius * Math.sin(e.endAngle);
      const dAng = ((e.endAngle - e.startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const large = dAng > Math.PI ? 1 : 0;
      return `<path d="M ${num(sx)} ${num(sy)} A ${num(e.radius)} ${num(e.radius)} 0 ${num(large)} 1 ${num(ex)} ${num(ey)}" ${lineAttrs} />`;
    }
    case 'ellipse':
      return `<ellipse cx="${num(e.center.x)}" cy="${num(e.center.y)}" rx="${num(e.rx)}" ry="${num(e.ry)}" transform="rotate(${num(e.rotation * 180 / Math.PI)} ${num(e.center.x)} ${num(e.center.y)})" ${lineAttrs} />`;
    case 'text':
      return `<g transform="translate(${num(e.position.x)} ${num(e.position.y)}) scale(1 -1) rotate(${num(-e.rotation * 180 / Math.PI)})"><text font-size="${num(e.fontSize)}" fill="${stroke}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${escapeXml(e.text)}</text></g>`;
    case 'symbol': {
      const def = getSymbol(e.symbolId);
      if (!def) return '';
      const t = `translate(${num(e.position.x)} ${num(e.position.y)}) rotate(${num(e.rotation * 180 / Math.PI)}) scale(${num(e.scale * (e.mirror ? -1 : 1))} ${num(e.scale)})`;
      const inner = renderSymbolPreviewSVG(e, layer);
      const tag = e.tag ? `<g transform="translate(${num(e.position.x)} ${num(e.position.y + def.bounds.maxY * e.scale + 1.5)}) scale(1 -1)"><text font-size="3" fill="#9ad65a" text-anchor="middle" font-family="monospace" font-weight="bold">${escapeXml(e.tag)}</text></g>` : '';
      return `<g transform="${t}">${inner}</g>${tag}`;
    }
    case 'wire-label':
      return `<g transform="translate(${num(e.position.x)} ${num(e.position.y)}) scale(1 -1) rotate(${num(-e.rotation * 180 / Math.PI)})"><text font-size="3" fill="#ffd84d" text-anchor="middle" font-family="monospace">${escapeXml(e.text)}</text></g>`;
    case 'dimension':
      return ''; // simplified
    case 'containment': {
      const w = e.width ?? 50;
      const pts = e.points.map(p => `${num(p.x)},${num(p.y)}`).join(' ');
      const cap = e.containmentType === 'conduit' ? 'round' : 'butt';
      // Translucent band + thin centerline approximates the on-screen look.
      return (
        `<polyline points="${pts}" stroke="${stroke}" stroke-width="${num(w)}" fill="none" stroke-opacity="0.3" stroke-linecap="${cap}" stroke-linejoin="round" />` +
        `<polyline points="${pts}" stroke="${stroke}" stroke-width="${num(Math.max(0.4, w * 0.06))}" fill="none" stroke-linecap="${cap}" />`
      );
    }
    default:
      return '';
  }
};

const renderSymbolPreviewSVG = (sym: SymbolEntity, layer: Layer): string => {
  const def = getSymbol(sym.symbolId);
  if (!def) return '';
  const stroke = escapeXml(sym.color ?? layer.color);
  const lw = sym.lineWidth ?? layer.lineWidth;
  const parts: string[] = [];
  for (const p of def.primitives) {
    switch (p.kind) {
      case 'line':
        parts.push(`<line x1="${num(p.a.x)}" y1="${num(p.a.y)}" x2="${num(p.b.x)}" y2="${num(p.b.y)}" stroke="${stroke}" stroke-width="${num(p.lineWidth ?? lw)}" fill="none" stroke-linecap="round" />`);
        break;
      case 'circle':
        parts.push(`<circle cx="${num(p.c.x)}" cy="${num(p.c.y)}" r="${num(p.r)}" stroke="${stroke}" stroke-width="${num(p.lineWidth ?? lw)}" fill="${escapeXml(p.fill ?? 'none')}" />`);
        break;
      case 'arc': {
        const sx = p.c.x + p.r * Math.cos(p.start);
        const sy = p.c.y + p.r * Math.sin(p.start);
        const ex = p.c.x + p.r * Math.cos(p.end);
        const ey = p.c.y + p.r * Math.sin(p.end);
        const dAng = ((p.end - p.start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const large = dAng > Math.PI ? 1 : 0;
        parts.push(`<path d="M ${num(sx)} ${num(sy)} A ${num(p.r)} ${num(p.r)} 0 ${num(large)} 1 ${num(ex)} ${num(ey)}" stroke="${stroke}" stroke-width="${num(p.lineWidth ?? lw)}" fill="none" />`);
        break;
      }
      case 'rect': {
        const x = Math.min(p.a.x, p.b.x);
        const y = Math.min(p.a.y, p.b.y);
        const w = Math.abs(p.b.x - p.a.x);
        const h = Math.abs(p.b.y - p.a.y);
        parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" stroke="${stroke}" stroke-width="${num(p.lineWidth ?? lw)}" fill="${escapeXml(p.fill ?? 'none')}" />`);
        break;
      }
      case 'polyline':
        parts.push(`<${p.closed ? 'polygon' : 'polyline'} points="${p.points.map(q => `${num(q.x)},${num(q.y)}`).join(' ')}" stroke="${stroke}" stroke-width="${num(p.lineWidth ?? lw)}" fill="${escapeXml(p.fill ?? 'none')}" />`);
        break;
      case 'text':
        parts.push(`<g transform="translate(${num(p.p.x)} ${num(p.p.y)}) scale(1 -1)"><text font-size="${num(p.size)}" fill="${stroke}" text-anchor="${p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}" dominant-baseline="middle">${escapeXml(p.text)}</text></g>`);
        break;
    }
  }
  return parts.join('');
};

// A number read from a project file may be a string or NaN. Anything that is
// not a finite number is written as 0 so it cannot break out of an attribute.
const num = (v: unknown): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

const escapeXml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
