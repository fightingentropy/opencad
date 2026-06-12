import React from 'react';
import { useStore } from '../state/store';
import { useStandardsProfile } from '../state/selectors';
import type { StandardsCode, StandardsProfile } from '../models/standards';
import { DEFAULT_STANDARDS } from '../models/standards';

const CODES: { id: StandardsCode; label: string }[] = [
  { id: 'BS7671', label: 'BS 7671' },
  { id: 'NEC', label: 'NEC' },
  { id: 'IEC', label: 'IEC' },
  { id: 'AS-NZS', label: 'AS / NZS' },
];

export function StandardsProfilePicker({ compact }: { compact?: boolean } = {}) {
  const setProject = useStore((s) => s.setProject);
  const profile = useStandardsProfile() ?? DEFAULT_STANDARDS.BS7671;

  const onChange = (code: StandardsCode) => {
    const next: StandardsProfile = DEFAULT_STANDARDS[code];
    setProject({ ...useStore.getState().project, standardsProfile: next, modified: Date.now() });
  };

  if (compact) {
    return (
      <span className="standards-pill" title={`${profile.edition}${profile.amendments.length ? ' · ' + profile.amendments.join(', ') : ''}`}>
        <select value={profile.code} onChange={(e) => onChange(e.target.value as StandardsCode)}>
          {CODES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </span>
    );
  }

  return (
    <div className="standards-picker">
      <div className="standards-row">
        <label className="standards-label">Standards</label>
        <select value={profile.code} onChange={(e) => onChange(e.target.value as StandardsCode)}>
          {CODES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div className="standards-info">
        <div><span>Edition:</span> {profile.edition}</div>
        {profile.amendments.length > 0 && (
          <div><span>Amendments:</span> {profile.amendments.join(', ')}</div>
        )}
        {profile.region && <div><span>Region:</span> {profile.region}</div>}
      </div>
      <div className="standards-affects">
        Affects fill limits, voltage drop limits, ampacity tables and segregation rules.
      </div>
    </div>
  );
}
