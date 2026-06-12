import { useStore } from '../state/store';
import { fitViewportToSheet } from './fit';
import type { ToolId } from '../types';

// ---------------------------------------------------------------------------
// Command registry — the single source of truth for every invokable action
// and its keyboard binding. The command palette (⌘K), the shortcuts modal,
// the menu-bar hint strings, and the actual keydown dispatch all read from
// this table, so a binding can no longer drift out of sync with its
// documentation.
//
// Three kinds of entry live here:
//   1. Plain commands — run() does the work directly against the store.
//   2. UI-backed commands — run() delegates to a handler registered at
//      runtime by App/MenuBar (modal openers, file pickers, exporters).
//      Handlers arrive via registerUiHandlers(); until then run() no-ops.
//   3. Contextual entries — display-only metadata for keys whose handling
//      must stay inside the canvas tool logic (Tab while drafting, Space
//      pan, …). They are documented in the shortcuts modal but are never
//      dispatched and never appear in the palette.
// ---------------------------------------------------------------------------

type StoreState = ReturnType<typeof useStore.getState>;

export interface CommandShortcut {
  /** Human-readable combo, e.g. '⌘⇧P' (mac) or 'Ctrl+Shift+P'. */
  display: string;
  /** True when this keyboard event should trigger the command. */
  matches(e: KeyboardEvent): boolean;
}

export interface CommandContext {
  /** Live store snapshot — state plus actions (useStore.getState()). */
  store: StoreState;
  /** UI callbacks registered by App/MenuBar at mount time. */
  ui: Partial<CommandUiHandlers>;
}

export interface CommandDef {
  id: string;
  title: string;
  category: string;
  shortcut?: CommandShortcut;
  /**
   * Display-only: the key is handled inside canvas/tool logic (drafting
   * commits, quick-pan, …). The shortcuts modal documents it, but it is
   * never dispatched through the registry and never shown in the palette.
   */
  contextual?: boolean;
  /**
   * Dispatched by the app-level listener too, so the binding works even
   * when the 2D canvas (and its richer key handler) is unmounted — e.g.
   * in 3D-only view. Mirrors the pre-registry split where F7/F9 lived in
   * App while everything else lived in CadCanvas.
   */
  globalKey?: boolean;
  isEnabled?(): boolean;
  run(ctx: CommandContext): void;
}

/** Callbacks owned by React components, registered when they mount. */
export interface CommandUiHandlers {
  // File handling (hidden <input type=file> pickers + download helpers
  // live in MenuBar, so the commands delegate rather than duplicate).
  newProject(): void;
  openProject(): void;
  saveProject(): void;
  exportSVG(): void;
  exportPNG(): void;
  exportPDF(): void;
  exportIFC(): void;
  exportCOBie(): void;
  exportCableScheduleCSV(): void;
  exportCableSchedulePDF(): void;
  exportContainmentBOMCSV(): void;
  exportCompliancePDF(): void;
  exportCostEstimateCSV(): void;
  importDXF(): void;
  importIFC(): void;
  importCablesCSV(): void;
  // Tools that live in MenuBar (selection checks + status reporting).
  autoNumberWires(): void;
  rerunAutoFeatures(): void;
  straightenContainments(): void;
  openViewGenerator(kind: 'cross-section' | 'elevation' | 'riser' | 'isometric'): void;
  // Modal openers (App owns the open/close state).
  openBom(): void;
  openCableSchedule(): void;
  openCompliance(): void;
  openCatalogue(): void;
  openCost(): void;
  openCrossSection(): void;
  openCollaboration(): void;
  openAbout(): void;
  openShortcuts(): void;
  openFindEntity(): void;
  toggleCommandPalette(): void;
}

const uiHandlers: Partial<CommandUiHandlers> = {};

/**
 * Merge UI callbacks into the registry. App registers its modal openers
 * once on mount; MenuBar re-registers its file/export handlers every render
 * because they close over the current project.
 */
