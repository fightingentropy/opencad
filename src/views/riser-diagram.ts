// Riser diagram — a non-to-scale schematic of vertical distribution
// through a building.  Floors render as horizontal lines at their FFL
// elevations; risers (vertical containment) render as vertical bars
// connecting the floors they span; equipment (distribution boards,
// MCCs, panels) is annotated at each floor; cables route between
// boards on the diagram.

import { nanoid } from 'nanoid';
import type {
  Entity,
  EquipmentEntity,
  LineEntity,
  Project,
  RectangleEntity,
  RiserEntity,
  TextEntity,
  Vec2,
} from '../types';

const LAYER_ANN = 'Annotation';
const LAYER_CONT = 'Containment';
const LAYER_PANEL = 'Panel Layout';

const newId = () => nanoid(10);

export interface RiserDiagramOpts {
  project: Project;
  buildingId: string;
  // Origin in mm on the destination sheet (defaults to (50, 50)).
  originX?: number;
  originY?: number;
  // Width allocated for the diagram (mm). Defaults to 400.
  diagramWidth?: number;
  // Vertical scale: pixels(mm) per metre of real elevation. The
  // diagram is intentionally schematic rather than to-scale, so we
  // compress the elevation axis so a 60m tower fits on an A1 sheet.
  elevationScale?: number;
}

