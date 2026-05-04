// Minimal DXF parser — pure JS, no third-party libs. Reads the
// AutoCAD DXF group-code stream and converts a subset of entities
// into vectors[] for an UnderlayEntity, suitable for use as a locked
// architectural background.
//
// Supported entities: LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND,
// CIRCLE, ARC, TEXT/MTEXT. ELLIPSE and SPLINE are not supported (they
// are uncommon in floor-plan exports). Unrecognised entities are
// silently skipped — the parser is forgiving.
//
// Units: DXF stores a $INSUNITS code in the HEADER. We map a few
// common values to a millimetre scale factor; if absent we assume mm.

import type { UnderlayEntity, Vec2, Bounds } from '../types';
import { nanoid } from 'nanoid';

interface DxfPair {
  code: number;
  value: string;
}

const tokenize = (text: string): DxfPair[] => {
  // DXF is a simple line-pair format: each pair is two text lines
  // (group code on line 1, value on line 2). Both CRLF and LF are
  // permitted; we strip leading/trailing whitespace.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push({ code, value: lines[i + 1] ?? '' });
  }
  return out;
};

const insunitsToScale = (code: number): number => {
  // 0=Unitless, 1=in, 2=ft, 3=mi, 4=mm, 5=cm, 6=m, 7=km, 8=µin, 9=mil
  switch (code) {
    case 1: return 25.4;
    case 2: return 304.8;
    case 4: return 1;
    case 5: return 10;
    case 6: return 1000;
    case 8: return 25.4 / 1_000_000;
    case 9: return 25.4 / 1000;
    default: return 1;
  }
};

interface ParserState {
  vectors: { a: Vec2; b: Vec2; color?: string }[];
  scale: number;
  bounds: Bounds;
  warnings: string[];
}

const initState = (): ParserState => ({
  vectors: [],
  scale: 1,
  bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  warnings: [],
});

const expand = (b: Bounds, p: Vec2): void => {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
};

const addLine = (
  state: ParserState,
  a: Vec2,
  b: Vec2,
  color?: string,
): void => {
  const s = state.scale;
  const A = { x: a.x * s, y: a.y * s };
  const B = { x: b.x * s, y: b.y * s };
  state.vectors.push({ a: A, b: B, color });
  expand(state.bounds, A);
  expand(state.bounds, B);
};

const tessellateArc = (
  state: ParserState,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  color?: string,
): void => {
  // Convert to radians, ensure end > start
  let s = (startDeg * Math.PI) / 180;
  let e = (endDeg * Math.PI) / 180;
  if (e < s) e += Math.PI * 2;
  const steps = Math.max(8, Math.ceil(((e - s) / (Math.PI * 2)) * 64));
  let prev: Vec2 = { x: cx + Math.cos(s) * r, y: cy + Math.sin(s) * r };
  for (let i = 1; i <= steps; i++) {
    const t = s + ((e - s) * i) / steps;
    const cur: Vec2 = { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
    addLine(state, prev, cur, color);
    prev = cur;
  }
};

// Parse a section of pairs into a map of group codes by entity. The
// caller pre-slices to the body of an ENTITY between successive 0
// codes so the same group code can repeat across entities.
interface EntityFields {
  type: string;
  data: Map<number, string[]>;
}

const collectEntities = (pairs: DxfPair[]): EntityFields[] => {
  // Walk pairs to find the ENTITIES section (between SECTION/ENDSEC pairs)
  let inEntities = false;
  const entities: EntityFields[] = [];
  let current: EntityFields | null = null;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 0) {
      const v = p.value.toUpperCase();
      if (v === 'SECTION') {
        // Next 2-pair declares which section
        const next = pairs[i + 1];
        if (next && next.code === 2 && next.value.toUpperCase() === 'ENTITIES') {
          inEntities = true;
        }
      } else if (v === 'ENDSEC') {
        inEntities = false;
        if (current) entities.push(current);
        current = null;
      } else if (inEntities) {
        if (current) entities.push(current);
        current = { type: v, data: new Map() };
      }
      continue;
    }
    if (current && inEntities) {
      const list = current.data.get(p.code) ?? [];
      list.push(p.value);
      current.data.set(p.code, list);
    }
  }
  if (current) entities.push(current);
  return entities;
};

const headerInsunits = (pairs: DxfPair[]): number => {
  // Walk for $INSUNITS in the HEADER section
  for (let i = 0; i < pairs.length - 2; i++) {
    if (
      pairs[i].code === 9 &&
      (pairs[i].value === '$INSUNITS' ||
        pairs[i].value.toUpperCase() === '$INSUNITS')
    ) {
      const next = pairs[i + 1];
      const code = parseInt(next?.value ?? '0', 10);
      if (!Number.isNaN(code)) return code;
    }
  }
  return 0;
};

const num = (m: Map<number, string[]>, code: number, idx = 0): number => {
  const arr = m.get(code);
  if (!arr || arr.length <= idx) return 0;
  const v = parseFloat(arr[idx]);
  return Number.isFinite(v) ? v : 0;
};

const numList = (m: Map<number, string[]>, code: number): number[] =>
  (m.get(code) ?? []).map((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  });

const aciToHex = (aci: number): string | undefined => {
  // Tiny subset of the AutoCAD Color Index — covers the common 1–7 + bylayer
  const map: Record<number, string> = {
    1: '#ff3a3a',
    2: '#ffd84d',
    3: '#9ad65a',
    4: '#5cdcff',
    5: '#3a8aff',
    6: '#bb8cff',
    7: '#e6e6e6',
  };
  return map[aci];
};

