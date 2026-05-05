import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Cable, CableConstruction, CableCircuitType } from '../models/cable';
import { STANDARD_CSA } from '../models/cable';
import { computeVoltageDrop, suggestCableSize } from '../calc';
import { fmtNum, projectStandardsCode } from './whole-site-helpers';

const CONSTRUCTIONS: CableConstruction[] = [
  'XLPE/SWA/LSOH',
  'XLPE/SWA/PVC',
  'XLPE/PVC',
  'PVC/PVC',
  'LSF/LSF',
  'FP200',
  'FP400',
  'MICC',
  'CY',
  'SY',
  'YY',
  'fibre-OS2',
  'fibre-OM3',
  'fibre-OM4',
  'fibre-OM5',
  'cat5e',
  'cat6',
  'cat6a',
  'cat7',
  'coax',
  'other',
];

const CIRCUIT_TYPES: CableCircuitType[] = [
  'power', 'control', 'data', 'fire-alarm', 'emergency',
  'instrumentation', 'comms', 'av', 'earthing',
];

const PREVIEW_LENGTH_M = 50;

export function CableEditDialog({
  cable,
  onClose,
  onSave,
}: {
  cable: Cable | null; // null = new cable
  onClose: () => void;
  onSave: (cable: Cable) => void;
}) {
  const project = useStore((s) => s.project);
  const systems = useMemo(() => Object.values(project.systems ?? {}), [project.systems]);

  const [draft, setDraft] = useState<Cable>(() => cable ?? {
    id: '',
    reference: 'C-001',
    description: '',
    from: '',
    to: '',
    circuitType: 'power',
    construction: 'XLPE/SWA/LSOH',
    cores: 3,
    csa: 2.5,
    hasEarth: true,
    outerDiameter: 12,
    voltage: 400,
    route: [],
    designCurrent: 16,
    status: 'design',
  });

  const set = <K extends keyof Cable>(key: K, val: Cable[K]) => {
    setDraft((d) => ({ ...d, [key]: val }));
  };

  const standardsCode = projectStandardsCode(project);

  const vdrop = useMemo(() => computeVoltageDrop({
    construction: draft.construction,
    csa: draft.csa,
    lengthM: PREVIEW_LENGTH_M,
    designCurrentA: draft.designCurrent ?? 0,
    systemVoltageV: draft.voltage || 230,
    phasing: draft.cores >= 3 ? 'three' : 'single',
    loadCategory: 'other',
    standardsCode,
  }), [draft.construction, draft.csa, draft.designCurrent, draft.voltage, draft.cores, standardsCode]);

  const suggestion = useMemo(() => {
    if (!draft.designCurrent || draft.designCurrent <= 0) return null;
    return suggestCableSize({
      designCurrentA: draft.designCurrent,
      ambientC: 30,
      numCircuits: 1,
      installationMethod: 'tray',
      construction: draft.construction,
    });
  }, [draft.designCurrent, draft.construction]);

  const ampacityOk = suggestion ? suggestion.ampacity >= (draft.designCurrent ?? 0) && draft.csa >= suggestion.csa : true;
  const ampacityIz = suggestion ? suggestion.ampacity : 0;

  const handleSave = () => {
    if (!draft.reference.trim()) return alert('Reference is required');
    onSave(draft);
    onClose();
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    set('csa', suggestion.csa);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cable-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {cable ? `Edit Cable ${cable.reference}` : 'New Cable'}
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer' }}>×</span>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh' }}>
          <div className="cable-form-grid">
            <Field label="Reference">
              <input value={draft.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            <Field label="Description">
              <input value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="From">
              <input value={draft.from} onChange={(e) => set('from', e.target.value)} />
            </Field>
            <Field label="To">
              <input value={draft.to} onChange={(e) => set('to', e.target.value)} />
            </Field>
            <Field label="System">
              <select value={draft.systemId ?? ''} onChange={(e) => set('systemId', e.target.value || undefined)}>
                <option value="">—</option>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Circuit Type">
              <select value={draft.circuitType} onChange={(e) => set('circuitType', e.target.value as CableCircuitType)}>
                {CIRCUIT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Construction">
              <select value={draft.construction} onChange={(e) => set('construction', e.target.value as CableConstruction)}>
                {CONSTRUCTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Cores">
              <input
                type="number"
                min={1}
                max={48}
                value={draft.cores}
                onChange={(e) => set('cores', parseInt(e.target.value, 10) || 1)}
              />
            </Field>
            <Field label="CSA (mm²)">
              <span style={{ display: 'flex', gap: 4 }}>
                <select
                  value={draft.csa}
                  onChange={(e) => set('csa', parseFloat(e.target.value))}
                >
                  {STANDARD_CSA.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {suggestion && (
                  <button
                    type="button"
                    className="btn-ghost btn-tiny"
                    title={`Suggested size for ${draft.designCurrent} A: ${suggestion.csa} mm² (Iz ${fmtNum(suggestion.ampacity, 0)} A)`}
                    onClick={applySuggestion}
                    disabled={draft.csa === suggestion.csa}
                  >
                    Suggest {suggestion.csa}
                  </button>
                )}
              </span>
            </Field>
            <Field label="Has Earth">
              <input
                type="checkbox"
                checked={draft.hasEarth}
                onChange={(e) => set('hasEarth', e.target.checked)}
              />
            </Field>
            <Field label="Earth CSA">
              <input
                type="number"
                step={0.5}
                value={draft.earthCsa ?? ''}
                onChange={(e) => set('earthCsa', parseFloat(e.target.value) || undefined)}
              />
            </Field>
            <Field label="OD (mm)">
              <input
                type="number"
                step={0.1}
                value={draft.outerDiameter}
                onChange={(e) => set('outerDiameter', parseFloat(e.target.value) || 0)}
              />
            </Field>
            <Field label="Voltage (V)">
              <input
                type="number"
                value={draft.voltage}
                onChange={(e) => set('voltage', parseFloat(e.target.value) || 0)}
              />
            </Field>
            <Field label="I_b Design (A)">
              <input
                type="number"
                step={0.5}
                value={draft.designCurrent ?? ''}
                onChange={(e) => set('designCurrent', parseFloat(e.target.value) || undefined)}
              />
            </Field>
            <Field label="Protective Device">
              <input
                value={draft.protectiveDevice ?? ''}
                placeholder="e.g. MCB B16"
                onChange={(e) => set('protectiveDevice', e.target.value)}
              />
            </Field>
            <Field label="Length Allowance (m)">
              <input
                type="number"
                step={0.5}
                value={draft.lengthAllowance ?? ''}
                onChange={(e) => set('lengthAllowance', parseFloat(e.target.value) || undefined)}
              />
            </Field>
            <Field label="Manufacturer">
              <input
                value={draft.manufacturer ?? ''}
                onChange={(e) => set('manufacturer', e.target.value)}
              />
            </Field>
            <Field label="Part Number">
              <input
                value={draft.partNumber ?? ''}
                onChange={(e) => set('partNumber', e.target.value)}
              />
            </Field>
            <Field label="Status">
              <select
                value={draft.status ?? 'design'}
                onChange={(e) => set('status', e.target.value as Cable['status'])}
              >
                {['design', 'tendered', 'ordered', 'delivered', 'installed', 'tested', 'commissioned'].map((s) =>
                  <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <input
                value={draft.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </div>
          <div className="cable-calc-preview">
            <div className="calc-card">
              <div className="calc-card-label">Suggested ampacity</div>
              <div className={`calc-card-value ${ampacityOk ? 'ok' : 'fail'}`}>
                {suggestion
                  ? `Iz ${fmtNum(ampacityIz, 0)} A${draft.designCurrent ? ` · Ib ${fmtNum(draft.designCurrent, 0)} A` : ''}`
                  : 'Set Ib to size'}
              </div>
              <div className="calc-card-status">
                {suggestion
                  ? `Suggested CSA ${suggestion.csa} mm² · current CSA ${draft.csa} mm² · ${ampacityOk ? 'OK' : 'Undersized'}`
                  : ''}
              </div>
            </div>
            <div className="calc-card">
              <div className="calc-card-label">V-drop @ {PREVIEW_LENGTH_M} m</div>
              <div className={`calc-card-value ${vdrop.withinLimits ? 'ok' : 'fail'}`}>
                {fmtNum(vdrop.vdropV, 2)} V · {fmtNum(vdrop.vdropPct, 2)}%
              </div>
              <div className="calc-card-status">
                Limit {fmtNum(vdrop.limitPct, 1)}% · {vdrop.withinLimits ? 'OK' : 'Exceeds'}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>{cable ? 'Save' : 'Add Cable'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="cable-field">
      <span className="cable-field-label">{label}</span>
      <span className="cable-field-input">{children}</span>
    </label>
  );
}
