import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { render2d } from '../render/render2d';
import { screenToWorld, zoomAtPoint } from '../lib/viewport';
import { computeSnap } from '../lib/snap';
import { findEntityAt, findEntitiesInRect } from '../lib/hittest';
import { onToolClick, onToolCommit } from './tools';
import { getSymbol } from '../symbols';
import { fitViewportToSheet } from '../lib/fit';
import { computeOrthogonalRoute } from '../lib/autoroute';
import { newEntityId } from '../state/store';
import type { Vec2, Entity, ToolId, PenetrationSeal } from '../types';
import { exportSheetPDF } from '../io/pdf';
import {
  autoPlaceFittingsForContainment,
  autoPlaceSupportsForContainment,
  autoDetectPenetrationsForContainment,
} from '../lib/auto-features';
import { publishPresence as publishCollabPresence } from '../collab/runtime';

// After committing one or more containments, derive their fittings,
// supports, and fire-stop penetrations and dispatch them as a single
// store transaction. Anything else (lines, walls, etc.) is ignored.
const applyAutoFeaturesForCommitted = (committed: Entity[]): void => {
  const containments = committed.filter((e) => e.kind === 'containment');
  if (containments.length === 0) return;
  const state = useStore.getState();
  const proj = state.project;
  const sheetId = proj.activeSheetId;
  const newEntities: Entity[] = [];
  let newSeals: Record<string, PenetrationSeal> = {};
  for (const c of containments) {
    newEntities.push(...autoPlaceFittingsForContainment(proj, sheetId, c.id));
    newEntities.push(...autoPlaceSupportsForContainment(proj, sheetId, c.id));
    const result = autoDetectPenetrationsForContainment(proj, sheetId, c.id);
    newEntities.push(...result.penetrations);
    newSeals = { ...newSeals, ...result.seals };
  }
  if (newEntities.length > 0) state.addEntities(newEntities);
  if (Object.keys(newSeals).length > 0) {
    useStore.setState((s) => ({
      project: {
        ...s.project,
        penetrationSeals: { ...(s.project.penetrationSeals ?? {}), ...newSeals },
        modified: Date.now(),
      },
    }));
  }
};

