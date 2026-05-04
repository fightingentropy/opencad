import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { nanoid } from 'nanoid';
import type { Cable, CableCircuitType, CableSchedule } from '../models/cable';
import { CableEditDialog } from './CableEditDialog';
import { estimateAmpacity, estimateCableLength, estimateVdrop, fmtNum } from './whole-site-helpers';

type SortKey = 'reference' | 'from' | 'to' | 'systemId' | 'circuitType' | 'csa' | 'voltage';

export function CableScheduleModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);

  const schedule: CableSchedule = useMemo(
    () => project.cableSchedule ?? { cables: {}, cableOrder: [] },
    [project.cableSchedule],
  );

  const [editing, setEditing] = useState<Cable | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filterSystem, setFilterSystem] = useState<string>('all');
  const [filterCircuit, setFilterCircuit] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('reference');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const systems = Object.values(project.systems ?? {});

  const visible = useMemo(() => {
    const items = schedule.cableOrder.map((id) => schedule.cables[id]).filter(Boolean);
    return items
      .filter((c) => filterSystem === 'all' || c.systemId === filterSystem)
      .filter((c) => filterCircuit === 'all' || c.circuitType === filterCircuit)
      .sort((a, b) => {
        const av = (a as any)[sortKey] ?? '';
        const bv = (b as any)[sortKey] ?? '';
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });
  }, [schedule, filterSystem, filterCircuit, sortKey, sortDir]);

  const updateSchedule = (next: CableSchedule) => {
    setProject({ ...project, cableSchedule: next, modified: Date.now() });
  };

  const upsertCable = (c: Cable) => {
    if (!c.id) c = { ...c, id: nanoid(10) };
    const cables = { ...schedule.cables, [c.id]: c };
    const cableOrder = schedule.cableOrder.includes(c.id)
      ? schedule.cableOrder
      : [...schedule.cableOrder, c.id];
    updateSchedule({ cables, cableOrder });
  };

  const removeCables = (ids: string[]) => {
    if (ids.length === 0) return;
    const cables = { ...schedule.cables };
    for (const id of ids) delete cables[id];
    updateSchedule({
      cables,
      cableOrder: schedule.cableOrder.filter((id) => !ids.includes(id)),
    });
    setSelected(new Set());
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };

  const inlineSet = (id: string, key: keyof Cable, val: any) => {
    const c = schedule.cables[id];
    if (!c) return;
    upsertCable({ ...c, [key]: val });
  };

  const onCsv = () => {
    const head = 'ref,from,to,system,circuit,construction,cores,csa,od,voltage,Ib,length\n';
    const body = visible.map((c) => [
      c.reference, c.from, c.to,
      c.systemId ?? '', c.circuitType, c.construction,
      c.cores, c.csa, c.outerDiameter, c.voltage,
      c.designCurrent ?? '',
      estimateCableLength(c, project).toFixed(1),
    ].join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, '_')}_cables.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const text = await f.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return alert('CSV is empty');
      const cables = { ...schedule.cables };
      const order = [...schedule.cableOrder];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue;
        const id = nanoid(10);
        const c: Cable = {
          id,
          reference: cols[0]?.trim() || `C-${id}`,
          from: cols[1]?.trim() || '',
          to: cols[2]?.trim() || '',
          systemId: cols[3]?.trim() || undefined,
          circuitType: (cols[4]?.trim() || 'power') as CableCircuitType,
          construction: (cols[5]?.trim() || 'XLPE/SWA/LSOH') as Cable['construction'],
          cores: parseInt(cols[6]) || 3,
          csa: parseFloat(cols[7]) || 2.5,
          outerDiameter: parseFloat(cols[8]) || 12,
          voltage: parseFloat(cols[9]) || 400,
          designCurrent: parseFloat(cols[10]) || undefined,
          hasEarth: true,
          route: [],
          status: 'design',
        };
        cables[id] = c;
        order.push(id);
      }
      updateSchedule({ cables, cableOrder: order });
    };
    input.click();
  };

  const onAutoRoute = () => {
    if (selected.size === 0) return alert('Select cables to auto-route first');
    alert(`Auto-route requested for ${selected.size} cable(s) — calc engine will handle this.`);
  };

  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((c) => c.id)));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal cable-schedule-modal"
        style={{ minWidth: '90vw', minHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          Cable Schedule — {project.name}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-mute)', fontSize: 12, fontWeight: 'normal' }}>
              {visible.length} of {schedule.cableOrder.length} cables
            </span>
            <span className="close" onClick={onClose} style={{ cursor: 'pointer' }}>×</span>
          </span>
        </div>
        <div className="cable-schedule-toolbar">
          <button className="btn-ghost" onClick={() => setShowAdd(true)}>+ Add Cable</button>
          <button
            className="btn-ghost"
            onClick={() => removeCables(Array.from(selected))}
            disabled={selected.size === 0}
          >
            Delete ({selected.size})
          </button>
          <button className="btn-ghost" onClick={onImport}>Import CSV</button>
          <button className="btn-ghost" onClick={onCsv}>Export CSV</button>
          <button className="btn-ghost" onClick={onAutoRoute}>Auto-route Selected</button>
          <span className="cable-schedule-spacer" />
          <select value={filterSystem} onChange={(e) => setFilterSystem(e.target.value)}>
            <option value="all">All Systems</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={filterCircuit} onChange={(e) => setFilterCircuit(e.target.value)}>
            <option value="all">All Circuits</option>
            {['power', 'control', 'data', 'fire-alarm', 'emergency', 'instrumentation', 'comms', 'av', 'earthing']
              .map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="cable-schedule-table-wrap">
          <table className="cable-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && selected.size === visible.length}
                    onChange={toggleAll}
                  />
                </th>
                <th onClick={() => toggleSort('reference')} className="sortable">Ref</th>
                <th onClick={() => toggleSort('from')} className="sortable">From</th>
                <th onClick={() => toggleSort('to')} className="sortable">To</th>
                <th>System</th>
                <th onClick={() => toggleSort('circuitType')} className="sortable">Circuit</th>
                <th>Type</th>
                <th>Cores×CSA</th>
                <th>OD</th>
                <th>Voltage</th>
                <th>Length</th>
                <th>Ib</th>
                <th>Vdrop</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={15} style={{ textAlign: 'center', color: 'var(--text-mute)', padding: 24 }}>
                  No cables in schedule. Click "+ Add Cable" or import a CSV.
                </td></tr>
              )}
              {visible.map((c) => {
                const len = estimateCableLength(c, project);
                const amp = estimateAmpacity(c);
                const vd = estimateVdrop(c, len);
                const failures: string[] = [];
                if (!amp.ok && amp.ib > 0) failures.push('ampacity');
                if (!vd.ok) failures.push('vdrop');
                const sysName = c.systemId ? project.systems?.[c.systemId]?.name ?? c.systemId : '—';
                return (
                  <tr key={c.id} className={failures.length ? 'has-warn' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => {
                          const s = new Set(selected);
                          s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                          setSelected(s);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.reference}
                        onChange={(e) => inlineSet(c.id, 'reference', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.from}
                        onChange={(e) => inlineSet(c.id, 'from', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={c.to}
                        onChange={(e) => inlineSet(c.id, 'to', e.target.value)}
                      />
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{sysName}</td>
                    <td>{c.circuitType}</td>
                    <td>{c.construction}</td>
                    <td>{c.cores}×
                      <input
                        className="inline-input small"
                        type="number"
                        step={0.5}
                        value={c.csa}
                        onChange={(e) => inlineSet(c.id, 'csa', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input small"
                        type="number"
                        step={0.1}
                        value={c.outerDiameter}
                        onChange={(e) => inlineSet(c.id, 'outerDiameter', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>{c.voltage}</td>
                    <td>{fmtNum(len, 1)} m</td>
                    <td>
                      <input
                        className="inline-input small"
                        type="number"
                        value={c.designCurrent ?? ''}
                        onChange={(e) => inlineSet(c.id, 'designCurrent', parseFloat(e.target.value) || undefined)}
                      />
                    </td>
                    <td className={vd.ok ? '' : 'fail'}>{fmtNum(vd.vdropPct * 100, 2)}%</td>
                    <td>{c.status ?? 'design'}</td>
                    <td>
                      <button className="btn-ghost btn-tiny" onClick={() => setEditing(c)}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        {showAdd && (
          <CableEditDialog
            cable={null}
            onClose={() => setShowAdd(false)}
            onSave={upsertCable}
          />
        )}
        {editing && (
          <CableEditDialog
            cable={editing}
            onClose={() => setEditing(null)}
            onSave={upsertCable}
          />
        )}
      </div>
    </div>
  );
}