const handleLine = (state: ParserState, e: EntityFields): void => {
  const a = { x: num(e.data, 10), y: num(e.data, 20) };
  const b = { x: num(e.data, 11), y: num(e.data, 21) };
  const color = aciToHex(num(e.data, 62));
  addLine(state, a, b, color);
};

const handleLwpolyline = (state: ParserState, e: EntityFields): void => {
  const xs = numList(e.data, 10);
  const ys = numList(e.data, 20);
  const closed = (num(e.data, 70) & 1) === 1;
  const color = aciToHex(num(e.data, 62));
  if (xs.length === 0) return;
  for (let i = 1; i < xs.length; i++) {
    addLine(state, { x: xs[i - 1], y: ys[i - 1] }, { x: xs[i], y: ys[i] }, color);
  }
  if (closed && xs.length > 2) {
    addLine(
      state,
      { x: xs[xs.length - 1], y: ys[ys.length - 1] },
      { x: xs[0], y: ys[0] },
      color,
    );
  }
};

const handleCircle = (state: ParserState, e: EntityFields): void => {
  const cx = num(e.data, 10);
  const cy = num(e.data, 20);
  const r = num(e.data, 40);
  const color = aciToHex(num(e.data, 62));
  if (r <= 0) return;
  tessellateArc(state, cx, cy, r, 0, 360, color);
};

const handleArc = (state: ParserState, e: EntityFields): void => {
  const cx = num(e.data, 10);
  const cy = num(e.data, 20);
  const r = num(e.data, 40);
  const startDeg = num(e.data, 50);
  const endDeg = num(e.data, 51);
  const color = aciToHex(num(e.data, 62));
  if (r <= 0) return;
  tessellateArc(state, cx, cy, r, startDeg, endDeg, color);
};

const handleText = (state: ParserState, e: EntityFields): void => {
  // We don't render text glyphs in the underlay; we just draw a tiny
  // diamond at the insertion point so the user knows there's a label
  // there in the source file.
  const x = num(e.data, 10);
  const y = num(e.data, 20);
  const color = aciToHex(num(e.data, 62));
  const r = 5;
  addLine(state, { x: x - r, y }, { x, y: y + r }, color);
  addLine(state, { x, y: y + r }, { x: x + r, y }, color);
  addLine(state, { x: x + r, y }, { x, y: y - r }, color);
  addLine(state, { x, y: y - r }, { x: x - r, y }, color);
};

// POLYLINE/VERTEX/SEQEND requires multi-entity grouping. We handle it
// by post-processing entities in order: a POLYLINE absorbs subsequent
// VERTEX entries until SEQEND.
const collapsePolylines = (entities: EntityFields[]): EntityFields[] => {
  const out: EntityFields[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type === 'POLYLINE') {
      const xs: string[] = [];
      const ys: string[] = [];
      let j = i + 1;
      while (j < entities.length && entities[j].type === 'VERTEX') {
        const vx = entities[j].data.get(10)?.[0];
        const vy = entities[j].data.get(20)?.[0];
        if (vx !== undefined && vy !== undefined) {
          xs.push(vx);
          ys.push(vy);
        }
        j++;
      }
      // Skip SEQEND (entities[j] of type 'SEQEND')
      if (j < entities.length && entities[j].type === 'SEQEND') j++;
      const merged: EntityFields = {
        type: 'LWPOLYLINE',
        data: new Map([
          [10, xs],
          [20, ys],
          [70, e.data.get(70) ?? ['0']],
          [62, e.data.get(62) ?? ['7']],
        ]),
      };
      out.push(merged);
      i = j - 1;
    } else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') {
      out.push(e);
    }
  }
  return out;
};

export const parseDXF = (text: string): UnderlayEntity => {
  if (!text || text.length < 10) {
    throw new Error('parseDXF: empty or invalid DXF input');
  }
  const pairs = tokenize(text);
  if (pairs.length === 0) {
    throw new Error('parseDXF: no DXF pairs detected');
  }
  const state = initState();
  const insunits = headerInsunits(pairs);
  state.scale = insunitsToScale(insunits);
  if (insunits === 0) {
    state.warnings.push('No $INSUNITS in header — assuming millimetres.');
  }
  const entities = collapsePolylines(collectEntities(pairs));
  for (const e of entities) {
    switch (e.type) {
      case 'LINE': handleLine(state, e); break;
      case 'LWPOLYLINE': handleLwpolyline(state, e); break;
      case 'CIRCLE': handleCircle(state, e); break;
      case 'ARC': handleArc(state, e); break;
      case 'TEXT':
      case 'MTEXT': handleText(state, e); break;
      default: break;
    }
  }
  if (state.vectors.length === 0) {
    throw new Error('parseDXF: no supported entities found');
  }
  // Origin = bottom-left of bounds; width/height from extents.
  const b = state.bounds;
  const origin = { x: b.minX, y: b.minY };
  // Translate vectors into local coords so origin sits at (0,0).
  const localVectors = state.vectors.map((v) => ({
    a: { x: v.a.x - origin.x, y: v.a.y - origin.y },
    b: { x: v.b.x - origin.x, y: v.b.y - origin.y },
    color: v.color,
  }));
  const width = Math.max(1, b.maxX - b.minX);
  const height = Math.max(1, b.maxY - b.minY);

  const underlay: UnderlayEntity = {
    id: nanoid(),
    kind: 'underlay',
    layerId: 'underlay',
    visible: true,
    locked: true,
    underlayLocked: true,
    opacity: 0.6,
    origin,
    vectors: localVectors,
    width,
    height,
    sourceName: 'imported.dxf',
  };
  return underlay;
};
