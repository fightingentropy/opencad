import type {
  Vec2,
  Entity,
  ToolId,
  EntityId,
  ContainmentType,
  EquipmentEntity,
  SupportEntity,
  LeaderEntity,
  LevelMarkerEntity,
  NorthArrowEntity,
  ScaleBarEntity,
} from '../types';
import { newEntityId } from '../state/store';
import { orthoConstrain, distToSegment } from '../lib/math';
import { useStore } from '../state/store';

// Default cross-section dimensions per containment type (mm).
// width × height for rectangular sections; conduit uses width as diameter.
export const CONTAINMENT_DEFAULTS: Record<
  ContainmentType,
  { width: number; height: number }
> = {
  trunking: { width: 100, height: 75 },
  basket: { width: 100, height: 50 },
  tray: { width: 150, height: 50 },
  conduit: { width: 25, height: 25 },
  ladder: { width: 300, height: 100 },
  duct: { width: 110, height: 110 },
  busbar: { width: 100, height: 50 },
};

// ToolIds that map directly onto a containment placement tool. Subset of
// ContainmentType — busbar/duct don't get a draw tool yet (placed via dialog).
const CONTAINMENT_TOOLS: ContainmentType[] = ['trunking', 'basket', 'tray', 'conduit', 'ladder'];
const isContainmentTool = (t: ToolId): t is Extract<ContainmentType, ToolId> =>
  (CONTAINMENT_TOOLS as string[]).includes(t);

export type DraftPoints = Vec2[];

export interface ToolContext {
  layerId: string;
  draft: DraftPoints;
  cursor: Vec2;
  ortho: boolean;
  pendingSymbol: string | null;
}

// A tool returns:
// - committed: entities to add to the project
// - newDraft: updated draft points (or null to end drafting)
// Returning { committed: [], newDraft: [..pts] } means "still drafting"
// Returning { committed: [...], newDraft: null } means "finished, commit"
export interface ToolResult {
  committed: Entity[];
  newDraft: DraftPoints | null;
  // tool can request a status message
  status?: string;
}

const constrainedPoint = (last: Vec2 | undefined, p: Vec2, ortho: boolean): Vec2 =>
  last && ortho ? orthoConstrain(last, p) : p;

// Auto-generate the next sequential equipment tag (EQ-001, EQ-002, …) by
// scanning all sheets for existing EquipmentEntity tags.
const nextEquipmentTag = (): string => {
  const project = useStore.getState().project;
  let highest = 0;
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e || e.kind !== 'equipment') continue;
      const m = /^EQ-(\d+)$/.exec(e.tag);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }
  }
  return `EQ-${String(highest + 1).padStart(3, '0')}`;
};

