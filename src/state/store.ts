import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  Bounds,
  Project,
  EditorState,
  Entity,
  EntityId,
  Layer,
  LayerId,
  Sheet,
  SheetId,
  SnapKind,
  ToolId,
  Vec2,
  Viewport,
} from '../types';

const newId = () => nanoid(10);

// Cap the undo stack so a long editing session doesn't grow without bound.
// 50 keeps memory predictable while still spanning a meaningful history.
const MAX_HISTORY = 50;

// Cap the camera-position history (Alt+←/Alt+→). 30 is plenty — this is
// browser-style "zoom previous" navigation, not a long task list.
const MAX_VIEW_HISTORY = 30;

const viewportsEqual = (a: Viewport, b: Viewport): boolean =>
  Math.abs(a.x - b.x) < 0.01 &&
  Math.abs(a.y - b.y) < 0.01 &&
  Math.abs(a.zoom - b.zoom) < 0.0001;

const pushPast = (past: Project[], project: Project): Project[] => {
  const next = past.length >= MAX_HISTORY ? past.slice(past.length - MAX_HISTORY + 1) : past.slice();
  next.push(cloneProject(project));
  return next;
};

const moveEntityDeep = (e: Entity, dx: number, dy: number): Entity => {
  const cp: any = structuredClone(e);
  if (cp.a) cp.a = { x: cp.a.x + dx, y: cp.a.y + dy };
  if (cp.b) cp.b = { x: cp.b.x + dx, y: cp.b.y + dy };
  if (cp.center) cp.center = { x: cp.center.x + dx, y: cp.center.y + dy };
  if (cp.position) cp.position = { x: cp.position.x + dx, y: cp.position.y + dy };
  if (cp.points) cp.points = cp.points.map((p: Vec2) => ({ x: p.x + dx, y: p.y + dy }));
  return cp;
};

const entityCentroid = (e: Entity): Vec2 | null => {
  const anyE = e as any;
  if (anyE.position) return { x: anyE.position.x, y: anyE.position.y };
  if (anyE.center) return { x: anyE.center.x, y: anyE.center.y };
  if (anyE.a && anyE.b) return { x: (anyE.a.x + anyE.b.x) / 2, y: (anyE.a.y + anyE.b.y) / 2 };
  if (anyE.points && anyE.points.length > 0) {
    let sx = 0, sy = 0;
    for (const p of anyE.points) { sx += p.x; sy += p.y; }
    return { x: sx / anyE.points.length, y: sy / anyE.points.length };
  }
  return null;
};

