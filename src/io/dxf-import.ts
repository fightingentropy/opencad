// Minimal DXF parser — pure JS, no third-party libs. Reads the
// AutoCAD DXF group-code stream and converts a subset of entities
// into vectors[] for an UnderlayEntity, suitable for use as a locked
// architectural background.
//
// Supported entities: LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND (arc
// bulges are tessellated), CIRCLE, ARC, TEXT/MTEXT, and INSERT (block
// references are expanded from the BLOCKS section). ELLIPSE, SPLINE and
// other entities are not supported. The parser is forgiving, but anything
// it drops or assumes is reported in `warnings` (see parseDXFWithWarnings).
//
// Units: DXF stores a $INSUNITS code in the HEADER. We map the known
// values to a millimetre scale factor; if absent we assume mm.

import type { UnderlayEntity, Vec2, Bounds } from '../types';
import { nanoid } from 'nanoid';
import {
  assertImportTextLimits,
  IMPORT_LIMITS,
  ImportLimitError,
} from './import-limits';

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

const insunitsToScale = (code: number): number | undefined => {
  // 0=Unitless, 1=in, 2=ft, 3=mi, 4=mm, 5=cm, 6=m, 7=km, 8=µin, 9=mil
  switch (code) {
    case 1: return 25.4;
    case 2: return 304.8;
    case 3: return 1_609_344;
    case 4: return 1;
    case 5: return 10;
    case 6: return 1000;
    case 7: return 1_000_000;
    case 8: return 25.4 / 1_000_000;
    case 9: return 25.4 / 1000;
    default: return undefined;
  }
};

interface ParserState {
  vectors: { a: Vec2; b: Vec2; color?: string }[];
  scale: number;
  bounds: Bounds;
  warnings: string[];
  /** Affine transform applied to every emitted point (block inserts). */
  xf: Affine;
  /** Entity count processed, including block expansions. */
  processed: number;
  skipped: Map<string, number>;
}

// x' = a*x + c*y + e ; y' = b*x + d*y + f
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const compose = (p: Affine, l: Affine): Affine => [
  p[0] * l[0] + p[2] * l[1],
  p[1] * l[0] + p[3] * l[1],
  p[0] * l[2] + p[2] * l[3],
  p[1] * l[2] + p[3] * l[3],
  p[0] * l[4] + p[2] * l[5] + p[4],
  p[1] * l[4] + p[3] * l[5] + p[5],
];
const MAX_BLOCK_DEPTH = 8;

