import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useLayers, useSheetOrder, useSheets } from '../state/selectors';
import { fuzzyScore } from '../lib/commands';
import { entityBounds, clamp } from '../lib/math';
import { transformSymbolPoint } from '../lib/hittest';
import { getSymbol } from '../symbols';
import type { Bounds, Entity, Project, Viewport } from '../types';

const MAX_RESULTS = 50;

// One searchable row: an entity plus the denormalized context (sheet, layer)
// the search and the result list both need.
interface EntityHit {
  entityId: string;
  sheetId: string;
  sheetName: string;
  layerName: string;
  layerColor: string;
  kind: string;
  /** Best human label: tag, label, text, name, … falling back to the id. */
  label: string;
  /** Lower-cased haystack the fuzzy matcher runs against. */
  haystack: string;
}

// Pull the most meaningful display label out of an entity. Tags win (they
// are the identifiers engineers actually search for), then labels/names,
// then visible text, then the raw id as a last resort.
const entityLabel = (e: Entity): string => {
  const anyE = e as any;
  if (typeof anyE.tag === 'string' && anyE.tag) return anyE.tag;
  if (typeof anyE.label === 'string' && anyE.label) return anyE.label;
  if (typeof anyE.name === 'string' && anyE.name) return anyE.name;
  if (typeof anyE.text === 'string' && anyE.text) return anyE.text;
  if (typeof anyE.wireNumber === 'string' && anyE.wireNumber) return anyE.wireNumber;
  if (typeof anyE.sourceName === 'string' && anyE.sourceName) return anyE.sourceName;
  return e.id;
};

// Flatten every entity on every sheet into searchable rows, in sheet order
// then draw order so results read top-to-bottom like the project tree.
// Only needs the sheet/layer slices, so the modal can subscribe narrowly.
const buildIndex = (
  project: Pick<Project, 'sheetOrder' | 'sheets' | 'layers'>,
): EntityHit[] => {
  const hits: EntityHit[] = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const entityId of sheet.entityOrder) {
      const e = sheet.entities[entityId];
      if (!e) continue;
      const layer = project.layers[e.layerId];
      const label = entityLabel(e);
      // Sub-type detail (tray vs ladder, MCC vs panelboard, …) makes "tray"
      // or "ups" queries land on the right rows.
      const subKind = (e as any).containmentType ?? (e as any).equipmentKind ?? '';
      hits.push({
        entityId,
        sheetId,
        sheetName: sheet.name,
        layerName: layer?.name ?? '',
        layerColor: layer?.color ?? '#888888',
        kind: e.kind,
        label,
        haystack: `${label} ${e.kind} ${subKind} ${entityId} ${layer?.name ?? ''} ${sheet.name}`,
      });
    }
  }
  return hits;
};

// World-space bounds for an entity, refined for symbols (the generic
// entityBounds only approximates symbol extents).
const boundsForEntity = (e: Entity): Bounds => {
  if (e.kind === 'symbol') {
    const def = getSymbol(e.symbolId);
    if (def) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const corners = [
        { x: def.bounds.minX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.minY },
        { x: def.bounds.maxX, y: def.bounds.maxY },
        { x: def.bounds.minX, y: def.bounds.maxY },
      ].map((c) => transformSymbolPoint(e, c));
      for (const c of corners) {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
      }
      return { minX, minY, maxX, maxY };
    }
  }
  return entityBounds(e);
};

// Viewport centred on the entity, zoomed so its bounds fill the canvas with
// padding. Point-like entities (markers, supports) get a minimum world size
// so the zoom doesn't blow up to the 80×/mm ceiling.
const viewportForBounds = (b: Bounds, canvasW: number, canvasH: number): Viewport => {
  const minHalf = 20; // mm — floor for degenerate / point bounds
  const halfW = Math.max((b.maxX - b.minX) / 2, minHalf);
  const halfH = Math.max((b.maxY - b.minY) / 2, minHalf);
  const paddingPx = 60;
  const zx = (canvasW - paddingPx * 2) / (halfW * 2);
  const zy = (canvasH - paddingPx * 2) / (halfH * 2);
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    zoom: clamp(Math.min(zx, zy), 0.1, 80),
  };
};

