import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  allContainmentEntities,
  estimateCableLength,
  fmtNum,
} from './whole-site-helpers';

export function CostEstimationModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);

  const [hourlyWage, setHourlyWage] = useState(45);
  const [overheadPct, setOverheadPct] = useState(15);
  const [profitPct, setProfitPct] = useState(10);
  const [contingencyPct, setContingencyPct] = useState(5);
  const [hoursPerMetreContainment, setHoursPerMetreContainment] = useState(0.25);
  const [hoursPerCable, setHoursPerCable] = useState(0.5);
  const [unknownContainmentRate, setUnknownContainmentRate] = useState(15); // £/m

  const breakdown = useMemo(() => {
    const containments = allContainmentEntities(project);
    const cables = Object.values(project.cableSchedule?.cables ?? {});
    const cataloguesProducts = (() => {
      const out: Record<string, number> = {};
      const cats = project.catalogues ?? {};
      for (const k of Object.keys(cats)) {
        for (const p of Object.values(cats[k].products)) {
          if (p.unitCost != null) out[p.id] = p.unitCost;
        }
      }
      return out;
    })();

    let containmentMaterial = 0;
    let containmentLengthM = 0;
    for (const { entity } of containments) {
      const pts = entity.points ?? [];
      let mm = 0;
      for (let i = 1; i < pts.length; i++) {
        mm += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const m = mm / 1000;
      containmentLengthM += m;
      const rate = entity.catalogProductId && cataloguesProducts[entity.catalogProductId]
        ? cataloguesProducts[entity.catalogProductId]
        : unknownContainmentRate;
      containmentMaterial += rate * m;
    }

    let cableMaterial = 0;
    let cableLengthM = 0;
    for (const c of cables) {
      const m = estimateCableLength(c, project);
      cableLengthM += m;
      // Approx £/m by CSA — quick fallback when no catalogue match.
      const csaRate = 0.6 + c.csa * 0.4;
      cableMaterial += csaRate * m;
    }

    const labourHours = containmentLengthM * hoursPerMetreContainment + cables.length * hoursPerCable;
    const labourCost = labourHours * hourlyWage;

    const materialTotal = containmentMaterial + cableMaterial;
    const subtotal = materialTotal + labourCost;
    const overhead = subtotal * (overheadPct / 100);
    const profit = (subtotal + overhead) * (profitPct / 100);
    const contingency = (subtotal + overhead + profit) * (contingencyPct / 100);
    const grand = subtotal + overhead + profit + contingency;

    return {
      containmentLengthM,
      cableLengthM,
      cableCount: cables.length,
      containmentMaterial,
      cableMaterial,
      materialTotal,
      labourHours,
      labourCost,
      subtotal,
      overhead,
      profit,
      contingency,
      grand,
    };
  }, [project, hourlyWage, overheadPct, profitPct, contingencyPct, hoursPerCable, hoursPerMetreContainment, unknownContainmentRate]);

  const onCsv = () => {
    const rows = [
      ['Description', 'Quantity', 'Unit', 'Cost'],
      ['Containment material', breakdown.containmentLengthM.toFixed(1), 'm', breakdown.containmentMaterial.toFixed(2)],
      ['Cable material', breakdown.cableLengthM.toFixed(1), 'm', breakdown.cableMaterial.toFixed(2)],
      ['Labour', breakdown.labourHours.toFixed(1), 'h', breakdown.labourCost.toFixed(2)],
      ['Overhead', `${overheadPct}%`, '', breakdown.overhead.toFixed(2)],
      ['Profit', `${profitPct}%`, '', breakdown.profit.toFixed(2)],
      ['Contingency', `${contingencyPct}%`, '', breakdown.contingency.toFixed(2)],
      ['Grand Total', '', '', breakdown.grand.toFixed(2)],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, '_')}_cost.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
            <Field label="Hourly wage">
              <input type="number" value={hourlyWage} onChange={(e) => setHourlyWage(parseFloat(e.target.value) || 0)} />
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
            <Field label="Hours / m containment">
              <input type="number" step={0.05} value={hoursPerMetreContainment} onChange={(e) => setHoursPerMetreContainment(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Hours / cable">
              <input type="number" step={0.1} value={hoursPerCable} onChange={(e) => setHoursPerCable(parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Default rate /m (unknown)">
              <input type="number" step={0.5} value={unknownContainmentRate} onChange={(e) => setUnknownContainmentRate(parseFloat(e.target.value) || 0)} />
            </Field>
          </div>
          <div>
            <h3 className="cost-section-title">Breakdown</h3>
            {row('Containment material', `${fmtNum(breakdown.containmentLengthM, 1)} m · ${fmtNum(breakdown.containmentMaterial, 2)}`)}
            {row('Cable material', `${fmtNum(breakdown.cableLengthM, 1)} m · ${fmtNum(breakdown.cableMaterial, 2)}`)}
            {row('Material total', fmtNum(breakdown.materialTotal, 2))}
            {row('Labour', `${fmtNum(breakdown.labourHours, 1)} h · ${fmtNum(breakdown.labourCost, 2)}`)}
            {row('Subtotal', fmtNum(breakdown.subtotal, 2))}
            {row(`Overhead (${overheadPct}%)`, fmtNum(breakdown.overhead, 2))}
            {row(`Profit (${profitPct}%)`, fmtNum(breakdown.profit, 2))}
            {row(`Contingency (${contingencyPct}%)`, fmtNum(breakdown.contingency, 2))}
            {row('Grand Total', fmtNum(breakdown.grand, 2), true)}
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