export const generateRiserDiagram = (opts: RiserDiagramOpts): Entity[] => {
  const { project, buildingId } = opts;
  const ox = opts.originX ?? 50;
  const oy = opts.originY ?? 50;
  const dw = opts.diagramWidth ?? 400;
  // Default: 1 mm of diagram for every 25 mm of real elevation —
  // i.e. compress 25:1 so floor-to-floor heights of ~3500mm become
  // ~140 mm on the sheet.
  const elScale = opts.elevationScale ?? 1 / 25;

  const out: Entity[] = [];

  const building = project.buildings?.[buildingId];
  if (!building) return out;

  // Resolve floors in the building, ordered low-to-high for drawing.
  const floors = (building.floorOrder ?? [])
    .map((fid) => project.floors?.[fid])
    .filter((f): f is NonNullable<typeof f> => !!f)
    .sort((a, b) => a.ffl - b.ffl);
  if (floors.length === 0) return out;

  // Convert real FFL (mm) → diagram-local Y (mm). Anchor lowest floor
  // at y = 0 so we don't waste sheet space below the basement.
  const baseFFL = floors[0].ffl;
  const yFor = (ffl: number) => oy + (ffl - baseFFL) * elScale;

  // ---------- Floor lines ------------------------------------------
  for (const f of floors) {
    const y = yFor(f.ffl);
    out.push(line(ox, y, ox + dw, y));
    out.push(text(f.name, ox - 5, y + 3, 'right', 3));
    out.push(
      text(
        `FFL +${f.ffl}mm`,
        ox + dw + 5,
        y + 3,
        'left',
        2.4,
      ),
    );
  }

  // ---------- Risers ----------------------------------------------
  // Risers are vertical bars between the from/to floors. Stack them
  // horizontally with even spacing inside the diagram width.
  const risers: RiserEntity[] = [];
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    if (sheet.buildingId && sheet.buildingId !== buildingId) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e?.kind === 'riser') risers.push(e as RiserEntity);
    }
  }

  // Slot the risers across the diagram width.
  const slotCount = Math.max(1, risers.length);
  const slotW = dw / (slotCount + 1);
  for (let i = 0; i < risers.length; i++) {
    const r = risers[i];
    const cx = ox + slotW * (i + 1);
    let yFrom: number;
    let yTo: number;
    if (r.fromFloorId && r.toFloorId) {
      const f1 = project.floors?.[r.fromFloorId];
      const f2 = project.floors?.[r.toFloorId];
      yFrom = yFor(f1?.ffl ?? floors[0].ffl);
      yTo = yFor(f2?.ffl ?? floors[floors.length - 1].ffl);
    } else if (r.fromElevation !== undefined && r.toElevation !== undefined) {
      yFrom = yFor(r.fromElevation);
      yTo = yFor(r.toElevation);
    } else {
      yFrom = yFor(floors[0].ffl);
      yTo = yFor(floors[floors.length - 1].ffl);
    }
    const y0 = Math.min(yFrom, yTo);
    const y1 = Math.max(yFrom, yTo);
    // Draw the riser as a thin vertical rectangle with a label tail.
    const halfW = 6;
    out.push(rect(cx - halfW, y0, cx + halfW, y1, LAYER_CONT));
    out.push(
      text(
        r.label ?? `${r.containmentType.toUpperCase()} R${i + 1}`,
        cx,
        y1 + 10,
        'center',
        3,
      ),
    );
  }

  // ---------- Boards on each floor ---------------------------------
  // For each floor, list distribution-board / panelboard equipment
  // along the floor line.
  for (const f of floors) {
    const boards: EquipmentEntity[] = [];
    for (const sid of project.sheetOrder) {
      const sheet = project.sheets[sid];
      if (!sheet) continue;
      if (sheet.buildingId && sheet.buildingId !== buildingId) continue;
      if (sheet.floorId && sheet.floorId !== f.id) continue;
      for (const eid of sheet.entityOrder) {
        const e = sheet.entities[eid];
        if (e?.kind !== 'equipment') continue;
        const eq = e as EquipmentEntity;
        if (
          eq.equipmentKind === 'distribution-board' ||
          eq.equipmentKind === 'panelboard' ||
          eq.equipmentKind === 'switchboard' ||
          eq.equipmentKind === 'mcc'
        ) {
          boards.push(eq);
        }
      }
    }
    const y = yFor(f.ffl);
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      // Stagger boards across the floor line.
      const x = ox + ((i + 1) * dw) / (boards.length + 1);
      out.push(rect(x - 8, y - 8, x + 8, y + 8, LAYER_PANEL));
      out.push(text(b.tag, x, y - 14, 'center', 2.6));
    }
  }

  // ---------- Cable refs between boards ----------------------------
  // Mine the project-wide cable schedule for cables whose endpoints
  // are equipment tags, and draw a dashed line between the matching
  // boards on the diagram.
  const schedule = project.cableSchedule;
  const cables = schedule
    ? schedule.cableOrder
        .map((cid) => schedule.cables[cid])
        .filter((c): c is NonNullable<typeof c> => !!c)
    : [];
  // Build tag -> {x,y} map by re-walking equipment placement above.
  const tagPositions: Record<string, Vec2> = {};
  for (const f of floors) {
    const boards: EquipmentEntity[] = [];
    for (const sid of project.sheetOrder) {
      const sheet = project.sheets[sid];
      if (!sheet) continue;
      if (sheet.buildingId && sheet.buildingId !== buildingId) continue;
      if (sheet.floorId && sheet.floorId !== f.id) continue;
      for (const eid of sheet.entityOrder) {
        const e = sheet.entities[eid];
        if (e?.kind !== 'equipment') continue;
        const eq = e as EquipmentEntity;
        if (
          eq.equipmentKind === 'distribution-board' ||
          eq.equipmentKind === 'panelboard' ||
          eq.equipmentKind === 'switchboard' ||
          eq.equipmentKind === 'mcc'
        ) {
          boards.push(eq);
        }
      }
    }
    const y = yFor(f.ffl);
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      const x = ox + ((i + 1) * dw) / (boards.length + 1);
      tagPositions[b.tag] = { x, y };
    }
  }
  for (const c of cables) {
    const fromTag = c.from;
    const toTag = c.to;
    if (!fromTag || !toTag) continue;
    const a = tagPositions[fromTag];
    const b = tagPositions[toTag];
    if (!a || !b) continue;
    const cableLine: LineEntity = {
      id: newId(),
      kind: 'line',
      layerId: LAYER_ANN,
      visible: true,
      locked: false,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      lineDash: [4, 2],
    };
    out.push(cableLine);
    if (c.reference) {
      out.push(
        text(
          c.reference,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2 + 3,
          'center',
          2.0,
        ),
      );
    }
  }

  // ---------- Title ------------------------------------------------
  const top = yFor(floors[floors.length - 1].ffl);
  out.push(
    text(
      `RISER DIAGRAM — ${building.name}`,
      ox + dw / 2,
      top + 60,
      'center',
      6,
    ),
  );

  return out;
};

// --- helpers --------------------------------------------------------------

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layerId: string = LAYER_ANN,
): RectangleEntity => ({
  id: newId(),
  kind: 'rectangle',
  layerId,
  visible: true,
  locked: false,
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});

const line = (x0: number, y0: number, x1: number, y1: number): Entity => ({
  id: newId(),
  kind: 'line',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});

const text = (
  s: string,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right' = 'left',
  size = 3,
): TextEntity => ({
  id: newId(),
  kind: 'text',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  position: { x, y },
  text: s,
  fontSize: size,
  rotation: 0,
  align,
});