export const registerUiHandlers = (handlers: Partial<CommandUiHandlers>): void => {
  Object.assign(uiHandlers, handlers);
};

// ---------------------------------------------------------------------------
// Shortcut display + matcher helpers
// ---------------------------------------------------------------------------

// navigator is absent under vitest's node environment — default to the
// mac-style glyphs the rest of the UI already uses.
const isMac =
  typeof navigator === 'undefined' ||
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || 'Mac');
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';
const ALT = isMac ? '⌥' : 'Alt+';

/** ⌘/Ctrl + key, with an exact shift requirement (⌘V ≠ ⌘⇧V). */
const modKey = (key: string, shift = false) => (e: KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && e.shiftKey === shift && e.key.toLowerCase() === key;

/** Bare letter — no ⌘/Ctrl/Alt. Shift-agnostic, matching the old TOOL_MAP. */
const bareKey = (key: string) => (e: KeyboardEvent): boolean =>
  !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === key;

/** Function keys match regardless of modifiers (pre-registry behavior). */
const fnKey = (key: string) => (e: KeyboardEvent): boolean => e.key === key;

/** Placeholder matcher for contextual, display-only entries. */
const never = (): boolean => false;

// ---------------------------------------------------------------------------
// Shared run() helpers
// ---------------------------------------------------------------------------

const zoomBy = (store: StoreState, factor: number): void => {
  const v = store.editor.viewport;
  store.setViewport({ ...v, zoom: Math.max(0.05, Math.min(200, v.zoom * factor)) });
};

const zoomExtents = (store: StoreState): void => {
  const sheet = store.project.sheets[store.project.activeSheetId];
  if (!sheet) return;
  // Best-effort canvas size: fall back to window if we can't query the canvas.
  const canvas =
    typeof document !== 'undefined'
      ? (document.querySelector('canvas.canvas-2d') as HTMLCanvasElement | null)
      : null;
  const w = canvas?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth - 500 : 1000);
  const h = canvas?.clientHeight ?? (typeof window !== 'undefined' ? window.innerHeight - 200 : 700);
  store.setViewport(fitViewportToSheet(sheet, w, h));
};

const selectionAtLeast = (n: number) => (): boolean =>
  useStore.getState().editor.selection.size >= n;

const toolCommand = (
  id: string,
  title: string,
  tool: ToolId,
  hotkey?: string,
): CommandDef => ({
  id,
  title,
  category: 'Tools',
  shortcut: hotkey
    ? { display: hotkey.toUpperCase(), matches: bareKey(hotkey) }
    : undefined,
  run: ({ store }) => store.setTool(tool),
});

