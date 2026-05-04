import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import { nanoid } from 'nanoid';
import type { DrawingRevision, RevisionStatus, SheetMeta } from '../models/revision';
import { REVISION_STATUSES } from '../models/revision';

export function RevisionHistoryPanel() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const sheet = project.sheets[project.activeSheetId];

  if (!sheet) return null;

  const meta: SheetMeta = sheet.meta ?? {};
  const revisions = useMemo(() => meta.revisions ?? [], [meta.revisions]);
  const editable = !meta.status || REVISION_STATUSES[meta.status].editable;

  const setMeta = (next: SheetMeta) => {
    setProject({
      ...project,
      sheets: { ...project.sheets, [sheet.id]: { ...sheet, meta: next } },
      modified: Date.now(),
    });
  };

  const onAdd = () => {
    const description = window.prompt('Revision description?', 'Updated panel layout');
    if (!description) return;
    const statusStr = window.prompt('Status (S0–S5)?', 'S2') ?? 'S2';
    const status = (statusStr in REVISION_STATUSES ? statusStr : 'S2') as RevisionStatus;
    const author = window.prompt('Author?', 'Engineer') ?? 'Engineer';
    const seq = revisions.length + 1;
    const code = (status >= 'S3' ? 'C' : 'P') + String(seq).padStart(2, '0');
    const r: DrawingRevision = {
      id: nanoid(10),
      code,
      status,
      date: Date.now(),
      description,
      author,
    };
    setMeta({
      ...meta,
      revisions: [...revisions, r],
      currentRevision: r.code,
      status: r.status,
    });
  };

  const onIssue = () => {
    const approver = window.prompt('Approver name?');
    if (!approver) return;
    if (!confirm(`Issue this drawing for construction? It will be locked from editing.`)) return;
    const description = window.prompt('Issue description?', 'Issued for Construction') ?? 'Issued for Construction';
    const seq = revisions.length + 1;
    const r: DrawingRevision = {
      id: nanoid(10),
      code: 'C' + String(seq).padStart(2, '0'),
      status: 'S4',
      date: Date.now(),
      description,
      author: meta.designer ?? 'Designer',
      approvedBy: approver,
    };
    setMeta({
      ...meta,
      revisions: [...revisions, r],
      currentRevision: r.code,
      status: 'S4',
      approvedBy: approver,
      approvedDate: Date.now(),
    });
  };

  return (
    <div className="revision-panel">
      <div className="revision-panel-header">
        <span>Revisions — {sheet.name}</span>
        <div className="revision-actions">
          <span className={`status-pill status-${meta.status ?? 'S0'}`}>
            {meta.status ?? 'S0'} · {REVISION_STATUSES[meta.status ?? 'S0'].name}
          </span>
          <button className="btn-ghost btn-tiny" onClick={onAdd} disabled={!editable}>
            + Revision
          </button>
          <button className="btn-primary btn-tiny" onClick={onIssue} disabled={!editable}>
            Issue Drawing
          </button>
        </div>
      </div>
      <div className="revision-table-wrap">
        <table className="revision-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Date</th>
              <th>Description</th>
              <th>Author</th>
              <th>Approved</th>
            </tr>
          </thead>
          <tbody>
            {revisions.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-mute)', padding: 12 }}>
                No revisions yet.
              </td></tr>
            )}
            {revisions.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{r.code}</td>
                <td><span className={`status-pill status-${r.status}`}>{r.status}</span></td>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.description}</td>
                <td>{r.author}</td>
                <td>{r.approvedBy ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