// Best-effort canvas size, mirroring zoomExtents in lib/commands.ts: in
// 3D-only view the 2D canvas is unmounted, so fall back to window dims.
const canvasSize = (): { w: number; h: number } => {
  const canvas = document.querySelector('canvas.canvas-2d') as HTMLCanvasElement | null;
  return {
    w: canvas?.clientWidth ?? window.innerWidth - 500,
    h: canvas?.clientHeight ?? window.innerHeight - 200,
  };
};

/**
 * ⌘F find-entity dialog. Fuzzy-searches every entity on every sheet by tag,
 * label, kind, id, layer name, and sheet name. Enter/click switches to the
 * entity's sheet if needed, selects it, and zooms the viewport to its
 * bounds. Follows the CommandPalette interaction model (focus trap, arrow
 * navigation, aria combobox/listbox).
 */
export function FindEntityModal({ onClose }: { onClose: () => void }) {
  const sheets = useSheets();
  const sheetOrder = useSheetOrder();
  const layers = useLayers();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const index = useMemo(
    () => buildIndex({ sheetOrder, sheets, layers }),
    [sheetOrder, sheets, layers],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return index.slice(0, MAX_RESULTS);
    const scored: { hit: EntityHit; score: number; order: number }[] = [];
    index.forEach((hit, order) => {
      const score = fuzzyScore(q, hit.haystack);
      if (score !== null) scored.push({ hit, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.slice(0, MAX_RESULTS).map((s) => s.hit);
  }, [index, query]);

  // Clamp instead of resetting in an effect so a shrinking result list never
  // leaves the highlight on a row that no longer exists.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeHit: EntityHit | undefined = results[activeIndex];

  // Focus trap bookkeeping: remember where focus was, take it, give it back.
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      prevFocusRef.current?.focus?.();
    };
  }, []);

  // Keep the highlighted option visible while arrowing through the list.
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  const jumpTo = (hit: EntityHit) => {
    onClose();
    const store = useStore.getState();
    const sameSheet = store.project.activeSheetId === hit.sheetId;
    if (!sameSheet) store.setActiveSheet(hit.sheetId);
    store.setSelection([hit.entityId]);
    const applyViewport = () => {
      const s = useStore.getState();
      const e = s.project.sheets[hit.sheetId]?.entities[hit.entityId];
      if (!e) return;
      const { w, h } = canvasSize();
      s.setViewport(viewportForBounds(boundsForEntity(e), w, h));
      s.setStatus(`Located ${hit.label} on ${hit.sheetName}`);
    };
    if (sameSheet) {
      applyViewport();
    } else {
      // CadCanvas auto-fits the viewport when the active sheet changes;
      // defer two frames so our zoom-to-entity lands after that effect.
      requestAnimationFrame(() => requestAnimationFrame(applyViewport));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Nothing here should fall through to the canvas / app-level shortcut
    // dispatchers while the dialog is open.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      onClose(); // ⌘F toggles
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setActive((activeIndex + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) setActive((activeIndex - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeHit) jumpTo(activeHit);
    } else if (e.key === 'Tab') {
      // The input is the only tab stop — swallow Tab to trap focus.
      e.preventDefault();
    }
  };

  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk" role="dialog" aria-label="Find entity">
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="find-entity-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeHit ? `find-entity-opt-${activeHit.entityId}` : undefined}
          placeholder="Find entity by tag, type, id, or layer…"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list" id="find-entity-listbox" role="listbox" ref={listRef}>
          {results.map((hit, i) => (
            <div
              key={`${hit.sheetId}:${hit.entityId}`}
              id={`find-entity-opt-${hit.entityId}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`cmdk-item${i === activeIndex ? ' active' : ''}`}
              // preventDefault keeps focus in the input (the trap) so a
              // click jumps to the entity without first blurring the dialog.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo(hit)}
              onMouseMove={() => setActive(i)}
            >
              <span
                className="find-entity-swatch"
                style={{ background: hit.layerColor }}
                title={hit.layerName}
              />
              <span className="cmdk-title">{hit.label}</span>
              <span className="find-entity-kind">{hit.kind}</span>
              <span className="find-entity-sheet">{hit.sheetName}</span>
            </div>
          ))}
          {results.length === 0 && <div className="cmdk-empty">No matching entities</div>}
        </div>
      </div>
    </div>
  );
}
