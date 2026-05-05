import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { generateCostEstimate, costEstimateToCSV } from '../io/cost-estimate';
import type { CostEstimateOptions } from '../io/cost-estimate';
import { fmtNum } from './whole-site-helpers';

export function CostEstimationModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);

  const [hourlyRate, setHourlyRate] = useState(45);
  const [overheadPct, setOverheadPct] = useState(12);
  const [profitPct, setProfitPct] = useState(10);
  const [contingencyPct, setContingencyPct] = useState(5);
  const [labourPerMTrunking, setLabourPerMTrunking] = useState(0.3);
  const [labourPerMTray, setLabourPerMTray] = useState(0.4);
  const [labourPerMConduit, setLabourPerMConduit] = useState(0.5);

  const options: CostEstimateOptions = useMemo(() => ({
    hourlyRate,
    overheadPct: overheadPct / 100,
    profitPct: profitPct / 100,
    contingencyPct: contingencyPct / 100,
    labourPerMTrunking,
    labourPerMTray,
    labourPerMConduit,
  }), [hourlyRate, overheadPct, profitPct, contingencyPct, labourPerMTrunking, labourPerMTray, labourPerMConduit]);

  const estimate = useMemo(() => generateCostEstimate(project, options), [project, options]);

  const materialItems = estimate.lineItems.filter((l) => l.category === 'material');
  const labourItems = estimate.lineItems.filter((l) => l.category === 'labour');

  const onCsv = () => {
    const csv = costEstimateToCSV(estimate);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, '_')}_cost.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fmtMoney = (n: number) => `${estimate.currency} ${fmtNum(n, 2)}`;

  const row = (label: string, value: string, accent?: boolean) => (
    <div className={`cost-row${accent ? ' grand' : ''}`}>
      <span>{label}</span>
      <span className="cost-value">{value}</span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cost-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Cost Estimate — {project.name}
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer' }}>×</span>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <h3 className="cost-section-title">Rates</h3>
            <Field label="Hourly rate">
              <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Overhead %">
              <input type="number" value={overheadPct} onChange={(e) => setOverheadPct(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Profit %">
              <input type="number" value={profitPct} onChange={(e) => setProfitPct(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Contingency %">
              <input type="number" value={contingencyPct} onChange={(e) => setContingencyPct(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Hours / m trunking">
              <input type="number" step={0.05} value={labourPerMTrunking} onChange={(e) => setLabourPerMTrunking(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Hours / m tray">
              <input type="number" step={0.05} value={labourPerMTray} onChange={(e) => setLabourPerMTray(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Hours / m conduit">
              <input type="number" step={0.05} value={labourPerMConduit} onChange={(e) => setLabourPerMConduit(parseFloat(e.target.value) || 0)} />
            </Field>
          </div>
          <div>
            <h3 className="cost-section-title">Summary</h3>
            {row('Material total', fmtMoney(estimate.materialTotal))}
            {row('Labour total', fmtMoney(estimate.labourTotal))}
            {row(`Overhead (${overheadPct}%)`, fmtMoney(estimate.overhead))}
            {row(`Profit (${profitPct}%)`, fmtMoney(estimate.profit))}
            {row(`Contingency (${contingencyPct}%)`, fmtMoney(estimate.contingency))}
            {row('Grand Total', fmtMoney(estimate.grandTotal), true)}
            <h3 className="cost-section-title" style={{ marginTop: 12 }}>Materials ({materialItems.length})</h3>
            <div className="cost-line-list">
              {materialItems.length === 0 && (
                <div style={{ color: 'var(--text-mute)', fontSize: 11, padding: 4 }}>
                  No catalogue-priced materials in BOM.
                </div>
              )}
              {materialItems.slice(0, 30).map((l, i) => (
                <div className="cost-row" key={`m-${i}`}>
                  <span title={l.description}>{l.description}</span>
                  <span className="cost-value">{fmtNum(l.quantity, 1)} {l.unit} · {fmtMoney(l.totalCost)}</span>
                </div>
              ))}
              {materialItems.length > 30 && (
                <div style={{ color: 'var(--text-mute)', fontSize: 11, padding: 4 }}>
                  …and {materialItems.length - 30} more lines (export for full detail)
                </div>
              )}
            </div>
            <h3 className="cost-section-title" style={{ marginTop: 12 }}>Labour ({labourItems.length})</h3>
            <div className="cost-line-list">
              {labourItems.map((l, i) => (
                <div className="cost-row" key={`l-${i}`}>
                  <span title={l.description}>{l.description}</span>
                  <span className="cost-value">{fmtNum(l.quantity, 1)} {l.unit} · {fmtMoney(l.totalCost)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onCsv}>Export CSV</button>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cost-rate-row">
      <label>{label}</label>
      {children}
    </div>
  );
}
