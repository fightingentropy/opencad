import React from 'react';

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          About OpenCAD Electrical
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto' }}>×</span>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 8,
              background: 'linear-gradient(135deg, #3ba3ff, #8b6cff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700, color: 'white',
            }}>⌬</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>OpenCAD Electrical</div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Browser-based electrical CAD • v0.1</div>
            </div>
          </div>
          <p style={{ marginBottom: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            Open-source electrical schematic and panel layout tool, with a 3D panel
            preview powered by Three.js. Built as an alternative to AutoCAD Electrical
            for control engineers, panel builders, and electricians.
          </p>
          <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-mute)', marginBottom: 8, letterSpacing: 0.5 }}>Keyboard Shortcuts</h4>
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              {[
                ['S', 'Select tool'],
                ['L', 'Line'],
                ['W', 'Wire'],
                ['R', 'Rectangle / Rotate selection'],
                ['C', 'Circle'],
                ['A', 'Arc'],
                ['P', 'Polyline'],
                ['T', 'Text'],
                ['D', 'Dimension'],
                ['M', 'Measure'],
                ['E', 'Erase'],
                ['F8', 'Toggle Ortho mode'],
                ['Esc', 'Cancel current operation'],
                ['Enter', 'Finish polyline / wire'],
                ['Del', 'Delete selection'],
                ['⌘Z / ⌘⇧Z', 'Undo / Redo'],
                ['⌘A', 'Select all'],
                ['⌘D', 'Duplicate selection'],
                ['Mouse wheel', 'Zoom in / out'],
                ['Middle drag', 'Pan'],
                ['Right click', 'Context menu / commit drafting'],
              ].map(([key, desc]) => (
                <tr key={key as string}>
                  <td style={{ padding: '3px 8px 3px 0', whiteSpace: 'nowrap' }}><span className="kbd">{key}</span></td>
                  <td style={{ padding: '3px 0', color: 'var(--text)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