const initState = (): ParserState => ({
  vectors: [],
  scale: 1,
  bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  warnings: [],
  xf: IDENTITY,
  processed: 0,
  skipped: new Map(),
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
  if (state.vectors.length >= IMPORT_LIMITS.dxf.maxOutputItems) {
    throw new ImportLimitError(
      'DXF',
      `more than ${IMPORT_LIMITS.dxf.maxOutputItems.toLocaleString()} output vectors`,
    );
  }
  const s = state.scale;
  const [m0, m1, m2, m3, m4, m5] = state.xf;
  const A = { x: (m0 * a.x + m2 * a.y + m4) * s, y: (m1 * a.x + m3 * a.y + m5) * s };
  const B = { x: (m0 * b.x + m2 * b.y + m4) * s, y: (m1 * b.x + m3 * b.y + m5) * s };
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
  /** Group pairs in file order (needed where order carries meaning). */
  pairs: DxfPair[];
}

interface DxfBlock {
  name: string;
  base: Vec2;
  entities: EntityFields[];
}

interface ParsedEntities {
  entities: EntityFields[];
  blocks: Map<string, DxfBlock>;
}

const collectEntities = (pairs: DxfPair[]): ParsedEntities => {
  // Walk pairs to find the ENTITIES and BLOCKS sections (between
  // SECTION/ENDSEC pairs).
  let section: 'ENTITIES' | 'BLOCKS' | null = null;
  const entities: EntityFields[] = [];
  const blocks = new Map<string, DxfBlock>();
  let block: DxfBlock | null = null;
  let current: EntityFields | null = null;
  let total = 0;

  const appendCurrent = (): void => {
    if (!current) return;
    if (current.type === 'BLOCK') {
      const name = current.data.get(2)?.[0] ?? '';
      block = {
        name,
        base: {
          x: parseFloat(current.data.get(10)?.[0] ?? '0') || 0,
          y: parseFloat(current.data.get(20)?.[0] ?? '0') || 0,
        },
        entities: [],
      };
      blocks.set(name, block);
      current = null;
      return;
    }
    if (current.type === 'ENDBLK') {
      block = null;
      current = null;
      return;
    }
    if (++total > IMPORT_LIMITS.dxf.maxEntities) {
      throw new ImportLimitError(
        'DXF',
        `more than ${IMPORT_LIMITS.dxf.maxEntities.toLocaleString()} entities`,
      );
    }
    if (section === 'BLOCKS') block?.entities.push(current);
    else if (section === 'ENTITIES') entities.push(current);
    current = null;
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 0) {
      const v = p.value.toUpperCase();
      if (v === 'SECTION') {
        appendCurrent();
        const next = pairs[i + 1];
        const name = next && next.code === 2 ? next.value.trim().toUpperCase() : '';
        section = name === 'ENTITIES' || name === 'BLOCKS' ? name : null;
        i++; // the section name pair is not an entity field
      } else if (v === 'ENDSEC') {
        appendCurrent();
        section = null;
        block = null;
      } else if (section) {
        appendCurrent();
        current = { type: v, data: new Map(), pairs: [] };
      }
      continue;
    }
    if (current && section) {
      const list = current.data.get(p.code) ?? [];
      list.push(p.value);
      current.data.set(p.code, list);
      current.pairs.push(p);
    }
  }
  appendCurrent();
  return { entities, blocks };
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

interface PolyVertex {
  x: number;
  y: number;
  bulge: number;
}

// Vertices in file order: group 10 starts a vertex, 20 sets its y and 42
// its bulge (the tangent of a quarter of the arc to the next vertex).
const lwVertices = (pairs: DxfPair[]): PolyVertex[] => {
  const out: PolyVertex[] = [];
  const n = (v: string): number => {
    const f = parseFloat(v);
    return Number.isFinite(f) ? f : 0;
  };
  for (const p of pairs) {
    if (p.code === 10) out.push({ x: n(p.value), y: 0, bulge: 0 });
    else if (p.code === 20 && out.length) out[out.length - 1].y = n(p.value);
    else if (p.code === 42 && out.length) out[out.length - 1].bulge = n(p.value);
  }
  return out;
};

const addBulgeSegment = (
  state: ParserState,
  p1: PolyVertex,
  p2: PolyVertex,
  color?: string,
): void => {
  const b = p1.bulge;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy);
  if (!b || d === 0 || !Number.isFinite(b)) {
    addLine(state, p1, p2, color);
    return;
  }
  const sweep = 4 * Math.atan(b);
  const off = (d / 2) * ((1 - b * b) / (2 * b));
  const cx = (p1.x + p2.x) / 2 - (dy / d) * off;
  const cy = (p1.y + p2.y) / 2 + (dx / d) * off;
  const r = Math.hypot(p1.x - cx, p1.y - cy);
  const a0 = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 64));
  let prev: Vec2 = { x: p1.x, y: p1.y };
  for (let i = 1; i <= steps; i++) {
    const cur: Vec2 =
      i === steps
        ? { x: p2.x, y: p2.y }
        : { x: cx + Math.cos(a0 + (sweep * i) / steps) * r, y: cy + Math.sin(a0 + (sweep * i) / steps) * r };
    addLine(state, prev, cur, color);
    prev = cur;
  }
};

const handleLwpolyline = (state: ParserState, e: EntityFields): void => {
  const vs = lwVertices(e.pairs);
  const closed = (num(e.data, 70) & 1) === 1;
  const color = aciToHex(num(e.data, 62));
  if (vs.length === 0) return;
  for (let i = 1; i < vs.length; i++) addBulgeSegment(state, vs[i - 1], vs[i], color);
  if (closed && vs.length > 2) addBulgeSegment(state, vs[vs.length - 1], vs[0], color);
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
      const pairs: DxfPair[] = [];
      let j = i + 1;
      while (j < entities.length && entities[j].type === 'VERTEX') {
        const vx = entities[j].data.get(10)?.[0];
        const vy = entities[j].data.get(20)?.[0];
        if (vx !== undefined && vy !== undefined) {
          pairs.push({ code: 10, value: vx }, { code: 20, value: vy });
          const vb = entities[j].data.get(42)?.[0];
          if (vb !== undefined) pairs.push({ code: 42, value: vb });
        }
        j++;
      }
      // Skip SEQEND (entities[j] of type 'SEQEND')
      if (j < entities.length && entities[j].type === 'SEQEND') j++;
      const merged: EntityFields = {
        type: 'LWPOLYLINE',
        data: new Map([
          [70, e.data.get(70) ?? ['0']],
          [62, e.data.get(62) ?? ['7']],
        ]),
        pairs: [...pairs, { code: 70, value: e.data.get(70)?.[0] ?? '0' }],
      };
      out.push(merged);
      i = j - 1;
    } else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') {
      out.push(e);
    }
  }
  return out;
};

