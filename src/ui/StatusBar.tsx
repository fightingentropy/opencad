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
        className="status-section status-save"
        style={{ color: 'var(--danger)' }}
        title={`Autosave failed (${error ?? 'unknown error'}). Use File → Save to download a copy.${
          lastSavedAt ? ` Last saved ${formatSaveTime(lastSavedAt)}.` : ''
        }`}
      >
        NOT SAVED — {(error ?? 'save failed').toUpperCase()}
      </span>
    );
  }
  return (
    <span className="status-section status-save" style={{ color: 'var(--text-mute)' }}>
      {status === 'saving' && 'SAVING…'}
      {status === 'saved' && lastSavedAt !== null && (
        <>SAVED <span style={{ color: 'var(--text-dim)' }}>{formatSaveTime(lastSavedAt)}</span></>
      )}
      {(status === 'idle' || (status === 'saved' && lastSavedAt === null)) && 'AUTOSAVE'}
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

  return (
    <div className="status-bar">
      <span className="status-section status-coords">
        <span style={{ color: 'var(--text-mute)' }}>X</span>
        <span style={{ color: 'var(--text)', minWidth: 64 }}>{c.x.toFixed(2)}</span>
        <span style={{ color: 'var(--text-mute)' }}>Y</span>
        <span style={{ color: 'var(--text)', minWidth: 64 }}>{c.y.toFixed(2)}</span>
        <span style={{ color: 'var(--text-mute)' }}>{units}</span>
      </span>
      <span
        className={`status-section status-snap ${editor.snap.enabled ? 'active' : ''}`}
        onClick={() => setSnap({ enabled: !editor.snap.enabled })}
        style={{ cursor: 'pointer' }}
      >
        SNAP {editor.snap.enabled ? 'ON' : 'OFF'}
      </span>
      <span
        className={`status-section status-grid ${editor.snap.grid ? 'active' : ''}`}
        onClick={() => setSnap({ grid: !editor.snap.grid })}
        style={{ cursor: 'pointer' }}
      >
        GRID {editor.snap.gridSize}{units}
      </span>
      <span
        className={`status-section status-ortho ${editor.ortho ? 'active' : ''}`}
        onClick={() => setOrtho(!editor.ortho)}
        style={{ cursor: 'pointer' }}
      >
        ORTHO {editor.ortho ? 'ON' : 'OFF'}
      </span>
      <span className="status-section status-tool">
        TOOL <span style={{ color: 'var(--accent)' }}>{editor.tool.toUpperCase()}</span>
      </span>
      <span className="status-section status-sheet">
        SHEET <span style={{ color: 'var(--accent)' }}>{sheet?.number}</span>
      </span>
      <span className="status-section status-entities">
        ENTITIES {totalEntities}
      </span>
      <span className="status-section status-selection">
        SEL {editor.selection.size}
      </span>
      <span className="status-spacer" />
      <SaveIndicator />
      <span className="status-section status-zoom" style={{ borderRight: 'none' }}>
        Z{editor.viewport.zoom.toFixed(2)}× • {standard}
      </span>
    </div>
  );
}