const uiCommand = (
  id: string,
  title: string,
  category: string,
  handler: keyof CommandUiHandlers,
  shortcut?: CommandShortcut,
  globalKey?: boolean,
): CommandDef => ({
  id,
  title,
  category,
  shortcut,
  globalKey,
  run: ({ ui }) => (ui[handler] as (() => void) | undefined)?.(),
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const commands: CommandDef[] = [
  // ---- File ---------------------------------------------------------------
  uiCommand('file.new', 'New Project', 'File', 'newProject'),
  uiCommand('file.open', 'Open Project…', 'File', 'openProject',
    { display: `${MOD}O`, matches: modKey('o') }, true),
  uiCommand('file.save', 'Save Project', 'File', 'saveProject',
    { display: `${MOD}S`, matches: modKey('s') }, true),
  uiCommand('file.export-svg', 'Export SVG…', 'File', 'exportSVG'),
  uiCommand('file.export-png', 'Export PNG…', 'File', 'exportPNG'),
  uiCommand('file.export-pdf', 'Export PDF…', 'File', 'exportPDF',
    { display: `${MOD}${SHIFT}P`, matches: modKey('p', true) }),
  uiCommand('file.export-ifc', 'Export IFC (BIM)…', 'File', 'exportIFC'),
  uiCommand('file.export-cobie', 'Export COBie Bundle…', 'File', 'exportCOBie'),
  uiCommand('file.export-cable-schedule-csv', 'Export Cable Schedule (CSV)…', 'File', 'exportCableScheduleCSV'),
  uiCommand('file.export-cable-schedule-pdf', 'Export Cable Schedule (PDF)…', 'File', 'exportCableSchedulePDF'),
  uiCommand('file.export-containment-bom-csv', 'Export Containment BOM (CSV)…', 'File', 'exportContainmentBOMCSV'),
  uiCommand('file.export-compliance-pdf', 'Export Compliance Report (PDF)…', 'File', 'exportCompliancePDF'),
  uiCommand('file.export-cost-estimate-csv', 'Export Cost Estimate (CSV)…', 'File', 'exportCostEstimateCSV'),
  uiCommand('file.import-dxf', 'Import DWG/DXF as Underlay…', 'File', 'importDXF'),
  uiCommand('file.import-ifc', 'Import IFC Reference…', 'File', 'importIFC'),
  uiCommand('file.import-cables-csv', 'Import Cables (CSV)…', 'File', 'importCablesCSV'),

  // ---- Edit ---------------------------------------------------------------
  {
    id: 'edit.undo',
    title: 'Undo',
    category: 'Edit',
    shortcut: { display: `${MOD}Z`, matches: modKey('z') },
    run: ({ store }) => store.undo(),
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    category: 'Edit',
    shortcut: { display: `${MOD}${SHIFT}Z`, matches: modKey('z', true) },
    run: ({ store }) => store.redo(),
  },
  {
    id: 'edit.copy',
    title: 'Copy',
    category: 'Edit',
    shortcut: { display: `${MOD}C`, matches: modKey('c') },
    run: ({ store }) => store.copySelection(),
  },
  {
    id: 'edit.paste',
    title: 'Paste at Cursor',
    category: 'Edit',
    shortcut: { display: `${MOD}V`, matches: modKey('v') },
    run: ({ store }) => store.pasteFromClipboard(store.editor.cursorSnap ?? store.editor.cursor),
  },
  {
    id: 'edit.duplicate',
    title: 'Duplicate Selection',
    category: 'Edit',
    shortcut: { display: `${MOD}D`, matches: modKey('d') },
    run: ({ store }) => store.duplicateSelection(),
  },
  {
    id: 'edit.delete',
    title: 'Delete Selection',
    category: 'Edit',
    // Modifier-agnostic on purpose (⌘⌫ etc. should still delete).
    shortcut: { display: 'Del', matches: (e) => e.key === 'Delete' || e.key === 'Backspace' },
    isEnabled: selectionAtLeast(1),
    run: ({ store }) => store.removeEntities(Array.from(store.editor.selection)),
  },
  {
    id: 'edit.select-all',
    title: 'Select All',
    category: 'Edit',
    shortcut: { display: `${MOD}A`, matches: modKey('a') },
    run: ({ store }) => {
      const sheet = store.project.sheets[store.project.activeSheetId];
      if (sheet) store.setSelection(sheet.entityOrder);
    },
  },
  {
    id: 'edit.cancel',
    title: 'Cancel / Deselect',
    category: 'Edit',
    shortcut: { display: 'Esc', matches: (e) => e.key === 'Escape' },
    run: ({ store }) => {
      store.setDrafting(null);
      store.clearSelection();
      store.setTool('select');
      store.setPendingSymbol(null);
      store.setStatus('');
    },
  },
  {
    id: 'edit.flip-horizontal',
    title: 'Flip Horizontal',
    category: 'Edit',
    shortcut: { display: `${MOD}${SHIFT}H`, matches: modKey('h', true) },
    run: ({ store }) => store.flipEntities('horizontal'),
  },
  {
    id: 'edit.flip-vertical',
    title: 'Flip Vertical',
    category: 'Edit',
    shortcut: { display: `${MOD}${SHIFT}V`, matches: modKey('v', true) },
    run: ({ store }) => store.flipEntities('vertical'),
  },
  ...(
    [
      ['left', 'Align Left'],
      ['center-h', 'Align Center Horizontal'],
      ['right', 'Align Right'],
      ['top', 'Align Top'],
      ['center-v', 'Align Center Vertical'],
      ['bottom', 'Align Bottom'],
    ] as const
  ).map(([axis, title]): CommandDef => ({
    id: `edit.align-${axis}`,
    title,
    category: 'Edit',
    isEnabled: selectionAtLeast(2),
    run: ({ store }) => store.alignEntities(axis),
  })),
  ...(
    [
      ['horizontal', 'Distribute Horizontal'],
      ['vertical', 'Distribute Vertical'],
    ] as const
  ).map(([axis, title]): CommandDef => ({
    id: `edit.distribute-${axis}`,
    title,
    category: 'Edit',
    isEnabled: selectionAtLeast(3),
    run: ({ store }) => store.distributeEntities(axis),
  })),

  // ---- View ---------------------------------------------------------------
  {
    id: 'view.zoom-in',
    title: 'Zoom In',
    category: 'View',
    run: ({ store }) => zoomBy(store, 1.25),
  },
  {
    id: 'view.zoom-out',
    title: 'Zoom Out',
    category: 'View',
    run: ({ store }) => zoomBy(store, 0.8),
  },
  {
    id: 'view.zoom-extents',
    title: 'Zoom Extents (Fit Sheet)',
    category: 'View',
    run: ({ store }) => zoomExtents(store),
  },
  {
    id: 'view.mode-2d',
    title: '2D Only',
    category: 'View',
    run: ({ store }) => store.setViewMode('2d'),
  },
  {
    id: 'view.mode-split',
    title: 'Split View (2D + 3D)',
    category: 'View',
    run: ({ store }) => store.setViewMode('split'),
  },
  {
    id: 'view.mode-3d',
    title: '3D Only',
    category: 'View',
    run: ({ store }) => store.setViewMode('3d'),
  },
  {
    id: 'view.toggle-grid',
    title: 'Toggle Grid Snap',
    category: 'View',
    shortcut: { display: 'F7', matches: fnKey('F7') },
    globalKey: true,
    run: ({ store }) => store.setSnap({ grid: !store.editor.snap.grid }),
  },
  {
    id: 'view.toggle-ortho',
    title: 'Toggle Ortho Mode',
    category: 'View',
    shortcut: { display: 'F8', matches: fnKey('F8') },
    run: ({ store }) => store.setOrtho(!store.editor.ortho),
  },
  {
    id: 'view.toggle-snap',
    title: 'Toggle Snap',
    category: 'View',
    shortcut: { display: 'F9', matches: fnKey('F9') },
    globalKey: true,
    run: ({ store }) => store.setSnap({ enabled: !store.editor.snap.enabled }),
  },
  {
    id: 'view.toggle-osnap',
    title: 'Toggle Object Snap',
    category: 'View',
    shortcut: { display: 'F3', matches: fnKey('F3') },
    run: ({ store }) => store.setSnap({ osnap: !store.editor.snap.osnap }),
  },
  {
    id: 'view.back',
    title: 'Previous View',
    category: 'View',
    shortcut: {
      display: `${ALT}←`,
      matches: (e) => e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'ArrowLeft',
    },
    run: ({ store }) => store.viewBack(),
  },
  {
    id: 'view.forward',
    title: 'Next View',
    category: 'View',
    shortcut: {
      display: `${ALT}→`,
      matches: (e) => e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'ArrowRight',
    },
    run: ({ store }) => store.viewForward(),
  },

  // ---- Tools (tool selection) ----------------------------------------------
  toolCommand('tool.select', 'Select Tool', 'select', 's'),
  toolCommand('tool.pan', 'Pan Tool', 'pan'),
  toolCommand('tool.erase', 'Erase Tool', 'erase', 'e'),
  toolCommand('tool.line', 'Line Tool', 'line', 'l'),
  toolCommand('tool.rectangle', 'Rectangle Tool', 'rectangle', 'r'),
  toolCommand('tool.circle', 'Circle Tool', 'circle', 'c'),
  toolCommand('tool.arc', 'Arc Tool', 'arc', 'a'),
  toolCommand('tool.polyline', 'Polyline Tool', 'polyline', 'p'),
  toolCommand('tool.wire', 'Wire Tool', 'wire', 'w'),
  toolCommand('tool.bus', 'Bus Tool', 'bus'),
  toolCommand('tool.trunking', 'Trunking Tool', 'trunking'),
  toolCommand('tool.basket', 'Basket Tool', 'basket'),
  toolCommand('tool.tray', 'Cable Tray Tool', 'tray'),
  toolCommand('tool.conduit', 'Conduit Tool', 'conduit'),
  toolCommand('tool.wall', 'Wall Tool', 'wall'),
  toolCommand('tool.room', 'Room Tool', 'room'),
  toolCommand('tool.equipment', 'Equipment Tool', 'equipment'),
  toolCommand('tool.support', 'Support Tool', 'support'),
  toolCommand('tool.leader', 'Leader Tool', 'leader'),
  toolCommand('tool.level-marker', 'Level Marker Tool', 'level-marker'),
  toolCommand('tool.north-arrow', 'North Arrow Tool', 'north-arrow'),
  toolCommand('tool.scale-bar', 'Scale Bar Tool', 'scale-bar'),
  toolCommand('tool.text', 'Text Tool', 'text', 't'),
  toolCommand('tool.dimension', 'Dimension Tool', 'dimension', 'd'),
  toolCommand('tool.measure', 'Measure Tool', 'measure', 'm'),
  {
    id: 'tools.toggle-autoroute',
    title: 'Toggle Wire Auto-Route',
    category: 'Tools',
    run: ({ store }) => store.setAutoRoute(!store.autoRoute),
  },
  uiCommand('tools.auto-number-wires', 'Auto-Number Wires', 'Tools', 'autoNumberWires'),
  uiCommand('tools.rerun-auto-features', 'Re-run Auto-Features on Selection', 'Tools', 'rerunAutoFeatures'),
  uiCommand('tools.straighten-containments', 'Straighten/Space Selected Containments', 'Tools', 'straightenContainments'),

  // ---- Dialogs ------------------------------------------------------------
  uiCommand('dialog.bom', 'Schedules & BOM…', 'Dialogs', 'openBom'),
  uiCommand('dialog.cable-schedule', 'Cable Schedule…', 'Dialogs', 'openCableSchedule'),
  uiCommand('dialog.compliance', 'Compliance Dashboard…', 'Dialogs', 'openCompliance'),
  uiCommand('dialog.catalogue', 'Catalogue Browser…', 'Dialogs', 'openCatalogue'),
  uiCommand('dialog.cost', 'Cost Estimate…', 'Dialogs', 'openCost'),
  uiCommand('dialog.cross-section', 'Edit Cross Section…', 'Dialogs', 'openCrossSection'),
  uiCommand('dialog.collaboration', 'Collaboration…', 'Dialogs', 'openCollaboration'),
  // ⌘F: the conventional "find" combo, and the only ⌘/Ctrl+F binding in the
  // registry (the cross-product collision test in commands.test.ts sweeps
  // the F key against every modifier mask). globalKey so locating an entity
  // works from the 3D-only view, where the canvas dispatcher is unmounted.
  uiCommand('dialog.find-entity', 'Find Entity…', 'Dialogs', 'openFindEntity',
    { display: `${MOD}F`, matches: modKey('f') }, true),
  {
    id: 'dialog.generate-cross-section',
    title: 'Generate Cross-Section…',
    category: 'Dialogs',
    run: ({ ui }) => ui.openViewGenerator?.('cross-section'),
  },
  {
    id: 'dialog.generate-elevation',
    title: 'Generate Elevation View…',
    category: 'Dialogs',
    run: ({ ui }) => ui.openViewGenerator?.('elevation'),
  },
  {
    id: 'dialog.generate-riser',
    title: 'Generate Riser Diagram…',
    category: 'Dialogs',
    run: ({ ui }) => ui.openViewGenerator?.('riser'),
  },
  {
    id: 'dialog.generate-isometric',
    title: 'Generate Isometric…',
    category: 'Dialogs',
    run: ({ ui }) => ui.openViewGenerator?.('isometric'),
  },

  // ---- Help ---------------------------------------------------------------
  uiCommand('help.palette', 'Command Palette…', 'Help', 'toggleCommandPalette',
    { display: `${MOD}K`, matches: modKey('k') }, true),
  uiCommand('help.shortcuts', 'Keyboard Shortcuts', 'Help', 'openShortcuts',
    {
      display: '?',
      matches: (e) => e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey,
    }, true),
  uiCommand('help.about', 'About OpenCAD Electrical', 'Help', 'openAbout'),

  // ---- Contextual entries (display-only, handled by the canvas) -----------
  {
    id: 'ctx.commit-draft',
    title: 'Finish Polyline / Wire',
    category: 'Drafting',
    contextual: true,
    shortcut: { display: 'Enter', matches: never },
    run: () => {},
  },
  {
    id: 'ctx.flip-autoroute',
    title: 'Flip Auto-Route Direction (while drawing a wire)',
    category: 'Drafting',
    contextual: true,
    shortcut: { display: 'Tab', matches: never },
    run: () => {},
  },
  {
    id: 'ctx.rotate-selection',
    title: 'Rotate Selection 90° (with a rotatable selection)',
    category: 'Drafting',
    contextual: true,
    shortcut: { display: 'R', matches: never },
    run: () => {},
  },
  {
    id: 'ctx.space-pan',
    title: 'Quick Pan (hold + drag)',
    category: 'Navigation',
    contextual: true,
    shortcut: { display: 'Space', matches: never },
    run: () => {},
  },
  {
    id: 'ctx.arrow-pan',
    title: 'Pan View',
    category: 'Navigation',
    contextual: true,
    shortcut: { display: '← → ↑ ↓', matches: never },
    run: () => {},
  },
  {
    id: 'ctx.arrow-pan-fast',
    title: 'Pan View (large steps)',
    category: 'Navigation',
    contextual: true,
    shortcut: { display: `${SHIFT}Arrows`, matches: never },
    run: () => {},
  },
  {
    id: 'mouse.wheel-zoom',
    title: 'Zoom In / Out',
    category: 'Mouse & Touch',
    contextual: true,
    shortcut: { display: 'Mouse Wheel / Pinch', matches: never },
    run: () => {},
  },
  {
    id: 'mouse.trackpad-pan',
    title: 'Pan (trackpad)',
    category: 'Mouse & Touch',
    contextual: true,
    shortcut: { display: '2-Finger Scroll', matches: never },
    run: () => {},
  },
  {
    id: 'mouse.middle-pan',
    title: 'Pan (mouse)',
    category: 'Mouse & Touch',
    contextual: true,
    shortcut: { display: 'Middle Drag', matches: never },
    run: () => {},
  },
  {
    id: 'mouse.right-click',
    title: 'Context Menu / Commit Drafting',
    category: 'Mouse & Touch',
    contextual: true,
    shortcut: { display: 'Right Click', matches: never },
    run: () => {},
  },
];

const commandById = new Map(commands.map((c) => [c.id, c]));

/** Full registry, in declaration order (used by the shortcuts modal). */
export const allCommands = (): readonly CommandDef[] => commands;

export const getCommand = (id: string): CommandDef | undefined => commandById.get(id);

/** Menu-bar hint string for a command, sourced from the registry. */
export const shortcutHint = (id: string): string =>
  commandById.get(id)?.shortcut?.display ?? '';

// ---------------------------------------------------------------------------
// Recently-used tracking (in-memory; boosts palette ranking)
// ---------------------------------------------------------------------------

let recentCounter = 0;
const recentRank = new Map<string, number>();

export const markRecentlyUsed = (id: string): void => {
  recentRank.set(id, ++recentCounter);
};

/** Test seam — palette ranking is deterministic again after this. */
export const clearRecentlyUsed = (): void => {
  recentRank.clear();
  recentCounter = 0;
};

// ---------------------------------------------------------------------------
// Execution + keyboard dispatch
// ---------------------------------------------------------------------------

export const runCommand = (id: string): boolean => {
  const cmd = commandById.get(id);
  if (!cmd || cmd.contextual) return false;
  if (cmd.isEnabled && !cmd.isEnabled()) return false;
  markRecentlyUsed(id);
  cmd.run({ store: useStore.getState(), ui: uiHandlers });
  return true;
};

// Both CadCanvas (full set) and App (globalKey subset) listen on window, so
// the same event can reach dispatchShortcut twice. Mark events we've acted
// on to make double-dispatch harmless regardless of listener order.
const handledEvents = new WeakSet<KeyboardEvent>();

/**
 * Run the first registered command whose shortcut matches the event.
 * Returns true when the event was consumed (including by an earlier
 * dispatcher in the same bubble phase).
 */
export const dispatchShortcut = (
  e: KeyboardEvent,
  opts?: { globalOnly?: boolean },
): boolean => {
  if (handledEvents.has(e)) return true;
  for (const cmd of commands) {
    if (cmd.contextual || !cmd.shortcut) continue;
    if (opts?.globalOnly && !cmd.globalKey) continue;
    if (!cmd.shortcut.matches(e)) continue;
    if (cmd.isEnabled && !cmd.isEnabled()) continue;
    handledEvents.add(e);
    e.preventDefault();
    markRecentlyUsed(cmd.id);
    cmd.run({ store: useStore.getState(), ui: uiHandlers });
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Fuzzy subsequence matching (command palette)
// ---------------------------------------------------------------------------

/**
 * Score `query` as a subsequence of `text`. Higher is better; null means no
 * match. Case-insensitive. Bonuses for consecutive matches and word starts,
 * small penalties for gaps and longer targets, so "ecs" prefers
 * "Export Cable Schedule" over an incidental scatter of letters.
 */
export const fuzzyScore = (query: string, text: string): number | null => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.trim().length === 0) return 0; // empty query matches everything, neutrally
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    // Spaces in the query are separators, not required characters.
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === prevMatch + 1) score += 3; // consecutive run
    if (found === 0 || ' -_/(.'.includes(t[found - 1])) score += 2; // word start
    score -= Math.min(found - ti, 8) * 0.2; // gap penalty (capped)
    prevMatch = found;
    ti = found + 1;
  }
  // Prefer shorter targets when otherwise tied.
  return score - t.length * 0.01;
};

/**
 * Rank palette candidates for a query. Contextual and currently-disabled
 * commands are excluded. An empty query lists recently-used commands first,
 * then the rest in registry order.
 */
export const searchCommands = (query: string): CommandDef[] => {
  const q = query.trim();
  const scored: { cmd: CommandDef; score: number; index: number }[] = [];
  commands.forEach((cmd, index) => {
    if (cmd.contextual) return;
    if (cmd.isEnabled && !cmd.isEnabled()) return;
    let score: number | null = 0;
    if (q.length > 0) {
      score = fuzzyScore(q, cmd.title);
      if (score === null) {
        // Allow matching through the category ("view 3d"), mildly penalized
        // so direct title hits rank above category-assisted ones.
        const viaCategory = fuzzyScore(q, `${cmd.category} ${cmd.title}`);
        score = viaCategory === null ? null : viaCategory - 1;
      }
      if (score === null) return;
    }
    const recency = recentRank.get(cmd.id);
    // Recency boost: +2 lifts recent commands past close scores; the tiny
    // counter fraction orders recents newest-first among themselves.
    const boost = recency === undefined ? 0 : 2 + recency / 1e6;
    scored.push({ cmd, score: score + boost, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.cmd);
};
