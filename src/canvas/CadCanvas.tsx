import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { render2d } from '../render/render2d';
import { screenToWorld, zoomAtPoint } from '../lib/viewport';
import { computeSnap } from '../lib/snap';
import { findEntityAt, findEntitiesInRect } from '../lib/hittest';
import { onToolClick, onToolCommit } from './tools';
import { getSymbol } from '../symbols';
import type { Vec2 } from '../types';
import { sub, add } from '../lib/math';

export function CadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [draggingSelection, setDraggingSelection] = useState<{
    start: Vec2;
    initial: Map<string, any>;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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

  const sheet = project.sheets[project.activeSheetId];
  const activeLayerId = project.activeLayerId;
  const hasFitOnceRef = useRef(false);

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

  // Auto-fit page to visible canvas on first real measurement so the drawing
  // fills the available area instead of showing a small portion of the page.
  useEffect(() => {
    if (hasFitOnceRef.current) return;
    if (size.w < 100 || size.h < 100) return;
    if (!sheet) return;
    const padding = 40;
    const zx = (size.w - padding * 2) / sheet.width;
    const zy = (size.h - padding * 2) / sheet.height;
    const zoom = Math.max(0.3, Math.min(zx, zy));
    setViewport({ x: sheet.width / 2, y: sheet.height / 2, zoom });
    hasFitOnceRef.current = true;
  }, [size.w, size.h, sheet, setViewport]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = size.w * dpr;
        canvas.height = size.h * dpr;
        canvas.style.width = `${size.w}px`;
        canvas.style.height = `${size.h}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          render2d(ctx, project, editor, {
            width: size.w,
            height: size.h,
            dpr,
            symbolLookup: getSymbol,
          });

          // marquee
          if (marquee) {
            const a = marquee.a;
            const b = marquee.b;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            const fullEnclosed = b.x > a.x; // dragging right = window, left = crossing
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
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [project, editor, size, dpr, marquee]);

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
    setCursor(world, snap.kind === 'none' ? null : snap.point);

    if (panning) {
      // We pan via the dragstart delta — handled in mousedown w/ a temp ref,
      // but since we use simple state, recompute pan from movementX/Y here.
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
      // move selected entities by delta from initial
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
    initial: any,
    dx: number,
    dy: number
  ) => {
    const e = sheet.entities[id];
    if (!e) return;
    const offset = (p: Vec2) => ({ x: p.x + dx, y: p.y + dy });
    const offsetArr = (pts: Vec2[]) => pts.map(offset);
    switch (initial.kind) {
      case 'line':
        updateEntity(id, { a: offset(initial.a), b: offset(initial.b) } as any);
        break;
      case 'rectangle':
        updateEntity(id, { a: offset(initial.a), b: offset(initial.b) } as any);
        break;
      case 'circle':
      case 'arc':
      case 'ellipse':
        updateEntity(id, { center: offset(initial.center) } as any);
        break;
      case 'polyline':
      case 'wire':
      case 'bus':
        updateEntity(id, { points: offsetArr(initial.points) } as any);
        break;
      case 'text':
        updateEntity(id, { position: offset(initial.position) } as any);
        break;
      case 'symbol':
        updateEntity(id, { position: offset(initial.position) } as any);
        break;
      case 'dimension':
        updateEntity(id, { a: offset(initial.a), b: offset(initial.b) } as any);
        break;
      case 'wire-label':
        updateEntity(id, { position: offset(initial.position) } as any);
        break;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setContextMenu(null);
    canvasRef.current?.focus();

    // Middle mouse or Space = pan
    if (e.button === 1 || (e.button === 0 && editor.tool === 'pan')) {
      setPanning(true);
      return;
    }

    // Right mouse = context menu (if select tool) or commit drafting
    if (e.button === 2) {
      if (editor.drafting && editor.drafting.points.length > 0) {
        const result = onToolCommit(editor.tool, {
          layerId: activeLayerId,
          draft: editor.drafting.points,
          cursor: editor.cursorSnap ?? editor.cursor,
          ortho: editor.ortho,
          pendingSymbol: editor.pendingSymbol,
        });
        if (result.committed.length) addEntities(result.committed);
        setDrafting(null);
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

    // Handle by tool
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
        // start drag
        const initial = new Map();
        const ids = editor.selection.has(hit) ? Array.from(editor.selection) : [hit];
        for (const id of ids) {
          const ent = sheet.entities[id];
          if (ent) initial.set(id, JSON.parse(JSON.stringify(ent)));
        }
        if (!editor.selection.has(hit)) initial.set(hit, JSON.parse(JSON.stringify(sheet.entities[hit])));
        setDraggingSelection({ start: snapped, initial });
      } else {
        if (!e.shiftKey) clearSelection();
        // begin marquee
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
      const txt = window.prompt('Text:', '');
      if (txt) {
        addEntities([
          {
            id: crypto.randomUUID().slice(0, 10),
            kind: 'text',
            layerId: activeLayerId,
            visible: true,
            locked: false,
            position: snapped,
            text: txt,
            fontSize: 4,
            rotation: 0,
            align: 'left',
          },
        ]);
      }
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
    if (result.committed.length) addEntities(result.committed);
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
    const factor = e.deltaY > 0 ? 0.85 : 1.15;
    const sp = eventToScreen(e);
    setViewport(zoomAtPoint(editor.viewport, sp, size.w, size.h, factor));
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
      // Keep pinch start centroid stationary; also apply pan delta of centroid
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
      // Treat as a click — synthesize a mousedown handler call
      const fakeEvent = {
        button: 0,
        clientX: st.startX,
        clientY: st.startY,
        shiftKey: false,
        stopPropagation: () => {},
        preventDefault: () => {},
      } as unknown as React.MouseEvent;
      handleMouseDown(fakeEvent);
      // For one-shot tools that don't need a drag, also fire mouseUp so
      // marquee state etc. resets cleanly.
      handleMouseUp(fakeEvent);
    }
    if (e.touches.length === 0) {
      touchRef.current = null;
    }
  };

  // Rotate selection or pending symbol on R
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (e.key === 'Escape') {
      setDrafting(null);
      clearSelection();
      setTool('select');
      useStore.getState().setPendingSymbol(null);
      setStatus('');
      return;
    }
    if (e.key === 'Enter') {
      if (editor.drafting && editor.drafting.points.length > 0) {
        const result = onToolCommit(editor.tool, {
          layerId: activeLayerId,
          draft: editor.drafting.points,
          cursor: editor.cursorSnap ?? editor.cursor,
          ortho: editor.ortho,
          pendingSymbol: editor.pendingSymbol,
        });
        if (result.committed.length) addEntities(result.committed);
        setDrafting(null);
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.selection.size > 0) {
        removeEntities(Array.from(editor.selection));
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) useStore.getState().redo();
      else useStore.getState().undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(sheet.entityOrder);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      // duplicate
      e.preventDefault();
      duplicateSelection();
      return;
    }

    // Tool shortcuts
    const toolMap: Record<string, any> = {
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
    if (!e.metaKey && !e.ctrlKey && !e.altKey && toolMap[e.key.toLowerCase()]) {
      setTool(toolMap[e.key.toLowerCase()]);
      return;
    }
    if (e.key === 'F8') {
      e.preventDefault();
      setOrtho(!editor.ortho);
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      // rotate selection 90 degrees
      const ids = Array.from(editor.selection);
      for (const id of ids) {
        const ent = sheet.entities[id];
        if (ent && ent.kind === 'symbol') {
          updateEntity(id, { rotation: ent.rotation + Math.PI / 2 } as any);
        }
      }
    }
  };

  const duplicateSelection = () => {
    const ids = Array.from(editor.selection);
    if (ids.length === 0) return;
    const offset = 10;
    const newEntities = [];
    const newIds: string[] = [];
    for (const id of ids) {
      const ent = sheet.entities[id];
      if (!ent) continue;
      const cp = JSON.parse(JSON.stringify(ent));
      cp.id = crypto.randomUUID().slice(0, 10);
      newIds.push(cp.id);
      moveDeepEntity(cp, offset, offset);
      newEntities.push(cp);
    }
    addEntities(newEntities);
    setSelection(newIds);
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div ref={wrapperRef} className="canvas-container" style={{ flex: 1, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        className={`canvas-2d tool-${editor.tool}${panning ? ' panning' : ''}`}
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

const moveDeepEntity = (ent: any, dx: number, dy: number) => {
  if (ent.a) ent.a = { x: ent.a.x + dx, y: ent.a.y + dy };
  if (ent.b) ent.b = { x: ent.b.x + dx, y: ent.b.y + dy };
  if (ent.center) ent.center = { x: ent.center.x + dx, y: ent.center.y + dy };
  if (ent.position) ent.position = { x: ent.position.x + dx, y: ent.position.y + dy };
  if (ent.points) ent.points = ent.points.map((p: Vec2) => ({ x: p.x + dx, y: p.y + dy }));
};

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
      {status ? ` • ${status}` : ''}
    </div>
  );
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const editor = useStore((s) => s.editor);
  const removeEntities = useStore((s) => s.removeEntities);
  const setSelection = useStore((s) => s.setSelection);
  const updateEntity = useStore((s) => s.updateEntity);
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
      <div className="item" onClick={() => { has && removeEntities(sel); close(); }}>
        Delete <span className="key">Del</span>
      </div>
      <div className="item" onClick={() => {
        for (const id of sel) {
          const e = sheet.entities[id];
          if (e && e.kind === 'symbol') updateEntity(id, { rotation: e.rotation + Math.PI / 2 } as any);
        }
        close();
      }}>Rotate 90° <span className="key">R</span></div>
      <div className="item" onClick={() => {
        for (const id of sel) {
          const e = sheet.entities[id];
          if (e && e.kind === 'symbol') updateEntity(id, { mirror: !e.mirror } as any);
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
