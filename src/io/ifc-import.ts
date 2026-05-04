// Minimal IFC reader — pulls IfcWall, IfcSlab and IfcSpace records
// out of an IFC4 STEP file and converts them to WallEntity /
// UnderlayEntity / RoomEntity. Not a full IFC parser — we sidestep
// the global hierarchy and only chase the references we need.
//
// Strategy:
//   1. Tokenise the SPF body into `#id=ENTITY(args);` records.
//   2. For each record we care about, walk a tiny set of inline
//      reference IDs (placement + representation) to read coords.
//   3. Convert into our entity model. Anything we can't resolve is
//      reported via warnings rather than thrown.

import type { Entity, WallEntity, RoomEntity, UnderlayEntity, Vec2 } from '../types';
import { nanoid } from 'nanoid';

interface IfcRecord {
  id: number;
  type: string;
  args: string; // raw parenthesised arg list
}

interface ImportResult {
  entities: Entity[];
  warnings: string[];
}

const RECORD_RX = /#(\d+)=([A-Z0-9_]+)\(([\s\S]*?)\);/g;

const parseRecords = (text: string): Map<number, IfcRecord> => {
  const out = new Map<number, IfcRecord>();
  // Strip header / footer — we're forgiving about whitespace
  const body = text.replace(/\r\n/g, '\n');
  let m: RegExpExecArray | null;
  while ((m = RECORD_RX.exec(body)) !== null) {
    const id = parseInt(m[1], 10);
    const type = m[2].toUpperCase();
    out.set(id, { id, type, args: m[3] });
  }
  return out;
};

