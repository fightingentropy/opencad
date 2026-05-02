import React from 'react';
import { useStore } from '../state/store';
import type { ToolId } from '../types';

const ICONS: Record<ToolId, JSX.Element> = {
  'select': <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7 17 2-7 7-2z"/></svg>,
  'pan':    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M5 11V6a2 2 0 0 1 4 0v3M9 9V4a2 2 0 0 1 4 0v6m0-3a2 2 0 0 1 4 0v5m0-2a2 2 0 0 1 4 0v6a8 8 0 0 1-16 0v-3l3 3"/></svg>,
  'line':   <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.5" fill="currentColor"/><circle cx="20" cy="4" r="1.5" fill="currentColor"/></svg>,
  'wire':   <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><polyline points="3,18 9,18 9,6 15,6 15,18 21,18"/></svg>,
  'bus':    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="3.5" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>,
  'rectangle': <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><rect x="4" y="6" width="16" height="12"/></svg>,
  'circle':    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><circle cx="12" cy="12" r="8"/></svg>,
  'arc':       <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M4 18 A 8 8 0 0 1 20 18"/></svg>,
  'polyline':  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><polyline points="3,18 8,8 14,14 21,5"/></svg>,
  'text':      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><path d="M5 5h14M12 5v14M9 19h6"/></svg>,
  'dimension': <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M3 12h18M3 8v8M21 8v8M9 6v3M9 15v3M15 6v3M15 15v3"/></svg>,
  'symbol':    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M2 12h6M16 12h6M12 2v6M12 16v6"/></svg>,
  'erase':     <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><path d="M3 17l8-8 7 7-3 3H6zM12 4l4 4"/></svg>,
  'measure':   <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>,
};

const TOOL_DEFS: { id: ToolId; label: string; group: string; key?: string }[] = [
  { id: 'select', label: 'Select', group: 'Edit', key: 'S' },
  { id: 'pan', label: 'Pan', group: 'Edit' },
  { id: 'erase', label: 'Erase', group: 'Edit', key: 'E' },
  { id: 'line', label: 'Line', group: 'Draw', key: 'L' },
  { id: 'rectangle', label: 'Rect', group: 'Draw', key: 'R' },
  { id: 'circle', label: 'Circle', group: 'Draw', key: 'C' },
  { id: 'arc', label: 'Arc', group: 'Draw', key: 'A' },
  { id: 'polyline', label: 'Polyline', group: 'Draw', key: 'P' },
  { id: 'wire', label: 'Wire', group: 'Wire', key: 'W' },
  { id: 'bus', label: 'Bus', group: 'Wire' },
  { id: 'text', label: 'Text', group: 'Annot', key: 'T' },
  { id: 'dimension', label: 'Dim', group: 'Annot', key: 'D' },
  { id: 'measure', label: 'Measure', group: 'Annot', key: 'M' },
];

const GROUPS = ['Edit', 'Draw', 'Wire', 'Annot'];

export function Ribbon() {
  const tool = useStore((s) => s.editor.tool);
  const setTool = useStore((s) => s.setTool);
  const ortho = useStore((s) => s.editor.ortho);
  const snap = useStore((s) => s.editor.snap);
  const viewMode = useStore((s) => s.editor.viewMode);
  const setOrtho = useStore((s) => s.setOrtho);
  const setSnap = useStore((s) => s.setSnap);
  const setViewMode = useStore((s) => s.setViewMode);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);

  return (
    <div className="ribbon">
      {GROUPS.map((g) => (
        <div className="ribbon-group" key={g}>
          <div className="ribbon-buttons">
            {TOOL_DEFS.filter((t) => t.group === g).map((t) => (
              <button
                key={t.id}
                className={`tool-btn${tool === t.id ? ' active' : ''}`}
                onClick={() => setTool(t.id)}
                title={`${t.label}${t.key ? ` (${t.key})` : ''}`}
              >
                <span className="icon">{ICONS[t.id]}</span>
                <span className="label">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="ribbon-group-label">{g}</div>
        </div>
      ))}

      <div className="ribbon-group">
        <div className="ribbon-buttons">
          <button className="tool-btn" onClick={undo} disabled={past === 0} title="Undo (⌘Z)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><path d="M3 8h13a5 5 0 0 1 0 10h-3M3 8l4-4M3 8l4 4"/></svg>
            </span>
            <span className="label">Undo</span>
          </button>
          <button className="tool-btn" onClick={redo} disabled={future === 0} title="Redo (⌘⇧Z)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><path d="M21 8H8a5 5 0 0 0 0 10h3M21 8l-4-4M21 8l-4 4"/></svg>
            </span>
            <span className="label">Redo</span>
          </button>
        </div>
        <div className="ribbon-group-label">History</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-buttons">
          <button className={`tool-btn${ortho ? ' active' : ''}`} onClick={() => setOrtho(!ortho)} title="Ortho (F8)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M3 12h18M12 3v18"/></svg>
            </span>
            <span className="label">Ortho</span>
          </button>
          <button className={`tool-btn${snap.enabled ? ' active' : ''}`} onClick={() => setSnap({ enabled: !snap.enabled })} title="Snap (F9)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M3 12h6M15 12h6M12 3v6M12 15v6"/></svg>
            </span>
            <span className="label">Snap</span>
          </button>
          <button className={`tool-btn${snap.grid ? ' active' : ''}`} onClick={() => setSnap({ grid: !snap.grid })} title="Grid Snap (F7)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>
            </span>
            <span className="label">Grid</span>
          </button>
        </div>
        <div className="ribbon-group-label">Snap</div>
      </div>

      <div className="ribbon-group">
        <div className="ribbon-buttons">
          <button className={`tool-btn${viewMode === '2d' ? ' active' : ''}`} onClick={() => setViewMode('2d')} title="2D schematic only">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><rect x="3" y="5" width="18" height="14"/><path d="M7 9l4 4 6-6"/></svg>
            </span>
            <span className="label">2D</span>
          </button>
          <button className={`tool-btn${viewMode === 'split' ? ' active' : ''}`} onClick={() => setViewMode('split')} title="Split view (2D + 3D)">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><rect x="3" y="5" width="18" height="14"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
            </span>
            <span className="label">Split</span>
          </button>
          <button className={`tool-btn${viewMode === '3d' ? ' active' : ''}`} onClick={() => setViewMode('3d')} title="3D panel only">
            <span className="icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>
            </span>
            <span className="label">3D</span>
          </button>
        </div>
        <div className="ribbon-group-label">View</div>
      </div>
    </div>
  );
}
