import React from 'react';
import { useStore } from '../state/store';
import { PHASES } from '../models/revision';
import type { ConstructionPhase } from '../models/revision';
import { setEditorPatch } from './whole-site-helpers';

export function PhaseFilter() {
  const phaseFilter = useStore((s) => s.editor.phaseFilter) ?? 'all';

  const onChange = (v: string) => {
    setEditorPatch({ phaseFilter: v as ConstructionPhase | 'all' });
  };

  return (
    <div className="filter-bar">
      <label className="filter-label">Phase</label>
      <select value={phaseFilter} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All Phases</option>
        {PHASES.map((p) => (
          <option key={p.code} value={p.code}>{p.name}</option>
        ))}
      </select>
      {phaseFilter !== 'all' && (
        <span
          className="phase-swatch"
          title={PHASES.find((p) => p.code === phaseFilter)?.name ?? ''}
          style={{ background: PHASES.find((p) => p.code === phaseFilter)?.color ?? 'transparent' }}
        />
      )}
    </div>
  );
}
