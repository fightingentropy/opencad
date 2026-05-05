import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { generateBOM, bomToCSV } from '../io/bom';
import {
  generateContainmentBOM,
  containmentBOMToCSV,
} from '../io/containment-bom';
import {
  exportCableSchedule,
  cableScheduleToCSV,
} from '../io/cable-schedule-export';
import {
  exportContainmentSchedule,
  containmentScheduleToCSV,
} from '../io/containment-schedule';

type BomTab = 'symbols' | 'containment' | 'cables' | 'containment-schedule';

const TAB_LABEL: Record<BomTab, string> = {
  symbols: 'Symbols',
  containment: 'Containment',
  cables: 'Cables',
  'containment-schedule': 'Containment Schedule',
};

const downloadCSV = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export function BomModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [tab, setTab] = useState<BomTab>('symbols');

  // Each tab dataset is memoised so switching tabs after generation is cheap
  // and re-renders don't recompute everything from scratch.
  const symbolRows = useMemo(() => generateBOM(project), [project]);
  const containmentRows = useMemo(() => generateContainmentBOM(project), [project]);
  const cableRows = useMemo(() => exportCableSchedule(project), [project]);
  const containmentScheduleRows = useMemo(
    () => exportContainmentSchedule(project),
    [project],
  );

  const safeName = project.name.replace(/\s+/g, '_');

  const onExport = () => {
    if (tab === 'symbols') {
      downloadCSV(bomToCSV(symbolRows), `${safeName}_BOM.csv`);
    } else if (tab === 'containment') {
      downloadCSV(
        containmentBOMToCSV(containmentRows),
        `${safeName}_ContainmentBOM.csv`,
      );
    } else if (tab === 'cables') {
      downloadCSV(
        cableScheduleToCSV(cableRows),
        `${safeName}_CableSchedule.csv`,
      );
    } else if (tab === 'containment-schedule') {
      downloadCSV(
        containmentScheduleToCSV(containmentScheduleRows),
        `${safeName}_ContainmentSchedule.csv`,
      );
    }
  };

  // Footer counts adjust with the active tab so the user always sees row /
  // unit totals relevant to what's on screen.
  const counts: { rows: number; units: number } = (() => {
    if (tab === 'symbols') {
      return {
        rows: symbolRows.length,
        units: symbolRows.reduce((acc, r) => acc + r.quantity, 0),
      };
    }
    if (tab === 'containment') {
      return {
        rows: containmentRows.length,
        units: containmentRows.reduce((acc, r) => acc + r.quantity, 0),
      };
    }
    if (tab === 'cables') {
      return { rows: cableRows.length, units: cableRows.length };
    }
    return {
      rows: containmentScheduleRows.length,
      units: containmentScheduleRows.length,
    };
  })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal bom-modal"
        style={{ minWidth: 920, width: '92vw', maxWidth: 1500 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          Schedules &amp; BOM — {project.name}
          <span
            style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <span style={{ color: 'var(--text-mute)', fontSize: 12, fontWeight: 'normal' }}>
              {counts.rows} rows • {counts.units} units
            </span>
            <span className="close" onClick={onClose}>
              ×
            </span>
          </span>
        </div>
        <div className="bom-tabs">
          {(Object.keys(TAB_LABEL) as BomTab[]).map((t) => (
            <button
              key={t}
              className={`bom-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="modal-body bom-modal-body" style={{ padding: 0, maxHeight: '60vh' }}>
          {tab === 'symbols' && <SymbolsTable rows={symbolRows} />}
          {tab === 'containment' && <ContainmentTable rows={containmentRows} />}
          {tab === 'cables' && <CablesTable rows={cableRows} />}
          {tab === 'containment-schedule' && (
            <ContainmentScheduleTable rows={containmentScheduleRows} />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={onExport}>
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function SymbolsTable({ rows }: { rows: ReturnType<typeof generateBOM> }) {
  return (
    <div className="bom-scroll">
      <table className="bom-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Name</th>
            <th>Description</th>
            <th>Mfr</th>
            <th>Part #</th>
            <th>Rating</th>
            <th>Qty</th>
            <th>Sheets</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text-mute)' }}>
                No symbols yet. Place some components on a sheet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>{r.tag}</td>
              <td>{r.name}</td>
              <td style={{ color: 'var(--text-dim)' }}>{r.description}</td>
              <td>{r.manufacturer}</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{r.partNumber}</td>
              <td>{r.rating}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.quantity}</td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', fontSize: 10 }}>
                {r.sheetNumbers.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContainmentTable({
  rows,
}: {
  rows: ReturnType<typeof generateContainmentBOM>;
}) {
  return (
    <div className="bom-scroll">
      <table className="bom-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Type</th>
            <th>Mfr</th>
            <th>Part No</th>
            <th>Description</th>
            <th>Size</th>
            <th>Material</th>
            <th>Unit</th>
            <th>Qty</th>
            <th>Unit Cost</th>
            <th>Total Cost</th>
            <th>System</th>
            <th>Sheets</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} style={{ textAlign: 'center', padding: 20, color: 'var(--text-mute)' }}>
                No containment runs yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>{r.ref}</td>
              <td>{r.kind}</td>
              <td>{r.manufacturer}</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{r.partNumber}</td>
              <td style={{ color: 'var(--text-dim)' }}>{r.description}</td>
              <td>{r.size}</td>
              <td>{r.material}</td>
              <td>{r.unit}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.quantity}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {r.unitCost ? r.unitCost.toFixed(2) : ''}
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {r.totalCost ? r.totalCost.toFixed(2) : ''}
              </td>
              <td>{r.system}</td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', fontSize: 10 }}>
                {r.sheets.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CablesTable({ rows }: { rows: ReturnType<typeof exportCableSchedule> }) {
  return (
    <div className="bom-scroll">
      <table className="bom-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>From</th>
            <th>To</th>
            <th>System</th>
            <th>Type</th>
            <th>Size</th>
            <th>OD</th>
            <th>V</th>
            <th>L (m)</th>
            <th>Ib (A)</th>
            <th>Iz (A)</th>
            <th>Vd (V)</th>
            <th>Vd (%)</th>
            <th>Device</th>
            <th>Route</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={15} style={{ textAlign: 'center', padding: 20, color: 'var(--text-mute)' }}>
                No cables in the cable schedule.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>{r.ref}</td>
              <td>{r.from}</td>
              <td>{r.to}</td>
              <td>{r.system}</td>
              <td>{r.type}</td>
              <td>{r.size}</td>
              <td style={{ textAlign: 'right' }}>{r.od}</td>
              <td style={{ textAlign: 'right' }}>{r.voltage}</td>
              <td style={{ textAlign: 'right' }}>{r.length.toFixed(1)}</td>
              <td style={{ textAlign: 'right' }}>{r.designCurrent.toFixed(1)}</td>
              <td style={{ textAlign: 'right' }}>{r.ampacity.toFixed(1)}</td>
              <td style={{ textAlign: 'right' }}>{r.vdropV.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{r.vdropPct.toFixed(2)}</td>
              <td>{r.deviceRating}</td>
              <td style={{ color: 'var(--text-dim)', fontSize: 10 }}>{r.route}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContainmentScheduleTable({
  rows,
}: {
  rows: ReturnType<typeof exportContainmentSchedule>;
}) {
  return (
    <div className="bom-scroll">
      <table className="bom-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Type</th>
            <th>Sub-type</th>
            <th>Size</th>
            <th>Material</th>
            <th>Length (m)</th>
            <th>Elevation (mm)</th>
            <th>System</th>
            <th>Fill (%)</th>
            <th>Cables</th>
            <th>Mfr</th>
            <th>Part No</th>
            <th>Sheet</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} style={{ textAlign: 'center', padding: 20, color: 'var(--text-mute)' }}>
                No containment runs to schedule.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>{r.ref}</td>
              <td>{r.type}</td>
              <td>{r.subType}</td>
              <td>{r.size}</td>
              <td>{r.material}</td>
              <td style={{ textAlign: 'right' }}>{r.length.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{r.elevation}</td>
              <td>{r.system}</td>
              <td style={{ textAlign: 'right' }}>{r.fillPct.toFixed(1)}</td>
              <td style={{ textAlign: 'right' }}>{r.cableCount}</td>
              <td>{r.manufacturer}</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{r.partNumber}</td>
              <td>{r.sheet}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