// Split a STEP arg string into its top-level tokens — respect nested
// parentheses, single-quoted strings (with '' escapes) and escape
// commas inside quotes.
const splitArgs = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      current += ch;
      if (ch === "'") {
        if (s[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

const refId = (token: string): number | null => {
  const m = token.match(/^#(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
};

const inlineRefs = (token: string): number[] => {
  // Tokens like (#12,#13,#14)
  const t = token.replace(/^\(/, '').replace(/\)$/, '');
  if (!t.trim()) return [];
  return t
    .split(',')
    .map((s) => refId(s.trim()))
    .filter((n): n is number => n !== null);
};

const stripStr = (token: string): string => {
  const m = token.match(/^'([\s\S]*)'$/);
  if (!m) return '';
  return m[1].replace(/''/g, "'");
};

// Resolve an IfcCartesianPoint or list-of-coords to a 2D point
const cartesianPoint = (
  records: Map<number, IfcRecord>,
  id: number,
): Vec2 | null => {
  const r = records.get(id);
  if (!r || r.type !== 'IFCCARTESIANPOINT') return null;
  const args = splitArgs(r.args);
  // First arg is the coordinates list
  const coords = args[0]?.replace(/^\(/, '').replace(/\)$/, '');
  if (!coords) return null;
  const parts = coords.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1] };
};

// Walk an IfcLocalPlacement chain and accumulate the global offset.
const placementOrigin = (
  records: Map<number, IfcRecord>,
  id: number,
): Vec2 => {
  let offset: Vec2 = { x: 0, y: 0 };
  let cursor: number | null = id;
  let safety = 16;
  while (cursor && safety-- > 0) {
    const r = records.get(cursor);
    if (!r || r.type !== 'IFCLOCALPLACEMENT') break;
    const args = splitArgs(r.args);
    const placementRel = args[0];
    const ax3Ref = refId(args[1] ?? '');
    if (ax3Ref !== null) {
      const ax3 = records.get(ax3Ref);
      if (ax3 && ax3.type === 'IFCAXIS2PLACEMENT3D') {
        const a3args = splitArgs(ax3.args);
        const pRef = refId(a3args[0] ?? '');
        if (pRef !== null) {
          const p = cartesianPoint(records, pRef);
          if (p) {
            offset = { x: offset.x + p.x, y: offset.y + p.y };
          }
        }
      }
    }
    const next = refId(placementRel ?? '');
    if (next === null) break;
    cursor = next;
  }
  return offset;
};

// Try to extract a polyline from a product's representation. We look
// for IfcShapeRepresentation → first item → IfcPolyline points.
const productPolyline = (
  records: Map<number, IfcRecord>,
  shapeId: number,
): Vec2[] => {
  const shape = records.get(shapeId);
  if (!shape || shape.type !== 'IFCPRODUCTDEFINITIONSHAPE') return [];
  const sArgs = splitArgs(shape.args);
  // 3rd arg is a list of representations
  const repRefs = inlineRefs(sArgs[2] ?? '()');
  for (const repId of repRefs) {
    const rep = records.get(repId);
    if (!rep || rep.type !== 'IFCSHAPEREPRESENTATION') continue;
    const rArgs = splitArgs(rep.args);
    // 4th arg is the items list
    const itemRefs = inlineRefs(rArgs[3] ?? '()');
    for (const iref of itemRefs) {
      const it = records.get(iref);
      if (!it) continue;
      if (it.type === 'IFCPOLYLINE') {
        const iArgs = splitArgs(it.args);
        const ptRefs = inlineRefs(iArgs[0] ?? '()');
        const pts: Vec2[] = [];
        for (const pid of ptRefs) {
          const p = cartesianPoint(records, pid);
          if (p) pts.push(p);
        }
        if (pts.length >= 2) return pts;
      }
    }
  }
  return [];
};

const handleIfcWall = (
  records: Map<number, IfcRecord>,
  r: IfcRecord,
  layerId: string,
): WallEntity | null => {
  const args = splitArgs(r.args);
  const placementRef = refId(args[5] ?? '');
  const shapeRef = refId(args[6] ?? '');
  if (placementRef === null || shapeRef === null) return null;
  const origin = placementOrigin(records, placementRef);
  const localPts = productPolyline(records, shapeRef);
  if (localPts.length < 2) return null;
  const points = localPts.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
  return {
    id: nanoid(),
    kind: 'wall',
    layerId,
    visible: true,
    locked: true,
    points,
    thickness: 100,
    construction: 'masonry',
  };
};

const handleIfcSlab = (
  records: Map<number, IfcRecord>,
  r: IfcRecord,
  layerId: string,
): UnderlayEntity | null => {
  // We don't model slabs natively; render the polyline as locked underlay
  const args = splitArgs(r.args);
  const placementRef = refId(args[5] ?? '');
  const shapeRef = refId(args[6] ?? '');
  if (placementRef === null || shapeRef === null) return null;
  const origin = placementOrigin(records, placementRef);
  const local = productPolyline(records, shapeRef);
  if (local.length < 2) return null;
  const points = local.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const vectors: { a: Vec2; b: Vec2; color?: string }[] = [];
  for (let i = 1; i < points.length; i++) {
    vectors.push({
      a: { x: points[i - 1].x - minX, y: points[i - 1].y - minY },
      b: { x: points[i].x - minX, y: points[i].y - minY },
      color: '#7a8aa6',
    });
  }
  return {
    id: nanoid(),
    kind: 'underlay',
    layerId,
    visible: true,
    locked: true,
    underlayLocked: true,
    opacity: 0.4,
    origin: { x: minX, y: minY },
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    vectors,
    sourceName: 'imported.ifc-slab',
  };
};

const handleIfcSpace = (
  records: Map<number, IfcRecord>,
  r: IfcRecord,
  layerId: string,
): RoomEntity | null => {
  const args = splitArgs(r.args);
  const name = stripStr(args[2] ?? "''");
  const placementRef = refId(args[5] ?? '');
  const shapeRef = refId(args[6] ?? '');
  if (placementRef === null || shapeRef === null) return null;
  const origin = placementOrigin(records, placementRef);
  const local = productPolyline(records, shapeRef);
  if (local.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of local) {
    const x = p.x + origin.x;
    const y = p.y + origin.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    id: nanoid(),
    kind: 'room',
    layerId,
    visible: true,
    locked: false,
    a: { x: minX, y: minY },
    b: { x: maxX, y: maxY },
    name: name || 'Space',
  };
};

export const importIFC = (text: string): ImportResult => {
  const result: ImportResult = { entities: [], warnings: [] };
  if (!text || !text.includes('ISO-10303-21')) {
    result.warnings.push('IFC: not a STEP file (missing ISO-10303-21 tag).');
    return result;
  }
  if (!text.includes('IFC4') && !text.includes('IFC2X3')) {
    result.warnings.push(
      'IFC: schema not declared as IFC4/IFC2X3 — attempting parse anyway.',
    );
  }
  const records = parseRecords(text);
  if (records.size === 0) {
    result.warnings.push('IFC: no entity records detected.');
    return result;
  }
  const layerId = 'underlay';
  for (const r of records.values()) {
    try {
      if (r.type === 'IFCWALL' || r.type === 'IFCWALLSTANDARDCASE') {
        const w = handleIfcWall(records, r, layerId);
        if (w) result.entities.push(w);
        else result.warnings.push(`IFC: wall #${r.id} — no usable geometry`);
      } else if (r.type === 'IFCSLAB') {
        const s = handleIfcSlab(records, r, layerId);
        if (s) result.entities.push(s);
      } else if (r.type === 'IFCSPACE') {
        const sp = handleIfcSpace(records, r, layerId);
        if (sp) result.entities.push(sp);
      }
    } catch (err) {
      result.warnings.push(
        `IFC: parse error on #${r.id} (${r.type}): ${(err as Error).message}`,
      );
    }
  }
  if (result.entities.length === 0) {
    result.warnings.push(
      'IFC: no IfcWall, IfcSlab or IfcSpace records produced geometry — file may use unsupported representations (extruded solids, BReps).',
    );
  }
  return result;
};
