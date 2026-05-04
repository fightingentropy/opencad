import type { Vec2, Entity, ToolId, EntityId, ContainmentType } from '../types';
import { newEntityId } from '../state/store';
import { orthoConstrain } from '../lib/math';

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
    case 'conduit': {
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
