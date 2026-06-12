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
          {/* The full shortcut table lives in ShortcutsModal, generated from
              the command registry so it can never drift from the bindings. */}
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Looking for the shortcut list? Press <span className="kbd">?</span> or
            use Help → Keyboard Shortcuts for the full table.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
