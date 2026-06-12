import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useItpItems } from '../state/selectors';
import { nanoid } from 'nanoid';
import type { ITPItem } from '../models/fire';

const STATUSES: ITPItem['status'][] = ['pending', 'in-progress', 'inspected-pass', 'inspected-fail', 'cleared'];

export function ITPChecklistPanel() {
  const setProject = useStore((s) => s.setProject);

  const [filter, setFilter] = useState<'all' | ITPItem['status']>('all');

  const items = useItpItems() ?? {};
  const list = useMemo(() => {
    return Object.values(items).filter((it) => filter === 'all' || it.status === filter);
  }, [items, filter]);

  // Spread the live project from getState() so the panel only subscribes to
  // the ITP slice it renders.
  const upsert = (it: ITPItem) => {
    const project = useStore.getState().project;
    setProject({
      ...project,
      itpItems: { ...(project.itpItems ?? {}), [it.id]: it },
      modified: Date.now(),
    });
  };

  const setStatus = (it: ITPItem, st: ITPItem['status']) => {
    upsert({ ...it, status: st, inspectedAt: st === 'inspected-pass' || st === 'inspected-fail' ? Date.now() : it.inspectedAt });
  };

  const onAdd = () => {
    const ref = window.prompt('ITP reference?', 'ITP-001');
    if (!ref) return;
    const activity = window.prompt('Activity?', 'Containment installation') ?? 'Activity';
    const it: ITPItem = {
      id: nanoid(10),
      reference: ref,
      activity,
      acceptanceCriteria: 'Per design',
      controlPoint: 'I',
      responsibility: 'Contractor',
      status: 'pending',
    };
    upsert(it);
  };

  const setNotes = (it: ITPItem, notes: string) => upsert({ ...it, notes });

  return (
    <div className="itp-panel">
      <div className="itp-panel-header">
        <span>Inspection & Test Plan</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-ghost btn-tiny" onClick={onAdd}>+ Item</button>
      </div>
      <div className="itp-list">
        {list.length === 0 && (
          <div className="itp-empty">No ITP items.</div>
        )}
        {list.map((it) => (
          <div key={it.id} className={`itp-item status-${it.status}`}>
            <div className="itp-head">
              <span className="itp-ref">{it.reference}</span>
              <span className="itp-activity">{it.activity}</span>
              <span className="itp-spacer" />
              <span className={`itp-status status-${it.status}`}>{it.status}</span>
            </div>
            <div className="itp-meta">
              <span><strong>Criteria:</strong> {it.acceptanceCriteria}</span>
              <span><strong>Control:</strong> {it.controlPoint}</span>
              <span><strong>By:</strong> {it.responsibility}</span>
            </div>
            <div className="itp-actions">
              <select value={it.status} onChange={(e) => setStatus(it, e.target.value as ITPItem['status'])}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                placeholder="Notes…"
                value={it.notes ?? ''}
                onChange={(e) => setNotes(it, e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
