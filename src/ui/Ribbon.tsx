import React from 'react';
import { AppIcon } from './AppIcon';
import { useStore } from '../state/store';
import type { ToolId } from '../types';
import { runCommand, shortcutHint } from '../lib/commands';

// Partial because new whole-site tools (equipment, support, ...) don't all
// have icons yet — those tools are surfaced from menus rather than the ribbon.
const ICONS: Partial<Record<ToolId, JSX.Element>> = {
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
  'trunking':  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><rect x="3" y="9" width="18" height="6"/><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="1 1"/></svg>,
  'basket':    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><rect x="3" y="9" width="18" height="6"/><line x1="6" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="6" y2="15"/><line x1="12" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="21" y2="15"/></svg>,
  'tray':      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><path d="M3 9 v6 M21 9 v6 M3 15 H21"/><line x1="7" y1="13" x2="7" y2="11"/><line x1="11" y1="13" x2="11" y2="11"/><line x1="15" y1="13" x2="15" y2="11"/><line x1="19" y1="13" x2="19" y2="11"/></svg>,
  'conduit':   <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>,
  'wall':      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><rect x="3" y="10" width="18" height="4" fill="currentColor" fillOpacity="0.3"/></svg>,
  'room':      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.5"><rect x="4" y="6" width="16" height="12"/><line x1="4" y1="12" x2="20" y2="12"/></svg>,
  'equipment': <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="10" height="10"/><line x1="6" y1="6" x2="10" y2="6"/><line x1="6" y1="10" x2="10" y2="10"/></svg>,
  'support':   <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v10M3 13h10"/><path d="M3 6l4 4"/></svg>,
  'leader':    <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="13" x2="7" y2="9"/><polyline points="3,13 5,11 3,9"/><line x1="7" y1="9" x2="13" y2="9"/></svg>,
  'level-marker': <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="8,4 12,10 4,10"/><line x1="2" y1="13" x2="14" y2="13"/></svg>,
  'north-arrow': <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="3" x2="8" y2="13"/><polyline points="6,5 8,3 10,5"/></svg>,
  'scale-bar': <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="12" height="4"/><line x1="6" y1="6" x2="6" y2="10"/><line x1="10" y1="6" x2="10" y2="10"/></svg>,
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
  { id: 'trunking', label: 'Trunk', group: 'Contain' },
  { id: 'basket', label: 'Basket', group: 'Contain' },
  { id: 'tray', label: 'Tray', group: 'Contain' },
  { id: 'conduit', label: 'Conduit', group: 'Contain' },
  { id: 'wall', label: 'Wall', group: 'Building' },
  { id: 'room', label: 'Room', group: 'Building' },
  { id: 'equipment', label: 'Equip', group: 'Place' },
  { id: 'support', label: 'Sup', group: 'Place' },
  { id: 'leader', label: 'Leader', group: 'Place' },
  { id: 'level-marker', label: 'Level', group: 'Place' },
  { id: 'north-arrow', label: 'North', group: 'Place' },
  { id: 'scale-bar', label: 'Scale', group: 'Place' },
  { id: 'text', label: 'Text', group: 'Annot', key: 'T' },
  { id: 'dimension', label: 'Dim', group: 'Annot', key: 'D' },
  { id: 'measure', label: 'Measure', group: 'Annot', key: 'M' },
];

const PRIMARY_TOOLS: ToolId[] = ['select', 'pan', 'line', 'polyline', 'rectangle', 'circle', 'wire', 'text', 'dimension', 'measure'];

export function Ribbon() {
  const tool = useStore((s) => s.editor.tool);
  const setTool = useStore((s) => s.setTool);
  return <div className="ribbon" role="toolbar" aria-label="Drawing tools">
    {PRIMARY_TOOLS.map((id) => {
      const item = TOOL_DEFS.find((entry) => entry.id === id)!;
      return <button key={id} type="button" className={`tool-btn${tool === id ? ' active' : ''}`} aria-label={item.label} aria-pressed={tool === id} onClick={() => setTool(id)} title={`${item.label}${item.key ? ` (${item.key})` : ''}`}><span className="icon">{ICONS[id]}</span></button>;
    })}
    <span className="ribbon-divider" />
    <button type="button" className="tool-btn" aria-label="Add component or find a tool" onClick={() => runCommand('help.palette')} title={`Add component or find a tool (${shortcutHint('help.palette')})`}><AppIcon name="plus" /></button>
  </div>;
}
