import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  useActiveSheet,
  useCableSchedule,
  useStandardsProfile,
} from '../state/selectors';
import type { ContainmentEntity } from '../types';
import { cablesOnContainment, computeFill, fmtPct } from './whole-site-helpers';

type Pos = { id: string; x: number; y: number; r: number; color: string; label: string };

// Visual cross-section box for the selected containment, with cables packed
// inside. Cables can be dragged to manual positions.
export function CrossSectionEditor({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const sheet = useActiveSheet();
  const cableSchedule = useCableSchedule();
  const standardsProfile = useStandardsProfile();
  const ent = sheet?.entities[entityId];
  if (!ent || ent.kind !== 'containment') return null;
  const cont = ent as ContainmentEntity;
  // cablesOnContainment only consults project.cableSchedule — the schedule
  // slice is the exact recompute trigger; the project is read untracked.
  const cables = useMemo(
    () => cablesOnContainment(useStore.getState().project, cont.id),
    [cableSchedule, cont.id],
  );

  const w = cont.width ?? 100;
  const h = cont.height ?? 50;
  const padding = 4;
  const innerW = Math.max(20, w - padding * 2);
  const innerH = Math.max(10, h - padding * 2);

  const initialPositions = useMemo<Pos[]>(() => {
    const out: Pos[] = [];
    let cx = padding;
    let cy = padding;
    let rowMaxR = 0;
    for (const c of cables) {
      const r = (c.outerDiameter || 8) / 2;
      if (cx + r * 2 > w - padding) {
        cx = padding;
        cy += rowMaxR * 2 + 1;
        rowMaxR = 0;
      }
      const colorMap: Record<string, string> = {
        power: '#ff5d5d',
        control: '#bb8cff',
        data: '#5cdcff',
        'fire-alarm': '#ff8a3d',
        emergency: '#ffd84d',
        comms: '#5cdcff',
        instrumentation: '#9ad65a',
        av: '#3ba3ff',
        earthing: '#9ad65a',
      };
      out.push({
        id: c.id,
        x: cx + r,
        y: cy + r,
        r,
        color: colorMap[c.circuitType] ?? '#5cdcff',
        label: c.reference,
      });
      cx += r * 2 + 1;
      if (r > rowMaxR) rowMaxR = r;
    }
    return out;
  }, [cables, w, padding]);

  const [positions, setPositions] = useState<Pos[]>(initialPositions);
  useEffect(() => setPositions(initialPositions), [initialPositions]);
  const [dragId, setDragId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // computeFill only reads project.standardsProfile beyond its arguments.
  const fill = useMemo(
    () => computeFill(cont, cables, useStore.getState().project),
    [cont, cables, standardsProfile],
  );

  // Render scale: fit width to ~480 px
  const scale = innerW > 0 ? Math.min(8, 480 / w) : 4;
  const dispW = w * scale;
  const dispH = h * scale;

  const onMouseDown = (id: string) => () => setDragId(id);
  const onMouseUp = () => setDragId(null);

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / scale;
    const my = (e.clientY - rect.top) / scale;
    setPositions((ps) => ps.map((p) => {
      if (p.id !== dragId) return p;
      const nx = Math.max(padding + p.r, Math.min(w - padding - p.r, mx));
      const ny = Math.max(padding + p.r, Math.min(h - padding - p.r, my));
      return { ...p, x: nx, y: ny };
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cross-section-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Cross Section — {cont.label ?? cont.id}
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer' }}>×</span>
        </div>
        <div className="modal-body">
          <div className="cross-section-meta">
            <span>{cont.containmentType}</span>
            <span>{w} × {h} mm</span>
            <span>{cables.length} cables</span>
          </div>
          <svg
            ref={svgRef}
            width={dispW}
            height={dispH}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            style={{ background: 'var(--canvas-bg)', border: '1px solid var(--border-light)', borderRadius: 4 }}
          >
            <rect x={padding * scale} y={padding * scale}
              width={innerW * scale} height={innerH * scale}
              fill="none" stroke="var(--border-light)" strokeDasharray="4 2" />
            {positions.map((p) => (
              <g key={p.id} onMouseDown={onMouseDown(p.id)} style={{ cursor: 'grab' }}>
                <circle
                  cx={p.x * scale} cy={p.y * scale} r={p.r * scale}
                  fill={p.color} stroke="#000" strokeWidth={0.5} fillOpacity={0.8}
                />
                <text
                  x={p.x * scale} y={p.y * scale + 3}
                  fontSize={Math.max(8, p.r * scale * 0.5)}
                  fill="#000"
                  textAnchor="middle"
                  pointerEvents="none"
                >{p.label}</text>
              </g>
            ))}
          </svg>
          <div className="cross-section-stats">
            <div>
              <span className="cs-label">Fill:</span>
              <span className={`cs-value ${fill.ok ? 'ok' : 'fail'}`}>{fmtPct(fill.fill)}</span>
              <span className="cs-limit">limit {fmtPct(fill.limit)}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
