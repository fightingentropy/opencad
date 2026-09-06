import React from 'react';
import { useStore } from '../state/store';
import { useActiveSheet, useProjectMeta } from '../state/selectors';
import { useSaveStatus } from '../state/save-status';

const formatSaveTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Autosave indicator driven by the save-status store (fed by io/persist). */
function SaveIndicator() {
  const status = useSaveStatus((s) => s.status);
  const lastSavedAt = useSaveStatus((s) => s.lastSavedAt);
  const error = useSaveStatus((s) => s.error);

  if (status === 'error') {
    return (
      <span
        className="status-section status-save status-save-error"
        title={`Autosave failed (${error ?? 'unknown error'}). Use File → Save to download a copy.${lastSavedAt ? ` Last saved ${formatSaveTime(lastSavedAt)}.` : ''}`}
      >
        Not saved — {error ?? 'save failed'}
      </span>
    );
  }
  return (
    <span className="status-section status-save">
      <span className={`save-indicator-dot${status === 'saving' ? ' saving' : ''}`} aria-hidden="true" />
      {status === 'saving' && 'Saving…'}
      {status === 'saved' && lastSavedAt !== null && <>Saved <span className="status-value">{formatSaveTime(lastSavedAt)}</span></>}
      {(status === 'idle' || (status === 'saved' && lastSavedAt === null)) && 'Autosave'}
    </span>
  );
}

export function StatusBar() {
  const { units, standard } = useProjectMeta();
  const sheet = useActiveSheet();
  const editor = useStore((s) => s.editor);
  const setOrtho = useStore((s) => s.setOrtho);
  const setSnap = useStore((s) => s.setSnap);
  const c = editor.cursorSnap ?? editor.cursor;
  const totalEntities = Object.keys(sheet?.entities ?? {}).length;
  const isModel = editor.viewMode === '3d';

  return (
    <div className={`status-bar${isModel ? ' status-bar-model' : ''}`} aria-label="Workspace status">
      {isModel ? (
        <span className="status-section status-workspace">3D model</span>
      ) : (
        <>
          <span className="status-section status-coords">
            <span>X</span><span className="status-value">{c.x.toFixed(2)}</span>
            <span>Y</span><span className="status-value">{c.y.toFixed(2)}</span>
            <span>{units}</span>
          </span>
          <button type="button" className={`status-section status-snap${editor.snap.enabled ? ' active' : ''}`} aria-pressed={editor.snap.enabled} onClick={() => setSnap({ enabled: !editor.snap.enabled })} title="Toggle snapping (F9)">Snap {editor.snap.enabled ? 'on' : 'off'}</button>
          <button type="button" className={`status-section status-grid${editor.snap.grid ? ' active' : ''}`} aria-pressed={editor.snap.grid} onClick={() => setSnap({ grid: !editor.snap.grid })} title="Toggle grid snapping (F7)">Grid <span className="status-value">{editor.snap.gridSize}</span>{units}</button>
          <button type="button" className={`status-section status-ortho${editor.ortho ? ' active' : ''}`} aria-pressed={editor.ortho} onClick={() => setOrtho(!editor.ortho)} title="Toggle orthogonal drawing (F8)">Ortho {editor.ortho ? 'on' : 'off'}</button>
          <span className="status-section status-tool">{editor.tool.replaceAll('-', ' ')}</span>
        </>
      )}
      <span className="status-section status-sheet">Sheet <span className="status-value">{sheet?.number}</span></span>
      <span className="status-section status-entities"><span className="status-value">{totalEntities}</span> {isModel ? 'components on sheet' : 'entities'}</span>
      <span className="status-section status-selection"><span className="status-value">{editor.selection.size}</span> selected</span>
      {isModel && <span className="status-message" title={editor.statusMessage}>{editor.statusMessage || 'Ready'}</span>}
      <span className="status-spacer" />
      <SaveIndicator />
      <span className="status-section status-zoom">{!isModel && <><span className="status-value">{editor.viewport.zoom.toFixed(2)}×</span><span>·</span></>}{units} · {standard}</span>
    </div>
  );
}
