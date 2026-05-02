import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import { generateBOM, bomToCSV } from '../io/bom';
import { CATEGORY_LABELS } from '../symbols';

export function BomModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const rows = useMemo(() => generateBOM(project), [project]);

  const onExport = () => {
    const csv = bomToCSV(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_BOM.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalCount = rows.reduce((acc, r) => acc + r.quantity, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 800, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Bill of Materials — {project.name}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-mute)', fontSize: 12, fontWeight: 'normal' }}>
              {rows.length} parts • {totalCount} units
            </span>
            <span className="close" onClick={onClose}>×</span>
          </span>
        </div>
        <div className="modal-body" style={{ padding: 0, maxHeight: '60vh' }}>
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
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text-mute)' }}>
                  No symbols yet. Place some components on a sheet.
                </td></tr>
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
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', fontSize: 10 }}>{r.sheetNumbers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={onExport}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}