const skip = (state: ParserState, what: string): void => {
  state.skipped.set(what, (state.skipped.get(what) ?? 0) + 1);
};

const handleInsert = (
  state: ParserState,
  e: EntityFields,
  blocks: Map<string, DxfBlock>,
  depth: number,
): void => {
  const name = e.data.get(2)?.[0] ?? '';
  const block = blocks.get(name);
  if (!block) {
    skip(state, 'INSERT of an undefined block');
    return;
  }
  if (depth >= MAX_BLOCK_DEPTH) {
    skip(state, `INSERT nested deeper than ${MAX_BLOCK_DEPTH} levels`);
    return;
  }
  const sx = e.data.has(41) ? num(e.data, 41) : 1;
  const sy = e.data.has(42) ? num(e.data, 42) : 1;
  const rot = (num(e.data, 50) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const local: Affine = [
    cos * sx,
    sin * sx,
    -sin * sy,
    cos * sy,
    num(e.data, 10) - (cos * sx * block.base.x - sin * sy * block.base.y),
    num(e.data, 20) - (sin * sx * block.base.x + cos * sy * block.base.y),
  ];
  if (num(e.data, 70) > 1 || num(e.data, 71) > 1) {
    skip(state, 'INSERT row/column array (only the first copy is drawn)');
  }
  const saved = state.xf;
  state.xf = compose(saved, local);
  processEntities(state, collapsePolylines(block.entities), blocks, depth + 1);
  state.xf = saved;
};

const processEntities = (
  state: ParserState,
  entities: EntityFields[],
  blocks: Map<string, DxfBlock>,
  depth: number,
): void => {
  for (const e of entities) {
    if (++state.processed > IMPORT_LIMITS.dxf.maxEntities * 4) {
      throw new ImportLimitError('DXF', 'block expansion produced too many entities');
    }
    switch (e.type) {
      case 'LINE': handleLine(state, e); break;
      case 'LWPOLYLINE': handleLwpolyline(state, e); break;
      case 'CIRCLE': handleCircle(state, e); break;
      case 'ARC': handleArc(state, e); break;
      case 'TEXT':
      case 'MTEXT': handleText(state, e); break;
      case 'INSERT': handleInsert(state, e, blocks, depth); break;
      default:
        skip(state, e.type);
        break;
    }
  }
};

export interface DxfImportResult {
  underlay: UnderlayEntity;
  /** Plain-language notes on geometry dropped or units assumed. */
  warnings: string[];
}

export const parseDXF = (text: string): UnderlayEntity => parseDXFWithWarnings(text).underlay;

export const parseDXFWithWarnings = (text: string): DxfImportResult => {
  assertImportTextLimits(text, 'DXF', IMPORT_LIMITS.dxf);
  if (!text || text.length < 10) {
    throw new Error('parseDXF: empty or invalid DXF input');
  }
  const pairs = tokenize(text);
  if (pairs.length === 0) {
    throw new Error('parseDXF: no DXF pairs detected');
  }
  const state = initState();
  const insunits = headerInsunits(pairs);
  const scale = insunitsToScale(insunits);
  state.scale = scale ?? 1;
  if (insunits === 0) {
    state.warnings.push('No $INSUNITS in header — assuming millimetres.');
  } else if (scale === undefined) {
    state.warnings.push(`Unsupported $INSUNITS code ${insunits} — assuming millimetres.`);
  }
  const { entities, blocks } = collectEntities(pairs);
  processEntities(state, collapsePolylines(entities), blocks, 0);
  for (const [what, n] of state.skipped) {
    state.warnings.push(
      what.startsWith('INSERT')
        ? `${n} ${what} skipped.`
        : `${n} unsupported ${what} entit${n === 1 ? 'y' : 'ies'} skipped.`,
    );
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
    // A layer name, not an id: add the result with addEntitiesByLayerName.
    layerId: 'Underlay',
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
  return { underlay, warnings: state.warnings };
};