const entityBounds = (e: Entity): Bounds | null => {
  switch (e.kind) {
    case 'line':
    case 'rectangle':
    case 'dimension':
    case 'room':
      return {
        minX: Math.min(e.a.x, e.b.x),
        minY: Math.min(e.a.y, e.b.y),
        maxX: Math.max(e.a.x, e.b.x),
        maxY: Math.max(e.a.y, e.b.y),
      };
    case 'circle':
      return {
        minX: e.center.x - e.radius,
        minY: e.center.y - e.radius,
        maxX: e.center.x + e.radius,
        maxY: e.center.y + e.radius,
      };
    case 'arc':
      return {
        minX: e.center.x - e.radius,
        minY: e.center.y - e.radius,
        maxX: e.center.x + e.radius,
        maxY: e.center.y + e.radius,
      };
    case 'ellipse':
      return {
        minX: e.center.x - e.rx,
        minY: e.center.y - e.ry,
        maxX: e.center.x + e.rx,
        maxY: e.center.y + e.ry,
      };
    case 'polyline':
    case 'wire':
    case 'bus':
    case 'containment':
    case 'wall': {
      if (e.points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of e.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'text':
    case 'wire-label':
      return { minX: e.position.x, minY: e.position.y, maxX: e.position.x, maxY: e.position.y };
    case 'symbol':
      return { minX: e.position.x, minY: e.position.y, maxX: e.position.x, maxY: e.position.y };
    case 'group':
      return null;
  }
};

const reflectEntity = (e: Entity, axis: 'horizontal' | 'vertical', center: number): Entity => {
  const cp: any = structuredClone(e);
  if (axis === 'horizontal') {
    const rx = (v: number) => 2 * center - v;
    if (cp.a) cp.a = { ...cp.a, x: rx(cp.a.x) };
    if (cp.b) cp.b = { ...cp.b, x: rx(cp.b.x) };
    if (cp.center) cp.center = { ...cp.center, x: rx(cp.center.x) };
    if (cp.position) cp.position = { ...cp.position, x: rx(cp.position.x) };
    if (cp.points) cp.points = cp.points.map((p: Vec2) => ({ ...p, x: rx(p.x) }));
  } else {
    const ry = (v: number) => 2 * center - v;
    if (cp.a) cp.a = { ...cp.a, y: ry(cp.a.y) };
    if (cp.b) cp.b = { ...cp.b, y: ry(cp.b.y) };
    if (cp.center) cp.center = { ...cp.center, y: ry(cp.center.y) };
    if (cp.position) cp.position = { ...cp.position, y: ry(cp.position.y) };
    if (cp.points) cp.points = cp.points.map((p: Vec2) => ({ ...p, y: ry(p.y) }));
  }
  return cp;
};

const defaultLayers = (): { layers: Record<LayerId, Layer>; layerOrder: LayerId[]; defaultId: LayerId } => {
  const wireId = newId();
  const symId = newId();
  const wireLabelId = newId();
  const dimId = newId();
  const textId = newId();
  const panelId = newId();
  const containmentId = newId();
  const wallId = newId();
  const roomId = newId();
  const sketchId = newId();
  const layers: Record<LayerId, Layer> = {
    [wireId]: { id: wireId, name: 'Wires', color: '#ff3a3a', visible: true, locked: false, lineWidth: 0.6 },
    [symId]: { id: symId, name: 'Symbols', color: '#e6e6e6', visible: true, locked: false, lineWidth: 0.5 },
    [wireLabelId]: { id: wireLabelId, name: 'Wire Labels', color: '#ffd84d', visible: true, locked: false, lineWidth: 0.4 },
    [dimId]: { id: dimId, name: 'Dimensions', color: '#5cdcff', visible: true, locked: false, lineWidth: 0.3 },
    [textId]: { id: textId, name: 'Annotation', color: '#9ad65a', visible: true, locked: false, lineWidth: 0.4 },
    [panelId]: { id: panelId, name: 'Panel Layout', color: '#bb8cff', visible: true, locked: false, lineWidth: 0.5 },
    [containmentId]: { id: containmentId, name: 'Containment', color: '#5cdcff', visible: true, locked: false, lineWidth: 0.6 },
    [wallId]: { id: wallId, name: 'Walls', color: '#a8aab0', visible: true, locked: false, lineWidth: 0.8 },
    [roomId]: { id: roomId, name: 'Rooms', color: '#7a8593', visible: true, locked: false, lineWidth: 0.3 },
    [sketchId]: { id: sketchId, name: 'Construction', color: '#5d6473', visible: true, locked: false, lineWidth: 0.3, lineDash: [4, 4] },
  };
  return {
    layers,
    layerOrder: [wireId, symId, wireLabelId, dimId, textId, panelId, containmentId, wallId, roomId, sketchId],
    defaultId: symId,
  };
};

const defaultSheets = (): { sheets: Record<SheetId, Sheet>; sheetOrder: SheetId[]; activeSheetId: SheetId } => {
  const s1: Sheet = {
    id: newId(),
    name: 'Power Schematic',
    number: '001',
    kind: 'schematic',
    width: 432,
    height: 279,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
  };
  const s2: Sheet = {
    id: newId(),
    name: 'Control Schematic',
    number: '002',
    kind: 'schematic',
    width: 432,
    height: 279,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
  };
  const s3: Sheet = {
    id: newId(),
    name: 'Panel Layout',
    number: '003',
    kind: 'panel-layout',
    width: 600,
    height: 800,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
  };
  const s4: Sheet = {
    id: newId(),
    name: 'One Line Diagram',
    number: '004',
    kind: 'one-line',
    width: 432,
    height: 279,
    entities: {},
    entityOrder: [],
    background: '#0a0e14',
  };
  return {
    sheets: { [s1.id]: s1, [s2.id]: s2, [s3.id]: s3, [s4.id]: s4 },
    sheetOrder: [s1.id, s2.id, s3.id, s4.id],
    activeSheetId: s1.id,
  };
};

export const createEmptyProject = (): Project => {
  const { layers, layerOrder, defaultId } = defaultLayers();
  const { sheets, sheetOrder, activeSheetId } = defaultSheets();
  return {
    id: newId(),
    name: 'Untitled Project',
    description: '',
    client: '',
    engineer: '',
    created: Date.now(),
    modified: Date.now(),
    layers,
    layerOrder,
    sheets,
    sheetOrder,
    activeSheetId,
    activeLayerId: defaultId,
    units: 'mm',
    standard: 'IEEE',
  };
};

const initialEditor = (): EditorState => ({
  tool: 'select',
  selection: new Set(),
  hover: null,
  viewport: { x: 216, y: 140, zoom: 2 },
  snap: {
    enabled: true,
    grid: true,
    osnap: true,
    endpoint: true,
    midpoint: true,
    intersection: true,
    perpendicular: false,
    pin: true,
    gridSize: 5,
  },
  drafting: null,
  pendingSymbol: null,
  cursor: { x: 0, y: 0 },
  cursorSnap: null,
  cursorSnapKind: 'none' as const,
  ortho: false,
  viewMode: '2d',
  commandHistory: [],
  statusMessage: 'Welcome to OpenCAD Electrical',
});

const initialViewHistory = (v: Viewport): { stack: Viewport[]; index: number } => ({
  stack: [v],
  index: 0,
});

interface Store {
  project: Project;
  editor: EditorState;
  // History
  past: Project[];
  future: Project[];
  // Clipboard for copy/paste between selections
  clipboard: Entity[];
  // Viewport navigation history (Alt+←/Alt+→)
  viewHistory: { stack: Viewport[]; index: number };
  // Wire auto-routing toggle
  autoRoute: boolean;

  // Arrange actions
  alignEntities: (axis: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;
  distributeEntities: (axis: 'horizontal' | 'vertical') => void;
  flipEntities: (axis: 'horizontal' | 'vertical') => void;

  // Project actions
  setProject: (p: Project) => void;
  resetProject: () => void;

  // Sheet
  setActiveSheet: (id: SheetId) => void;
  addSheet: (sheet: Partial<Sheet>) => void;
  removeSheet: (id: SheetId) => void;
  renameSheet: (id: SheetId, name: string) => void;

  // Layer
  setActiveLayer: (id: LayerId) => void;
  addLayer: (layer: Partial<Layer>) => void;
  updateLayer: (id: LayerId, patch: Partial<Layer>) => void;
  removeLayer: (id: LayerId) => void;
  toggleLayerVisible: (id: LayerId) => void;
  toggleLayerLocked: (id: LayerId) => void;

  // Entity
  addEntity: (e: Entity) => void;
  addEntities: (es: Entity[]) => void;
  updateEntity: (id: EntityId, patch: Partial<Entity>) => void;
  removeEntity: (id: EntityId) => void;
  removeEntities: (ids: EntityId[]) => void;

  // Editor
  setTool: (t: ToolId) => void;
  setViewport: (v: Viewport) => void;
  setCursor: (c: Vec2, snap: Vec2 | null, snapKind?: SnapKind) => void;
  setSelection: (ids: EntityId[]) => void;
  addToSelection: (ids: EntityId[]) => void;
  toggleInSelection: (id: EntityId) => void;
  clearSelection: () => void;
  setHover: (id: EntityId | null) => void;
  setDrafting: (d: EditorState['drafting']) => void;
  setPendingSymbol: (id: string | null) => void;
  setOrtho: (b: boolean) => void;
  setViewMode: (m: '2d' | 'split' | '3d') => void;
  setStatus: (s: string) => void;
  setSnap: (s: Partial<EditorState['snap']>) => void;

  // History
  beginUndo: () => void;
  undo: () => void;
  redo: () => void;

  // Clipboard
  copySelection: () => void;
  pasteFromClipboard: (anchor?: Vec2) => void;
  duplicateSelection: () => void;

  // View history
  recordView: () => void;
  viewBack: () => void;
  viewForward: () => void;

  // Wire auto-route
  setAutoRoute: (on: boolean) => void;
}

const cloneProject = (p: Project): Project => {
  // Shallow clone with re-cloned sheets/entities so undo snapshots are independent
  const sheets: Record<SheetId, Sheet> = {};
  for (const sid of p.sheetOrder) {
    const s = p.sheets[sid];
    sheets[sid] = {
      ...s,
      entities: { ...s.entities },
      entityOrder: [...s.entityOrder],
    };
  }
  return {
    ...p,
    layers: { ...p.layers },
    layerOrder: [...p.layerOrder],
    sheets,
    sheetOrder: [...p.sheetOrder],
  };
};

export const useStore = create<Store>((set, get) => ({
  project: createEmptyProject(),
  editor: initialEditor(),
  past: [],
  future: [],
  clipboard: [],
  viewHistory: initialViewHistory({ x: 216, y: 140, zoom: 2 }),
  autoRoute: true,

  setProject: (p) =>
    set((s) => ({
      project: p,
      past: [],
      future: [],
      viewHistory: initialViewHistory(s.editor.viewport),
    })),
  resetProject: () =>
    set(() => {
      const ed = initialEditor();
      return {
        project: createEmptyProject(),
        editor: ed,
        past: [],
        future: [],
        clipboard: [],
        viewHistory: initialViewHistory(ed.viewport),
      };
    }),

  setActiveSheet: (id) =>
    set((s) => ({ project: { ...s.project, activeSheetId: id, modified: Date.now() } })),

  addSheet: (sheet) => {
    const { project, past } = get();
    const id = newId();
    const s: Sheet = {
      id,
      name: sheet.name ?? 'New Sheet',
      number: sheet.number ?? String(project.sheetOrder.length + 1).padStart(3, '0'),
      kind: sheet.kind ?? 'schematic',
      width: sheet.width ?? 432,
      height: sheet.height ?? 279,
      entities: {},
      entityOrder: [],
      background: sheet.background ?? '#0a0e14',
    };
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [id]: s },
        sheetOrder: [...project.sheetOrder, id],
        activeSheetId: id,
        modified: Date.now(),
      },
    });
  },

  removeSheet: (id) => {
    const { project, past } = get();
    if (project.sheetOrder.length <= 1) return;
    const sheets = { ...project.sheets };
    delete sheets[id];
    const sheetOrder = project.sheetOrder.filter((s) => s !== id);
    const activeSheetId = project.activeSheetId === id ? sheetOrder[0] : project.activeSheetId;
    set({
      past: pushPast(past, project),
      future: [],
      project: { ...project, sheets, sheetOrder, activeSheetId, modified: Date.now() },
    });
  },

  renameSheet: (id, name) => {
    const { project, past } = get();
    const sheet = project.sheets[id];
    if (!sheet) return;
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [id]: { ...sheet, name } },
        modified: Date.now(),
      },
    });
  },

  setActiveLayer: (id) => set((s) => ({ project: { ...s.project, activeLayerId: id } })),

  addLayer: (layer) => {
    const { project, past } = get();
    const id = newId();
    const l: Layer = {
      id,
      name: layer.name ?? `Layer ${project.layerOrder.length + 1}`,
      color: layer.color ?? '#cccccc',
      visible: layer.visible ?? true,
      locked: layer.locked ?? false,
      lineWidth: layer.lineWidth ?? 0.5,
      lineDash: layer.lineDash,
    };
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        layers: { ...project.layers, [id]: l },
        layerOrder: [...project.layerOrder, id],
        modified: Date.now(),
      },
    });
  },

  updateLayer: (id, patch) => {
    const { project, past } = get();
    const l = project.layers[id];
    if (!l) return;
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        layers: { ...project.layers, [id]: { ...l, ...patch } },
        modified: Date.now(),
      },
    });
  },

  removeLayer: (id) => {
    const { project, past } = get();
    if (project.layerOrder.length <= 1) return;
    const layers = { ...project.layers };
    delete layers[id];
    const layerOrder = project.layerOrder.filter((l) => l !== id);
    const activeLayerId = project.activeLayerId === id ? layerOrder[0] : project.activeLayerId;
    set({
      past: pushPast(past, project),
      future: [],
      project: { ...project, layers, layerOrder, activeLayerId, modified: Date.now() },
    });
  },

  toggleLayerVisible: (id) => {
    const { project } = get();
    const l = project.layers[id];
    if (!l) return;
    set({
      project: {
        ...project,
        layers: { ...project.layers, [id]: { ...l, visible: !l.visible } },
      },
    });
  },

  toggleLayerLocked: (id) => {
    const { project } = get();
    const l = project.layers[id];
    if (!l) return;
    set({
      project: {
        ...project,
        layers: { ...project.layers, [id]: { ...l, locked: !l.locked } },
      },
    });
  },

  addEntity: (e) => {
    const { project, past } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const updatedSheet: Sheet = {
      ...sheet,
      entities: { ...sheet.entities, [e.id]: e },
      entityOrder: [...sheet.entityOrder, e.id],
    };
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: updatedSheet },
        modified: Date.now(),
      },
    });
  },

  addEntities: (es) => {
    if (es.length === 0) return;
    const { project, past } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const entities = { ...sheet.entities };
    const order = [...sheet.entityOrder];
    for (const e of es) {
      entities[e.id] = e;
      order.push(e.id);
    }
    const updatedSheet: Sheet = { ...sheet, entities, entityOrder: order };
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: updatedSheet },
        modified: Date.now(),
      },
    });
  },

  updateEntity: (id, patch) => {
    const { project, past } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const e = sheet.entities[id];
    if (!e) return;
    const updated = { ...e, ...patch } as Entity;
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: {
          ...project.sheets,
          [sheet.id]: { ...sheet, entities: { ...sheet.entities, [id]: updated } },
        },
        modified: Date.now(),
      },
    });
  },

  removeEntity: (id) => {
    get().removeEntities([id]);
  },

  removeEntities: (ids) => {
    if (ids.length === 0) return;
    const { project, past, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const entities = { ...sheet.entities };
    for (const id of ids) delete entities[id];
    const entityOrder = sheet.entityOrder.filter((eid) => !ids.includes(eid));
    const newSel = new Set(editor.selection);
    for (const id of ids) newSel.delete(id);
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: { ...sheet, entities, entityOrder } },
        modified: Date.now(),
      },
      editor: { ...editor, selection: newSel },
    });
  },

  setTool: (t) =>
    set((s) => ({
      editor: {
        ...s.editor,
        tool: t,
        drafting: null,
        pendingSymbol: t === 'symbol' ? s.editor.pendingSymbol : null,
      },
    })),
  setViewport: (v) => set((s) => ({ editor: { ...s.editor, viewport: v } })),
  setCursor: (c, snap, snapKind) => set((s) => ({ editor: { ...s.editor, cursor: c, cursorSnap: snap, cursorSnapKind: snapKind ?? 'none' } })),
  setSelection: (ids) => set((s) => ({ editor: { ...s.editor, selection: new Set(ids) } })),
  addToSelection: (ids) =>
    set((s) => {
      const sel = new Set(s.editor.selection);
      for (const id of ids) sel.add(id);
      return { editor: { ...s.editor, selection: sel } };
    }),
  toggleInSelection: (id) =>
    set((s) => {
      const sel = new Set(s.editor.selection);
      if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      return { editor: { ...s.editor, selection: sel } };
    }),
  clearSelection: () => set((s) => ({ editor: { ...s.editor, selection: new Set() } })),
  setHover: (id) => set((s) => ({ editor: { ...s.editor, hover: id } })),
  setDrafting: (d) => set((s) => ({ editor: { ...s.editor, drafting: d } })),
  setPendingSymbol: (id) =>
    set((s) => ({
      editor: { ...s.editor, pendingSymbol: id, tool: id ? 'symbol' : s.editor.tool },
    })),
  setOrtho: (b) => set((s) => ({ editor: { ...s.editor, ortho: b } })),
  setViewMode: (m) => set((s) => ({ editor: { ...s.editor, viewMode: m } })),
  setStatus: (msg) => set((s) => ({ editor: { ...s.editor, statusMessage: msg } })),
  setSnap: (snap) => set((s) => ({ editor: { ...s.editor, snap: { ...s.editor.snap, ...snap } } })),

  beginUndo: () => {
    const { project, past } = get();
    set({ past: pushPast(past, project), future: [] });
  },

  undo: () => {
    const { project, past, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [cloneProject(project), ...future],
    });
  },

  redo: () => {
    const { project, past, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: next,
      past: pushPast(past, project),
      future: future.slice(1),
    });
  },

  copySelection: () => {
    const { project, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const ids = Array.from(editor.selection);
    if (ids.length === 0) return;
    const items: Entity[] = [];
    for (const id of ids) {
      const e = sheet.entities[id];
      if (e) items.push(structuredClone(e));
    }
    set({
      clipboard: items,
      editor: { ...editor, statusMessage: `Copied ${items.length} entit${items.length === 1 ? 'y' : 'ies'}` },
    });
  },

  pasteFromClipboard: (anchor) => {
    const { clipboard, project, past, editor } = get();
    if (clipboard.length === 0) return;
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;

    let dx = 10, dy = 10;
    if (anchor) {
      let cx = 0, cy = 0, count = 0;
      for (const e of clipboard) {
        const c = entityCentroid(e);
        if (c) { cx += c.x; cy += c.y; count++; }
      }
      if (count > 0) { cx /= count; cy /= count; dx = anchor.x - cx; dy = anchor.y - cy; }
    }

    const newEntities: Entity[] = clipboard.map((e) => {
      const moved = moveEntityDeep(e, dx, dy);
      return { ...(moved as any), id: newId() } as Entity;
    });

    const entities = { ...sheet.entities };
    const order = [...sheet.entityOrder];
    for (const e of newEntities) {
      entities[e.id] = e;
      order.push(e.id);
    }
    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: { ...sheet, entities, entityOrder: order } },
        modified: Date.now(),
      },
      editor: {
        ...editor,
        selection: new Set(newEntities.map((e) => e.id)),
        statusMessage: `Pasted ${newEntities.length} entit${newEntities.length === 1 ? 'y' : 'ies'}`,
      },
    });
  },

  duplicateSelection: () => {
    const { project, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const ids = Array.from(editor.selection);
    if (ids.length === 0) return;
    const items: Entity[] = [];
    for (const id of ids) {
      const e = sheet.entities[id];
      if (e) items.push(structuredClone(e));
    }
    if (items.length === 0) return;
    const savedClipboard = get().clipboard;
    set({ clipboard: items });
    get().pasteFromClipboard();
    set({ clipboard: savedClipboard });
  },

  recordView: () => {
    const { editor, viewHistory } = get();
    const cur = editor.viewport;
    const stack = viewHistory.stack;
    const last = stack[viewHistory.index];
    if (last && viewportsEqual(last, cur)) return;

    const truncated = stack.slice(0, viewHistory.index + 1);
    truncated.push({ ...cur });
    const overflow = truncated.length - MAX_VIEW_HISTORY;
    const finalStack = overflow > 0 ? truncated.slice(overflow) : truncated;
    set({ viewHistory: { stack: finalStack, index: finalStack.length - 1 } });
  },

  viewBack: () => {
    const { viewHistory, editor } = get();
    if (viewHistory.index <= 0) return;
    const nextIndex = viewHistory.index - 1;
    set({
      viewHistory: { ...viewHistory, index: nextIndex },
      editor: {
        ...editor,
        viewport: { ...viewHistory.stack[nextIndex] },
        statusMessage: `View ${nextIndex + 1} / ${viewHistory.stack.length}`,
      },
    });
  },

  viewForward: () => {
    const { viewHistory, editor } = get();
    if (viewHistory.index >= viewHistory.stack.length - 1) return;
    const nextIndex = viewHistory.index + 1;
    set({
      viewHistory: { ...viewHistory, index: nextIndex },
      editor: {
        ...editor,
        viewport: { ...viewHistory.stack[nextIndex] },
        statusMessage: `View ${nextIndex + 1} / ${viewHistory.stack.length}`,
      },
    });
  },

  alignEntities: (axis) => {
    const { project, past, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const ids = Array.from(editor.selection);
    if (ids.length < 2) return;

    // Collect bounds for each selected entity
    const items: { id: string; bounds: Bounds }[] = [];
    for (const id of ids) {
      const e = sheet.entities[id];
      if (!e) continue;
      const b = entityBounds(e);
      if (b) items.push({ id, bounds: b });
    }
    if (items.length < 2) return;

    // Compute target value
    let target: number;
    switch (axis) {
      case 'left':
        target = Math.min(...items.map((i) => i.bounds.minX));
        break;
      case 'right':
        target = Math.max(...items.map((i) => i.bounds.maxX));
        break;
      case 'center-h':
        target = items.reduce((s, i) => s + (i.bounds.minX + i.bounds.maxX) / 2, 0) / items.length;
        break;
      case 'top':
        target = Math.max(...items.map((i) => i.bounds.maxY));
        break;
      case 'bottom':
        target = Math.min(...items.map((i) => i.bounds.minY));
        break;
      case 'center-v':
        target = items.reduce((s, i) => s + (i.bounds.minY + i.bounds.maxY) / 2, 0) / items.length;
        break;
    }

    const entities = { ...sheet.entities };
    for (const item of items) {
      let dx = 0, dy = 0;
      switch (axis) {
        case 'left':
          dx = target - item.bounds.minX;
          break;
        case 'right':
          dx = target - item.bounds.maxX;
          break;
        case 'center-h':
          dx = target - (item.bounds.minX + item.bounds.maxX) / 2;
          break;
        case 'top':
          dy = target - item.bounds.maxY;
          break;
        case 'bottom':
          dy = target - item.bounds.minY;
          break;
        case 'center-v':
          dy = target - (item.bounds.minY + item.bounds.maxY) / 2;
          break;
      }
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        entities[item.id] = moveEntityDeep(entities[item.id], dx, dy);
      }
    }

    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: { ...sheet, entities } },
        modified: Date.now(),
      },
    });
  },

  distributeEntities: (axis) => {
    const { project, past, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const ids = Array.from(editor.selection);
    if (ids.length < 3) return;

    const items: { id: string; bounds: Bounds; center: number }[] = [];
    for (const id of ids) {
      const e = sheet.entities[id];
      if (!e) continue;
      const b = entityBounds(e);
      if (!b) continue;
      const center = axis === 'horizontal'
        ? (b.minX + b.maxX) / 2
        : (b.minY + b.maxY) / 2;
      items.push({ id, bounds: b, center });
    }
    if (items.length < 3) return;

    // Sort by center position
    items.sort((a, b) => a.center - b.center);

    const first = items[0].center;
    const last = items[items.length - 1].center;
    const step = (last - first) / (items.length - 1);

    const entities = { ...sheet.entities };
    for (let i = 1; i < items.length - 1; i++) {
      const desired = first + step * i;
      const delta = desired - items[i].center;
      if (Math.abs(delta) > 0.001) {
        const dx = axis === 'horizontal' ? delta : 0;
        const dy = axis === 'vertical' ? delta : 0;
        entities[items[i].id] = moveEntityDeep(entities[items[i].id], dx, dy);
      }
    }

    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: { ...sheet, entities } },
        modified: Date.now(),
      },
    });
  },

  flipEntities: (axis) => {
    const { project, past, editor } = get();
    const sheet = project.sheets[project.activeSheetId];
    if (!sheet) return;
    const ids = Array.from(editor.selection);
    if (ids.length < 1) return;

    // Compute collective bounding box
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    const validIds: string[] = [];
    for (const id of ids) {
      const e = sheet.entities[id];
      if (!e) continue;
      const b = entityBounds(e);
      if (!b) continue;
      validIds.push(id);
      if (b.minX < gMinX) gMinX = b.minX;
      if (b.minY < gMinY) gMinY = b.minY;
      if (b.maxX > gMaxX) gMaxX = b.maxX;
      if (b.maxY > gMaxY) gMaxY = b.maxY;
    }
    if (validIds.length === 0) return;

    const centerX = (gMinX + gMaxX) / 2;
    const centerY = (gMinY + gMaxY) / 2;
    const center = axis === 'horizontal' ? centerX : centerY;

    const entities = { ...sheet.entities };
    for (const id of validIds) {
      entities[id] = reflectEntity(entities[id], axis, center);
    }

    set({
      past: pushPast(past, project),
      future: [],
      project: {
        ...project,
        sheets: { ...project.sheets, [sheet.id]: { ...sheet, entities } },
        modified: Date.now(),
      },
    });
  },
  setAutoRoute: (on) => set({ autoRoute: on }),
}));

export const newEntityId = newId;
