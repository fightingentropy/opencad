import React from 'react';
import { useStore } from '../state/store';

export function StatusBar() {
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const setOrtho = useStore((s) => s.setOrtho);
  const setSnap = useStore((s) => s.setSnap);
  const sheet = project.sheets[project.activeSheetId];
  const c = editor.cursorSnap ?? editor.cursor;
  const totalEntities = Object.keys(sheet?.entities ?? {}).length;

  return (
    <div className="status-bar">
      <span className="status-section">
        <span style={{ color: 'var(--text-mute)' }}>X</span>
        <span style={{ color: 'var(--text)', minWidth: 64 }}>{c.x.toFixed(2)}</span>
        <span style={{ color: 'var(--text-mute)' }}>Y</span>
        <span style={{ color: 'var(--text)', minWidth: 64 }}>{c.y.toFixed(2)}</span>
        <span style={{ color: 'var(--text-mute)' }}>{project.units}</span>
      </span>
      <span
        className={`status-section ${editor.snap.enabled ? 'active' : ''}`}
        onClick={() => setSnap({ enabled: !editor.snap.enabled })}
        style={{ cursor: 'pointer' }}
      >
        SNAP {editor.snap.enabled ? 'ON' : 'OFF'}
      </span>
      <span
        className={`status-section ${editor.snap.grid ? 'active' : ''}`}
        onClick={() => setSnap({ grid: !editor.snap.grid })}
        style={{ cursor: 'pointer' }}
      >
        GRID {editor.snap.gridSize}{project.units}
      </span>
      <span
        className={`status-section ${editor.ortho ? 'active' : ''}`}
        onClick={() => setOrtho(!editor.ortho)}
        style={{ cursor: 'pointer' }}
      >
        ORTHO {editor.ortho ? 'ON' : 'OFF'}
      </span>
      <span className="status-section">
        TOOL <span style={{ color: 'var(--accent)' }}>{editor.tool.toUpperCase()}</span>
      </span>
      <span className="status-section">
        SHEET <span style={{ color: 'var(--accent)' }}>{sheet?.number}</span>
      </span>
      <span className="status-section">
        ENTITIES {totalEntities}
      </span>
      <span className="status-section">
        SEL {editor.selection.size}
      </span>
      <span className="status-spacer" />
      <span className="status-section" style={{ borderRight: 'none' }}>
        Z{editor.viewport.zoom.toFixed(2)}× • {project.standard}
      </span>
    </div>
  );
}
