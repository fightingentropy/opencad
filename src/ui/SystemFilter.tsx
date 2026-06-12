import React from 'react';
import { useStore } from '../state/store';
import { useSystems } from '../state/selectors';
import { setEditorPatch } from './whole-site-helpers';

export function SystemFilter() {
  const systemsMap = useSystems();
  const systemFilter = useStore((s) => s.editor.systemFilter) ?? 'all';
  const systems = Object.values(systemsMap ?? {});

  return (
    <div className="filter-bar">
      <label className="filter-label">System</label>
      <select
        value={systemFilter}
        onChange={(e) => setEditorPatch({ systemFilter: e.target.value })}
      >
        <option value="all">All Systems</option>
        {systems.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {systemFilter !== 'all' && (
        <span
          className="phase-swatch"
          style={{ background: systems.find((s) => s.id === systemFilter)?.color ?? 'transparent' }}
          title={systems.find((s) => s.id === systemFilter)?.name ?? ''}
        />
      )}
    </div>
  );
}