// Find the nearest containment to a point on the active sheet, returning
// the id only when within `maxDistance` mm of any of its segments.
const nearestContainmentId = (cursor: Vec2, maxDistance: number): EntityId | null => {
  const project = useStore.getState().project;
  const sheet = project.sheets[project.activeSheetId];
  if (!sheet) return null;
  let bestId: EntityId | null = null;
  let bestDist = maxDistance;
  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (!e || e.kind !== 'containment') continue;
    for (let i = 0; i < e.points.length - 1; i++) {
      const d = distToSegment(cursor, e.points[i], e.points[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
  }
  return bestId;
};

// onClick: called when user clicks/taps to commit a point.
export const onToolClick = (tool: ToolId, ctx: ToolContext): ToolResult => {
  const cursor = constrainedPoint(ctx.draft[ctx.draft.length - 1], ctx.cursor, ctx.ortho);
  switch (tool) {
    case 'line':
      if (ctx.draft.length === 0) return { committed: [], newDraft: [cursor], status: 'Line: pick endpoint' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'line',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            a: ctx.draft[0],
            b: cursor,
          },
        ],
        newDraft: [cursor], // continue from end (LINE chain like AutoCAD)
        status: 'Line: pick next endpoint or Esc to finish',
      };
    case 'rectangle':
      if (ctx.draft.length === 0) return { committed: [], newDraft: [cursor], status: 'Rectangle: pick second corner' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'rectangle',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            a: ctx.draft[0],
            b: cursor,
          },
        ],
        newDraft: null,
      };
    case 'circle':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Circle: pick radius point' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'circle',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            center: ctx.draft[0],
            radius: Math.hypot(cursor.x - ctx.draft[0].x, cursor.y - ctx.draft[0].y),
          },
        ],
        newDraft: null,
      };
    case 'arc':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Arc: pick start point' };
      if (ctx.draft.length === 1)
        return { committed: [], newDraft: [...ctx.draft, cursor], status: 'Arc: pick end angle' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'arc',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            center: ctx.draft[0],
            radius: Math.hypot(ctx.draft[1].x - ctx.draft[0].x, ctx.draft[1].y - ctx.draft[0].y),
            startAngle: Math.atan2(ctx.draft[1].y - ctx.draft[0].y, ctx.draft[1].x - ctx.draft[0].x),
            endAngle: Math.atan2(cursor.y - ctx.draft[0].y, cursor.x - ctx.draft[0].x),
          },
        ],
        newDraft: null,
      };
    case 'polyline':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Polyline: pick next vertex' };
      return { committed: [], newDraft: [...ctx.draft, cursor], status: 'Polyline: pick next vertex (Enter to finish)' };
    case 'wire':
      if (ctx.draft.length === 0) return { committed: [], newDraft: [cursor], status: 'Wire: pick next vertex' };
      return { committed: [], newDraft: [...ctx.draft, cursor], status: 'Wire: pick next vertex (Enter/right-click to finish)' };
    case 'bus':
      if (ctx.draft.length === 0) return { committed: [], newDraft: [cursor], status: 'Bus: pick next vertex' };
      return { committed: [], newDraft: [...ctx.draft, cursor], status: 'Bus: pick next vertex' };
    case 'dimension':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Dimension: pick second point' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'dimension',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            a: ctx.draft[0],
            b: cursor,
            offset: 12,
          },
        ],
        newDraft: null,
      };
    case 'measure':
      if (ctx.draft.length === 0) return { committed: [], newDraft: [cursor], status: 'Measure: pick second point' };
      return { committed: [], newDraft: null };
    case 'trunking':
    case 'basket':
    case 'tray':
    case 'conduit':
    case 'ladder': {
      const label = tool[0].toUpperCase() + tool.slice(1);
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: `${label}: pick next vertex` };
      return {
        committed: [],
        newDraft: [...ctx.draft, cursor],
        status: `${label}: pick next vertex (Enter/right-click to finish)`,
      };
    }
    case 'wall':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Wall: pick next vertex' };
      return {
        committed: [],
        newDraft: [...ctx.draft, cursor],
        status: 'Wall: pick next vertex (Enter/right-click to finish)',
      };
    case 'room':
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Room: pick second corner' };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'room',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            a: ctx.draft[0],
            b: cursor,
          },
        ],
        newDraft: null,
      };
    case 'symbol':
      if (!ctx.pendingSymbol) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'symbol',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            symbolId: ctx.pendingSymbol,
            position: cursor,
            rotation: 0,
            scale: 1,
            mirror: false,
          },
        ],
        newDraft: null,
        status: 'Symbol placed — pick next location or change tool',
      };
    case 'text':
      // text gets created inline via a prompt
      return { committed: [], newDraft: null };
    case 'equipment': {
      // 2-click rectangle placement
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Equipment: pick second corner' };
      const equipment: EquipmentEntity = {
        id: newEntityId(),
        kind: 'equipment',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        equipmentKind: 'distribution-board',
        a: ctx.draft[0],
        b: cursor,
        tag: nextEquipmentTag(),
        height: 1800,
      };
      return {
        committed: [equipment],
        newDraft: null,
        status: `Equipment ${equipment.tag} placed`,
      };
    }
    case 'support': {
      // single-click placement; auto-attach to nearest containment within 500mm
      const nearestId = nearestContainmentId(cursor, 500);
      const support: SupportEntity = {
        id: newEntityId(),
        kind: 'support',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        supportKind: 'trapeze-hanger',
        position: cursor,
        rotation: 0,
        supportingContainmentIds: nearestId ? [nearestId] : [],
        autoGenerated: false,
      };
      return {
        committed: [support],
        newDraft: null,
        status: nearestId
          ? 'Support placed and linked to nearest containment'
          : 'Support placed (no containment within 500mm)',
      };
    }
    case 'leader': {
      // 3-click sequence: tip → elbow → text anchor
      if (ctx.draft.length === 0)
        return { committed: [], newDraft: [cursor], status: 'Leader: pick elbow' };
      if (ctx.draft.length === 1)
        return { committed: [], newDraft: [...ctx.draft, cursor], status: 'Leader: pick text anchor' };
      const leader: LeaderEntity = {
        id: newEntityId(),
        kind: 'leader',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        points: [...ctx.draft, cursor],
        text: 'Leader',
        arrowStyle: 'arrow',
      };
      return { committed: [leader], newDraft: null, status: 'Leader placed' };
    }
    case 'level-marker': {
      const marker: LevelMarkerEntity = {
        id: newEntityId(),
        kind: 'level-marker',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        position: cursor,
        elevation: 0,
        label: '+0 FFL',
      };
      return { committed: [marker], newDraft: null, status: 'Level marker placed' };
    }
    case 'north-arrow': {
      const arrow: NorthArrowEntity = {
        id: newEntityId(),
        kind: 'north-arrow',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        position: cursor,
        size: 200,
        northAngle: 0,
      };
      return { committed: [arrow], newDraft: null, status: 'North arrow placed' };
    }
    case 'scale-bar': {
      const bar: ScaleBarEntity = {
        id: newEntityId(),
        kind: 'scale-bar',
        layerId: ctx.layerId,
        visible: true,
        locked: false,
        position: cursor,
        segmentLength: 1000,
        segments: 5,
        scale: 50,
      };
      return { committed: [bar], newDraft: null, status: 'Scale bar placed' };
    }
    default:
      return { committed: [], newDraft: null };
  }
};

