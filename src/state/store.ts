import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  Project,
  EditorState,
  Entity,
  EntityId,
  Layer,
  LayerId,
  Sheet,
  SheetId,
  ToolId,
  Vec2,
  Viewport,
} from '../types';

const newId = () => nanoid(10);

const defaultLayers = (): { layers: Record<LayerId, Layer>; layerOrder: LayerId[]; defaultId: LayerId } => {
  const wireId = newId();
  const symId = newId();
  const wireLabelId = newId();
  const dimId = newId();
  const textId = newId();
  const panelId = newId();
  const sketchId = newId();
  const layers: Record<LayerId, Layer> = {
    [wireId]: { id: wireId, name: 'Wires', color: '#ff3a3a', visible: true, locked: false, lineWidth: 0.6 },
    [symId]: { id: symId, name: 'Symbols', color: '#e6e6e6', visible: true, locked: false, lineWidth: 0.5 },
    [wireLabelId]: { id: wireLabelId, name: 'Wire Labels', color: '#ffd84d', visible: true, locked: false, lineWidth: 0.4 },
    [dimId]: { id: dimId, name: 'Dimensions', color: '#5cdcff', visible: true, locked: false, lineWidth: 0.3 },
    [textId]: { id: textId, name: 'Annotation', color: '#9ad65a', visible: true, locked: false, lineWidth: 0.4 },
    [panelId]: { id: panelId, name: 'Panel Layout', color: '#bb8cff', visible: true, locked: false, lineWidth: 0.5 },
    [sketchId]: { id: sketchId, name: 'Construction', color: '#5d6473', visible: true, locked: false, lineWidth: 0.3, lineDash: [4, 4] },
  };
  return {
    layers,
    layerOrder: [wireId, symId, wireLabelId, dimId, textId, panelId, sketchId],
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
  ortho: false,
  viewMode: 'split',
  commandHistory: [],
  statusMessage: 'Welcome to OpenCAD Electrical',
});

interface Store {
  project: Project;
  editor: EditorState;
  // History
  past: Project[];
  future: Project[];

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
  setCursor: (c: Vec2, snap: Vec2 | null) => void;
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

  setProject: (p) => set({ project: p, past: [], future: [] }),
  resetProject: () => set({ project: createEmptyProject(), editor: initialEditor(), past: [], future: [] }),

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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
      future: [],
      project: { ...project, sheets, sheetOrder, activeSheetId, modified: Date.now() },
    });
  },

  renameSheet: (id, name) => {
    const { project, past } = get();
    const sheet = project.sheets[id];
    if (!sheet) return;
    set({
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
      past: [...past, cloneProject(project)],
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
  setCursor: (c, snap) => set((s) => ({ editor: { ...s.editor, cursor: c, cursorSnap: snap } })),
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
    set({ past: [...past, cloneProject(project)], future: [] });
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
      past: [...past, cloneProject(project)],
      future: future.slice(1),
    });
  },
}));

export const newEntityId = newId;
