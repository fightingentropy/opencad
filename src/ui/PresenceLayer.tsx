import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { worldToScreen } from '../lib/viewport';
import {
  loadCollab,
  isActive as isCollabActive,
  onActiveChange,
  type RuntimePresence,
} from '../collab/runtime';

// Transparent overlay that draws remote peers' cursors and selection
// outlines. Mounted in App.tsx above the canvas only when a collab
// session is active. Re-renders on awareness updates and on viewport
// changes (so cursors stay anchored to their world coords as the
// local user pans / zooms).

const STALE_MS = 30_000;

export function PresenceLayer() {
  const [active, setActive] = useState(isCollabActive());
  const [peers, setPeers] = useState<RuntimePresence[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track collab lifecycle — when the user disconnects the layer
  // unmounts itself (App also gates rendering, but this lets the
  // layer survive a mid-session toggle).
  useEffect(() => {
    return onActiveChange(setActive);
  }, []);

  // Subscribe to remote presence once collab is loaded. We pull the
  // module via the lazy loader so this component pays no Yjs cost
  // until the user actually starts a session.
  useEffect(() => {
    if (!active) {
      setPeers([]);
      return;
    }
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const mod = await loadCollab();
      if (cancelled) return;
      unsub = mod.onRemotePresence((states) => {
        // Drop stale presences (peer left without disconnecting cleanly).
        const now = Date.now();
        setPeers(states.filter((s) => !s.ts || now - s.ts < STALE_MS));
      });
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [active]);

  // Track our wrapper size so worldToScreen knows the canvas extents.
  useEffect(() => {
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
    return () => ro.disconnect();
  }, [active]);

  const viewport = useStore((s) => s.editor.viewport);
  const activeSheetId = useStore((s) => s.project.activeSheetId);
  const sheet = useStore((s) => s.project.sheets[s.project.activeSheetId]);

  if (!active) return null;

  // Only show peers on the same sheet — cross-sheet cursors aren't
  // useful in the canvas overlay.
  const visible = peers.filter((p) => !p.sheetId || p.sheetId === activeSheetId);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {visible.map((peer) => {
        const cursor = peer.cursor;
        if (!cursor || size.w === 0) return null;
        const screen = worldToScreen(cursor, viewport, size.w, size.h);
        // Off-screen — skip
        if (
          screen.x < -40 || screen.y < -40 ||
          screen.x > size.w + 40 || screen.y > size.h + 40
        ) return null;

        // Draw selection bounding boxes (dashed) for entities the
        // peer has selected. Each entity's bounds gets a thin dashed
        // outline in the peer's colour.
        const selectionBoxes = peer.selection
          ? peer.selection
              .map((id) => sheet?.entities[id])
              .filter(Boolean)
              .map((e) => entityBoundsForRender(e!))
              .filter((b): b is NonNullable<ReturnType<typeof entityBoundsForRender>> => !!b)
              .map((b, i) => {
                const a = worldToScreen({ x: b.minX, y: b.maxY }, viewport, size.w, size.h);
                const c = worldToScreen({ x: b.maxX, y: b.minY }, viewport, size.w, size.h);
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: a.x,
                      top: a.y,
                      width: c.x - a.x,
                      height: c.y - a.y,
                      border: `1px dashed ${peer.color}`,
                      pointerEvents: 'none',
                    }}
                  />
                );
              })
          : null;

        return (
          <React.Fragment key={peer.userId}>
            {selectionBoxes}
            <Cursor x={screen.x} y={screen.y} color={peer.color} name={peer.name} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Coloured arrow + name label, anchored at (x, y) which is the cursor
// tip. The arrow shape is an inline SVG so we can tint it with the
// peer's colour without juggling CSS variables.
function Cursor({ x, y, color, name }: { x: number; y: number; color: string; name: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-2px, -2px)',
        pointerEvents: 'none',
      }}
    >
      <svg
        width={20}
        height={22}
        viewBox="0 0 20 22"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
      >
        <path
          d="M2 2 L2 18 L7 14 L10 20 L13 19 L10 13 L17 12 Z"
          fill={color}
          stroke="#fff"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: 14,
          background: color,
          color: pickReadableTextColor(color),
          padding: '2px 6px',
          borderRadius: 3,
          fontSize: 11,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {name}
      </div>
    </div>
  );
}

// Pick black or white based on the colour's luminance — keeps the
// name label readable against bright peer colours.
function pickReadableTextColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  // Luminance approximation
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.6 ? '#000' : '#fff';
}

// Entity-bounds helper inlined so we don't depend on store internals.
// Mirrors the cases the store already handles for align/distribute.
import type { Entity, Vec2 } from '../types';

function entityBoundsForRender(e: Entity): { minX: number; minY: number; maxX: number; maxY: number } | null {
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
    case 'wall':
      return boundsOfPoints(e.points);
    case 'text':
    case 'wire-label':
    case 'symbol':
      return {
        minX: e.position.x - 5,
        minY: e.position.y - 5,
        maxX: e.position.x + 5,
        maxY: e.position.y + 5,
      };
    case 'fitting':
    case 'support':
    case 'penetration':
    case 'level-marker':
    case 'north-arrow':
    case 'scale-bar':
    case 'riser':
      return {
        minX: e.position.x - 5,
        minY: e.position.y - 5,
        maxX: e.position.x + 5,
        maxY: e.position.y + 5,
      };
    case 'fire-barrier':
    case 'leader':
    case 'revision-cloud':
    case 'cloud':
      return boundsOfPoints((e as { points: Vec2[] }).points);
    case 'equipment':
    case 'section-marker':
      return {
        minX: Math.min(e.a.x, e.b.x),
        minY: Math.min(e.a.y, e.b.y),
        maxX: Math.max(e.a.x, e.b.x),
        maxY: Math.max(e.a.y, e.b.y),
      };
    default:
      return null;
  }
}

function boundsOfPoints(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!pts || pts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