// onCommit: triggered by Enter / right-click, finishes a multi-vertex draft
export const onToolCommit = (tool: ToolId, ctx: ToolContext): ToolResult => {
  switch (tool) {
    case 'polyline':
      if (ctx.draft.length < 2) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'polyline',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            points: ctx.draft.slice(),
            closed: false,
          },
        ],
        newDraft: null,
      };
    case 'wire':
      if (ctx.draft.length < 2) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'wire',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            points: ctx.draft.slice(),
          },
        ],
        newDraft: null,
      };
    case 'bus':
      if (ctx.draft.length < 2) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'bus',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            points: ctx.draft.slice(),
          },
        ],
        newDraft: null,
      };
    case 'wall':
      if (ctx.draft.length < 2) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'wall',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            points: ctx.draft.slice(),
            thickness: 200,
            height: 3000,
          },
        ],
        newDraft: null,
      };
    case 'leader':
      // Allow Enter / right-click to commit a leader with the points so far
      // (minimum 2 points: tip + elbow; the text anchor falls back to elbow).
      if (ctx.draft.length < 2) return { committed: [], newDraft: null };
      return {
        committed: [
          {
            id: newEntityId(),
            kind: 'leader',
            layerId: ctx.layerId,
            visible: true,
            locked: false,
            points: ctx.draft.slice(),
            text: 'Leader',
            arrowStyle: 'arrow',
          } satisfies LeaderEntity,
        ],
        newDraft: null,
      };
    default:
      if (isContainmentTool(tool)) {
        if (ctx.draft.length < 2) return { committed: [], newDraft: null };
        const defaults = CONTAINMENT_DEFAULTS[tool];
        return {
          committed: [
            {
              id: newEntityId(),
              kind: 'containment',
              containmentType: tool,
              layerId: ctx.layerId,
              visible: true,
              locked: false,
              points: ctx.draft.slice(),
              width: defaults.width,
              height: defaults.height,
            },
          ],
          newDraft: null,
        };
      }
      return { committed: [], newDraft: null };
  }
};
