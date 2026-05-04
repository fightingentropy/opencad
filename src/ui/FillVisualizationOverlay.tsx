import React from 'react';
import { useStore } from '../state/store';
import { setEditorPatch } from './whole-site-helpers';

type Mode = 'off' | 'fill' | 'segregation' | 'support-spacing';

const MODES: { id: Mode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'fill', label: 'Fill' },
  { id: 'segregation', label: 'Segregation' },
  { id: 'support-spacing', label: 'Supports' },
];

export function FillVisualizationOverlay() {
  const overlay = useStore((s) => s.editor.complianceOverlay) ?? 'off';

  const onChange = (m: Mode) => setEditorPatch({ complianceOverlay: m });

  return (
    <div className="panel-section">
      <div className="panel-header">Compliance Overlay</div>
      <div className="overlay-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`overlay-mode-btn${overlay === m.id ? ' active' : ''}`}
            onClick={() => onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {overlay === 'fill' && (
        <div className="overlay-legend">
          <div className="overlay-legend-row">
            <span className="overlay-swatch" style={{ background: 'var(--good)' }} />
            <span>≤ 35%</span>
          </div>
          <div className="overlay-legend-row">
            <span className="overlay-swatch" style={{ background: 'var(--warn)' }} />
            <span>35 – 45%</span>
          </div>
          <div className="overlay-legend-row">
            <span className="overlay-swatch" style={{ background: 'var(--danger)' }} />
            <span>&gt; 45%</span>
          </div>
        </div>
      )}
      {overlay === 'segregation' && (
        <div className="overlay-hint">
          Routes carrying mixed cable categories highlight in red.
        </div>
      )}
      {overlay === 'support-spacing' && (
        <div className="overlay-hint">
          Containment between supports exceeding spec span shows amber.
        </div>
      )}
    </div>
  );
}