export function CadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [draggingSelection, setDraggingSelection] = useState<{
    start: Vec2;
    initial: Map<string, Entity>;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline text editor — replaces window.prompt for the text tool. Anchored
  // in screen space so we keep visible while the user pans/zooms.
  const [textInput, setTextInput] = useState<{
    screen: Vec2;
    world: Vec2;
    layerId: string;
  } | null>(null);

  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const setViewport = useStore((s) => s.setViewport);
  const setCursor = useStore((s) => s.setCursor);
  const setHover = useStore((s) => s.setHover);
  const setSelection = useStore((s) => s.setSelection);
  const addToSelection = useStore((s) => s.addToSelection);
  const toggleInSelection = useStore((s) => s.toggleInSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const setDrafting = useStore((s) => s.setDrafting);
  const addEntities = useStore((s) => s.addEntities);
  const updateEntity = useStore((s) => s.updateEntity);
  const removeEntities = useStore((s) => s.removeEntities);
  const setStatus = useStore((s) => s.setStatus);
  const setTool = useStore((s) => s.setTool);
  const setOrtho = useStore((s) => s.setOrtho);
  const autoRoute = useStore((s) => s.autoRoute);

  // Transient ref: when true, the auto-route L-shape direction is flipped
  // (toggled by Tab while drawing a wire). Reset when the wire finishes.
  const autoRouteFlipRef = useRef(false);

  // Throttle for collab presence publishing — keep the cursor smooth
  // for remote peers without flooding awareness. ~30ms = 33Hz.
  const lastPresencePublishRef = useRef(0);

  const sheet = project.sheets[project.activeSheetId];
  const activeLayerId = project.activeLayerId;
  const lastFittedSheetIdRef = useRef<string | null>(null);

  // Resize observer
  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    setDpr(window.devicePixelRatio || 1);
    return () => ro.disconnect();
  }, []);

  // Auto-fit drawing extents to canvas on first measurement and on sheet change.
  useEffect(() => {
    if (!sheet) return;
    if (size.w < 100 || size.h < 100) return;
    if (lastFittedSheetIdRef.current === sheet.id) return;
    lastFittedSheetIdRef.current = sheet.id;
    setViewport(fitViewportToSheet(sheet, size.w, size.h));
  }, [sheet, size.w, size.h, setViewport]);

  // Render — schedule a single frame per state change (instead of a perpetual
  // requestAnimationFrame loop). The previous implementation re-queued itself
  // every frame and re-set canvas.width/height each tick, causing both wasted
  // CPU and a recomposite on idle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only resize the backing buffer when it actually changes — assigning to
    // canvas.width clears the canvas, so we'd rather avoid it on every frame.
    const targetW = size.w * dpr;
    const targetH = size.h * dpr;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
    }

    let raf: number | null = requestAnimationFrame(() => {
      raf = null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      render2d(ctx, project, editor, {
        width: size.w,
        height: size.h,
        dpr,
        symbolLookup: getSymbol,
        autoRoute,
        autoRouteFlip: autoRouteFlipRef.current,
      });

      if (marquee) {
        const a = marquee.a;
        const b = marquee.b;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        const fullEnclosed = b.x > a.x;
        ctx.fillStyle = fullEnclosed
          ? 'rgba(80, 160, 255, 0.12)'
          : 'rgba(120, 220, 110, 0.12)';
        ctx.strokeStyle = fullEnclosed ? '#5cdcff' : '#6dd17c';
        ctx.lineWidth = 1;
        ctx.setLineDash(fullEnclosed ? [] : [4, 3]);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    });
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [project, editor, size, dpr, marquee, autoRoute]);

  const eventToWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToWorld(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      editor.viewport,
      size.w,
      size.h
    );
  };

  const eventToScreen = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Mouse move: update cursor + snap + hover
  const handleMouseMove = (e: React.MouseEvent) => {
    const world = eventToWorld(e);
    const snap = computeSnap(world, sheet, editor.snap, {
      pixelsPerMm: editor.viewport.zoom,
      toleranceScreenPx: 12,
      symbolLookup: getSymbol,
    }, (id) => project.layers[id]?.visible ?? true);
    setCursor(world, snap.kind === 'none' ? null : snap.point, snap.kind);

    // Publish cursor to collaboration peers (no-op if collab inactive).
    // Throttled so high-frequency mousemove events don't saturate the
    // awareness channel. The runtime helper short-circuits when no
    // session is active, so single-player pays nothing here.
    const now = Date.now();
    if (now - lastPresencePublishRef.current >= 30) {
      lastPresencePublishRef.current = now;
      publishCollabPresence({
        sheetId: project.activeSheetId,
        cursor: snap.kind === 'none' ? world : snap.point,
        selection: Array.from(editor.selection),
      });
    }

    if (panning) {
      const v = editor.viewport;
      setViewport({
        ...v,
        x: v.x - e.movementX / v.zoom,
        y: v.y + e.movementY / v.zoom,
      });
      return;
    }

    if (marquee) {
      const sp = eventToScreen(e);
      setMarquee({ a: marquee.a, b: sp });
      return;
    }

    if (draggingSelection) {
      const start = draggingSelection.start;
      const dx = (snap.kind === 'none' ? world.x : snap.point.x) - start.x;
      const dy = (snap.kind === 'none' ? world.y : snap.point.y) - start.y;
      for (const id of editor.selection) {
        const init = draggingSelection.initial.get(id);
        if (!init) continue;
        moveEntity(id, init, dx, dy);
      }
      return;
    }

    // hover
    if (editor.tool === 'select' || editor.tool === 'erase') {
      const hit = findEntityAt(sheet, world, {
        tolerance: 8,
        pixelsPerMm: editor.viewport.zoom,
        symbolLookup: getSymbol,
      }, (id) => project.layers[id]?.visible ?? true);
      setHover(hit);
    } else {
      setHover(null);
    }
  };

  const moveEntity = (
    id: string,
    initial: Entity,
    dx: number,
    dy: number
  ) => {
    const e = sheet.entities[id];
    if (!e) return;
    const offset = (p: Vec2) => ({ x: p.x + dx, y: p.y + dy });
    const offsetArr = (pts: Vec2[]) => pts.map(offset);
    switch (initial.kind) {
      case 'line':
      case 'rectangle':
      case 'dimension':
      case 'room':
        updateEntity(id, { a: offset(initial.a), b: offset(initial.b) } as Partial<Entity>);
        break;
      case 'circle':
      case 'arc':
      case 'ellipse':
        updateEntity(id, { center: offset(initial.center) } as Partial<Entity>);
        break;
      case 'polyline':
      case 'wire':
      case 'bus':
      case 'containment':
      case 'wall':
        updateEntity(id, { points: offsetArr(initial.points) } as Partial<Entity>);
        break;
      case 'text':
      case 'symbol':
      case 'wire-label':
        updateEntity(id, { position: offset(initial.position) } as Partial<Entity>);
        break;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setContextMenu(null);
    canvasRef.current?.focus();

    if (e.button === 1 || (e.button === 0 && (editor.tool === 'pan' || spaceHeld))) {
      setPanning(true);
      // Snapshot the viewport at the start of the gesture so we record
      // exactly one history entry per pan, not one per mouse-move event.
      useStore.getState().recordView();
      return;
    }

    if (e.button === 2) {
      if (editor.drafting && editor.drafting.points.length > 0) {
        // For auto-route wires, right-click just cancels the draft (single
        // start point doesn't produce a valid wire). Reset the flip ref.
        if (editor.tool === 'wire' && autoRoute && editor.drafting.points.length === 1) {
          setDrafting(null);
          autoRouteFlipRef.current = false;
          setStatus('');
          return;
        }
        const result = onToolCommit(editor.tool, {
          layerId: activeLayerId,
          draft: editor.drafting.points,
          cursor: editor.cursorSnap ?? editor.cursor,
          ortho: editor.ortho,
          pendingSymbol: editor.pendingSymbol,
        });
        if (result.committed.length) {
          addEntities(result.committed);
          applyAutoFeaturesForCommitted(result.committed);
        }
        setDrafting(null);
        autoRouteFlipRef.current = false;
        return;
      }
      if (editor.tool === 'select') {
        setContextMenu({ x: e.clientX, y: e.clientY });
      }
      return;
    }

    if (e.button !== 0) return;

    const world = eventToWorld(e);
    const snap = computeSnap(world, sheet, editor.snap, {
      pixelsPerMm: editor.viewport.zoom,
      toleranceScreenPx: 12,
      symbolLookup: getSymbol,
    }, (id) => project.layers[id]?.visible ?? true);
    const snapped = snap.kind === 'none' ? world : snap.point;

    if (editor.tool === 'select') {
      const hit = findEntityAt(sheet, world, {
        tolerance: 8,
        pixelsPerMm: editor.viewport.zoom,
        symbolLookup: getSymbol,
      }, (id) => project.layers[id]?.visible ?? true);
      if (hit) {
        const layer = project.layers[sheet.entities[hit].layerId];
        if (layer?.locked) return;
        if (e.shiftKey) {
          toggleInSelection(hit);
        } else {
          if (!editor.selection.has(hit)) setSelection([hit]);
        }
        const initial = new Map<string, Entity>();
        const ids = editor.selection.has(hit) ? Array.from(editor.selection) : [hit];
        for (const id of ids) {
          const ent = sheet.entities[id];
          if (ent) initial.set(id, structuredClone(ent));
        }
        if (!editor.selection.has(hit)) {
          initial.set(hit, structuredClone(sheet.entities[hit]));
        }
        setDraggingSelection({ start: snapped, initial });
      } else {
        if (!e.shiftKey) clearSelection();
        setMarquee({ a: eventToScreen(e), b: eventToScreen(e) });
      }
      return;
    }

    if (editor.tool === 'erase') {
      const hit = findEntityAt(sheet, world, {
        tolerance: 8,
        pixelsPerMm: editor.viewport.zoom,
        symbolLookup: getSymbol,
      }, (id) => project.layers[id]?.visible ?? true);
      if (hit) removeEntities([hit]);
      return;
    }

    if (editor.tool === 'text') {
      // Open the inline editor at the click point and commit on Enter/blur.
      // The previous implementation used window.prompt(), which felt out of
      // place and blocked the canvas thread.
      setTextInput({
        screen: eventToScreen(e),
        world: snapped,
        layerId: activeLayerId,
      });
      return;
    }

    // Auto-route wire mode: first click sets start, second click finalizes
    // with the computed orthogonal route.
    if (editor.tool === 'wire' && autoRoute) {
      const draft = editor.drafting?.points ?? [];
      if (draft.length === 0) {
        // First click: set the start point
        setDrafting({ tool: 'wire', points: [snapped] });
        setStatus('Wire (auto): pick endpoint (Tab to flip direction)');
        return;
      }
      // Second click: compute route and commit the wire
      const start = draft[0];
      const dx = Math.abs(snapped.x - start.x);
      const dy = Math.abs(snapped.y - start.y);
      const defaultHFirst = dx >= dy;
      const horizontalFirst = autoRouteFlipRef.current ? !defaultHFirst : defaultHFirst;
      const routePoints = computeOrthogonalRoute({
        startX: start.x,
        startY: start.y,
        endX: snapped.x,
        endY: snapped.y,
        preferHorizontalFirst: horizontalFirst,
      });
      if (routePoints.length >= 2) {
        addEntities([
          {
            id: newEntityId(),
            kind: 'wire',
            layerId: activeLayerId,
            visible: true,
            locked: false,
            points: routePoints,
          },
        ]);
      }
      // Reset flip state and start a new wire from the endpoint
      autoRouteFlipRef.current = false;
      setDrafting({ tool: 'wire', points: [snapped] });
      setStatus('Wire (auto): pick endpoint (Tab to flip direction)');
      return;
    }

    // Drafting tools
    const draft = editor.drafting?.points ?? [];
    const result = onToolClick(editor.tool, {
      layerId: activeLayerId,
      draft,
      cursor: snapped,
      ortho: editor.ortho,
      pendingSymbol: editor.pendingSymbol,
    });
    if (result.committed.length) {
      addEntities(result.committed);
      applyAutoFeaturesForCommitted(result.committed);
    }
    if (result.newDraft) {
      setDrafting({ tool: editor.tool, points: result.newDraft });
    } else {
      setDrafting(null);
    }
    if (result.status) setStatus(result.status);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (panning) {
      setPanning(false);
      // Record the post-gesture viewport so back/forward steps land here.
      useStore.getState().recordView();
      return;
    }
    if (marquee) {
      const a = screenToWorld(marquee.a, editor.viewport, size.w, size.h);
      const b = screenToWorld(marquee.b, editor.viewport, size.w, size.h);
      const fullEnclosed = marquee.b.x > marquee.a.x;
      const ids = findEntitiesInRect(
        sheet,
        a,
        b,
        {
          tolerance: 8,
          pixelsPerMm: editor.viewport.zoom,
          symbolLookup: getSymbol,
        },
        (id) => project.layers[id]?.visible ?? true,
        fullEnclosed
      );
      if (e.shiftKey) addToSelection(ids);
      else setSelection(ids);
      setMarquee(null);
      return;
    }
    if (draggingSelection) {
      setDraggingSelection(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const isPinch = e.ctrlKey || e.metaKey;
    const isMouseWheel = e.deltaMode === 1 || e.deltaMode === 2;
    if (isPinch || isMouseWheel) {
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 100;
      delta = Math.max(-100, Math.min(100, delta));
      const factor = Math.exp(-delta * 0.003);
      const sp = eventToScreen(e);
      setViewport(zoomAtPoint(editor.viewport, sp, size.w, size.h, factor));
    } else {
      const v = editor.viewport;
      setViewport({
        ...v,
        x: v.x + e.deltaX / v.zoom,
        y: v.y - e.deltaY / v.zoom,
      });
    }
  };

  // ---------- Touch events (mobile) ----------
  const touchRef = useRef<{
    mode: 'tap' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    startTime: number;
    startViewport: typeof editor.viewport;
    startPinchDist: number;
    startPinchCenter: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = {
        mode: 'tap',
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
        startViewport: { ...editor.viewport },
        startPinchDist: 0,
        startPinchCenter: { x: 0, y: 0 },
        moved: false,
      };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchRef.current = {
        mode: 'pinch',
        startX: cx,
        startY: cy,
        startTime: Date.now(),
        startViewport: { ...editor.viewport },
        startPinchDist: d,
        startPinchCenter: { x: cx, y: cy },
        moved: false,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const st = touchRef.current;
    if (!st) return;
    e.preventDefault();
    if (e.touches.length === 1 && (st.mode === 'tap' || st.mode === 'pan')) {
      const t = e.touches[0];
      const dx = t.clientX - st.startX;
      const dy = t.clientY - st.startY;
      if (!st.moved && Math.hypot(dx, dy) < 8) return;
      st.mode = 'pan';
      st.moved = true;
      const v = st.startViewport;
      setViewport({
        ...v,
        x: v.x - dx / v.zoom,
        y: v.y + dy / v.zoom,
      });
    } else if (e.touches.length === 2 && st.mode === 'pinch') {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const factor = d / Math.max(1, st.startPinchDist);
      const newZoom = Math.max(0.05, Math.min(200, st.startViewport.zoom * factor));
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sw = size.w;
      const sh = size.h;
      const sv = st.startViewport;
      const startCxLocal = st.startPinchCenter.x - rect.left;
      const startCyLocal = st.startPinchCenter.y - rect.top;
      const worldX = (startCxLocal - sw / 2) / sv.zoom + sv.x;
      const worldY = -(startCyLocal - sh / 2) / sv.zoom + sv.y;
      const curCxLocal = cx - rect.left;
      const curCyLocal = cy - rect.top;
      setViewport({
        zoom: newZoom,
        x: worldX - (curCxLocal - sw / 2) / newZoom,
        y: worldY + (curCyLocal - sh / 2) / newZoom,
      });
      st.moved = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const st = touchRef.current;
    if (!st) return;
    if (st.mode === 'tap' && !st.moved) {
      const fakeEvent = {
        button: 0,
        clientX: st.startX,
        clientY: st.startY,
        shiftKey: false,
        stopPropagation: () => {},
        preventDefault: () => {},
      } as unknown as React.MouseEvent;
      handleMouseDown(fakeEvent);
      handleMouseUp(fakeEvent);
    }
    if (e.touches.length === 0) {
      touchRef.current = null;
    }
  };

  // Keyboard shortcuts. We register once with a stable handler that reads
  // the latest store state via useStore.getState() — the previous version
  // captured stale closures and re-attached on every render.
  useEffect(() => {
    const TOOL_MAP: Record<string, ToolId> = {
      's': 'select',
      'l': 'line',
      'w': 'wire',
      'r': 'rectangle',
      'c': 'circle',
      'a': 'arc',
      'p': 'polyline',
      't': 'text',
      'e': 'erase',
      'm': 'measure',
      'd': 'dimension',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const state = useStore.getState();
      const ed = state.editor;
      const proj = state.project;
      const sh = proj.sheets[proj.activeSheetId];
      if (!sh) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      // Alt + arrow = view-history navigation. Check before plain arrows.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') state.viewBack();
        else state.viewForward();
        return;
      }

      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const v = ed.viewport;
        const step = (e.shiftKey ? 80 : 30) / v.zoom;
        const next = { ...v };
        if (e.key === 'ArrowLeft') next.x -= step;
        if (e.key === 'ArrowRight') next.x += step;
        if (e.key === 'ArrowUp') next.y += step;
        if (e.key === 'ArrowDown') next.y -= step;
        state.setViewport(next);
        return;
      }

      // Tab: flip auto-route direction while drawing a wire
      if (e.key === 'Tab' && ed.tool === 'wire' && state.autoRoute && ed.drafting && ed.drafting.points.length > 0) {
        e.preventDefault();
        autoRouteFlipRef.current = !autoRouteFlipRef.current;
        state.setStatus(
          `Wire (auto): direction flipped — ${autoRouteFlipRef.current ? 'alt' : 'default'} L-shape`
        );
        return;
      }

      if (e.key === 'Escape') {
        state.setDrafting(null);
        state.clearSelection();
        state.setTool('select');
        state.setPendingSymbol(null);
        state.setStatus('');
        autoRouteFlipRef.current = false;
        setTextInput(null);
        return;
      }

      if (e.key === 'Enter') {
        if (ed.drafting && ed.drafting.points.length > 0) {
          const result = onToolCommit(ed.tool, {
            layerId: proj.activeLayerId,
            draft: ed.drafting.points,
            cursor: ed.cursorSnap ?? ed.cursor,
            ortho: ed.ortho,
            pendingSymbol: ed.pendingSymbol,
          });
          if (result.committed.length) {
            state.addEntities(result.committed);
            applyAutoFeaturesForCommitted(result.committed);
          }
          state.setDrafting(null);
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ed.selection.size > 0) state.removeEntities(Array.from(ed.selection));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        state.flipEntities('horizontal');
        return;
      }

      // Ctrl+Shift+V for flip vertical. Must check before Ctrl+V (paste).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        state.flipEntities('vertical');
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        state.setSelection(sh.entityOrder);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        state.copySelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const cursor = ed.cursorSnap ?? ed.cursor;
        state.pasteFromClipboard(cursor);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        state.duplicateSelection();
        return;
      }

      // Ctrl/Cmd + Shift + P  →  Export PDF
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        exportSheetPDF(proj);
        return;
      }

      if (e.key === 'F3') {
        e.preventDefault();
        state.setSnap({ osnap: !ed.snap.osnap });
        return;
      }

      if (e.key === 'F8') {
        e.preventDefault();
        state.setOrtho(!ed.ortho);
        return;
      }

      // R: rotate selected symbols/text 90° if anything's selected; otherwise
      // fall through and let the tool-shortcut path bind R to Rectangle.
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (ed.selection.size > 0) {
          let rotated = false;
          for (const id of ed.selection) {
            const ent = sh.entities[id];
            if (!ent) continue;
            if (ent.kind === 'symbol' || ent.kind === 'text' || ent.kind === 'wire-label' || ent.kind === 'ellipse') {
              state.updateEntity(id, { rotation: (ent as any).rotation + Math.PI / 2 } as any);
              rotated = true;
            }
          }
          if (rotated) return;
        }
        // No rotatable selection — let the tool-map below switch tools.
      }

      const lower = e.key.toLowerCase();
      if (!e.metaKey && !e.ctrlKey && !e.altKey && TOOL_MAP[lower]) {
        state.setTool(TOOL_MAP[lower]);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
        setPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // React's synthetic onWheel is attached as a passive listener (React 17+),
  // so preventDefault() inside the React handler can't stop the browser from
  // also doing its native pinch-to-zoom. Attach a native non-passive listener
  // whose only job is to call preventDefault.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => { e.preventDefault(); };
    c.addEventListener('wheel', stop, { passive: false });
    return () => c.removeEventListener('wheel', stop);
  }, []);

  return (
    <div ref={wrapperRef} className="canvas-container" style={{ flex: 1, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        className={`canvas-2d tool-${spaceHeld ? 'pan' : editor.tool}${panning ? ' panning' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHover(null); setPanning(false); setMarquee(null); setDraggingSelection(null); }}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ touchAction: 'none' }}
        tabIndex={0}
      />
      <CoordReadout />
      <CommandHint />
      {textInput && (
        <TextInput
          screen={textInput.screen}
          onCancel={() => setTextInput(null)}
          onCommit={(text) => {
            if (text.trim()) {
              addEntities([
                {
                  id: crypto.randomUUID().slice(0, 10),
                  kind: 'text',
                  layerId: textInput.layerId,
                  visible: true,
                  locked: false,
                  position: textInput.world,
                  text,
                  fontSize: 4,
                  rotation: 0,
                  align: 'left',
                },
              ]);
            }
            setTextInput(null);
          }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function TextInput({
  screen,
  onCommit,
  onCancel,
}: {
  screen: Vec2;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      className="canvas-text-input"
      style={{ left: screen.x, top: screen.y }}
      placeholder="Text…"
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        // Don't let the canvas keydown handler swallow these keys.
        e.stopPropagation();
      }}
    />
  );
}

function CoordReadout() {
  const cursor = useStore((s) => s.editor.cursor);
  const cursorSnap = useStore((s) => s.editor.cursorSnap);
  const viewport = useStore((s) => s.editor.viewport);
  const c = cursorSnap ?? cursor;
  return (
    <div className="coord-readout">
      X {c.x.toFixed(2)}  Y {c.y.toFixed(2)}  Z {viewport.zoom.toFixed(2)}
    </div>
  );
}

function CommandHint() {
  const status = useStore((s) => s.editor.statusMessage);
  const tool = useStore((s) => s.editor.tool);
  const drafting = useStore((s) => s.editor.drafting);
  return (
    <div className="canvas-overlay">
      Tool: {tool.toUpperCase()} {drafting ? `(${drafting.points.length} pt)` : ''}
      {status ? ` • ${status}` : ' • Hold Space + drag to pan, Alt+←/→ to step through views'}
    </div>
  );
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const editor = useStore((s) => s.editor);
  const removeEntities = useStore((s) => s.removeEntities);
  const setSelection = useStore((s) => s.setSelection);
  const updateEntity = useStore((s) => s.updateEntity);
  const copySelection = useStore((s) => s.copySelection);
  const pasteFromClipboard = useStore((s) => s.pasteFromClipboard);
  const duplicateSelection = useStore((s) => s.duplicateSelection);
  const project = useStore((s) => s.project);
  const sheet = project.sheets[project.activeSheetId];

  const sel = Array.from(editor.selection);
  const has = sel.length > 0;

  const close = () => onClose();

  useEffect(() => {
    const handler = () => close();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  });

  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      <div className="item" onClick={() => { if (has) copySelection(); close(); }}>
        Copy <span className="key">⌘C</span>
      </div>
      <div className="item" onClick={() => { pasteFromClipboard(editor.cursorSnap ?? editor.cursor); close(); }}>
        Paste <span className="key">⌘V</span>
      </div>
      <div className="item" onClick={() => { if (has) duplicateSelection(); close(); }}>
        Duplicate <span className="key">⌘D</span>
      </div>
      <div className="divider" />
      <div className="item" onClick={() => { if (has) removeEntities(sel); close(); }}>
        Delete <span className="key">Del</span>
      </div>
      <div className="item" onClick={() => {
        for (const id of sel) {
          const e = sheet.entities[id];
          if (e && e.kind === 'symbol') updateEntity(id, { rotation: e.rotation + Math.PI / 2 } as Partial<Entity>);
        }
        close();
      }}>Rotate 90° <span className="key">R</span></div>
      <div className="item" onClick={() => {
        for (const id of sel) {
          const e = sheet.entities[id];
          if (e && e.kind === 'symbol') updateEntity(id, { mirror: !e.mirror } as Partial<Entity>);
        }
        close();
      }}>Mirror <span className="key">M</span></div>
      <div className="divider" />
      <div className="item" onClick={() => { setSelection(sheet.entityOrder); close(); }}>
        Select all <span className="key">⌘A</span>
      </div>
      <div className="item" onClick={() => { setSelection([]); close(); }}>Deselect</div>
    </div>
  );
}
