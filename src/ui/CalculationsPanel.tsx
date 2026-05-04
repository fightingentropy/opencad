import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import type { ContainmentEntity, Entity } from '../types';
import {
  cablesOnContainment,
  computeFill,
  estimateAmpacity,
  estimateCableLength,
  estimateVdrop,
  fmtNum,
  fmtPct,
} from './whole-site-helpers';

export function CalculationsPanel() {
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const sheet = project.sheets[project.activeSheetId];
  const sel = Array.from(editor.selection);
  const ent: Entity | null = sel.length === 1 ? sheet?.entities[sel[0]] ?? null : null;

  return (
    <div className="panel-section">
      <div className="panel-header">Calculations</div>
      <div className="panel-body" style={{ padding: 8 }}>
        {!ent && (
          <div style={{ color: 'var(--text-mute)', fontSize: 11, padding: 8 }}>
            Select a containment or cable-linked wire to see live calculations.
          </div>
        )}
        {ent && ent.kind === 'containment' && <ContainmentCalcs entity={ent as ContainmentEntity} />}
        {ent && ent.kind === 'wire' && <WireCalcs entity={ent} />}
        {ent && ent.kind !== 'containment' && ent.kind !== 'wire' && (
          <div style={{ color: 'var(--text-mute)', fontSize: 11 }}>
            No calculations for {ent.kind}.
          </div>
        )}
      </div>
    </div>
  );
}

function ContainmentCalcs({ entity }: { entity: ContainmentEntity }) {
  const project = useStore((s) => s.project);
  const sheet = project.sheets[project.activeSheetId];

  const cables = useMemo(() => cablesOnContainment(project, entity.id), [project, entity.id]);
  const fill = useMemo(() => computeFill(entity, cables), [entity, cables]);

  const lengthM = useMemo(() => {
    let mm = 0;
    const pts = entity.points ?? [];
    for (let i = 1; i < pts.length; i++) {
      mm += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return mm / 1000;
  }, [entity.points]);

  // Count fittings & supports tied to this containment
  const { fittings, supports } = useMemo(() => {
    let f = 0, s = 0;
    for (const id of sheet?.entityOrder ?? []) {
      const e = sheet.entities[id];
      if (!e) continue;
      if (e.kind === 'fitting' && (e as any).containmentId === entity.id) f++;
      if (e.kind === 'support' && (e as any).supportingContainmentIds?.includes(entity.id)) s++;
    }
    return { fittings: f, supports: s };
  }, [sheet, entity.id]);

  return (
    <div className="calc-section">
      <Row label="Type" value={entity.containmentType} />
      <Row label="Size" value={`${entity.width ?? '?'} × ${entity.height ?? '?'} mm`} />
      <Row label="Length" value={`${fmtNum(lengthM, 2)} m`} />
      <Row
        label="Fill"
        value={`${fmtPct(fill.fill)} / ${fmtPct(fill.limit)}`}
        accent={fill.ok ? 'good' : 'fail'}
      />
      <Row label="Cables" value={`${cables.length}`} />
      <Row label="Fittings" value={`${fittings}`} />
      <Row label="Supports" value={`${supports}`} />
    </div>
  );
}

function WireCalcs({ entity }: { entity: any }) {
  const project = useStore((s) => s.project);
  const cable = entity.cableId ? project.cableSchedule?.cables[entity.cableId] : null;

  if (!cable) {
    return (
      <div style={{ color: 'var(--text-mute)', fontSize: 11 }}>
        Wire is not linked to a cable in the schedule.
      </div>
    );
  }

  const len = estimateCableLength(cable, project);
  const amp = estimateAmpacity(cable);
  const vd = estimateVdrop(cable, len);

  return (
    <div className="calc-section">
      <Row label="Cable" value={cable.reference} />
      <Row label="From → To" value={`${cable.from} → ${cable.to}`} />
      <Row label="Cores × CSA" value={`${cable.cores} × ${cable.csa} mm²`} />
      <Row label="Length" value={`${fmtNum(len, 2)} m`} />
      <Row
        label="Ampacity"
        value={`Iz ${fmtNum(amp.iz, 0)} A · Ib ${fmtNum(amp.ib, 0)} A`}
        accent={amp.ok ? 'good' : 'fail'}
      />
      <Row
        label="V-drop"
        value={`${fmtNum(vd.vdropV, 2)} V · ${fmtNum(vd.vdropPct * 100, 2)}%`}
        accent={vd.ok ? 'good' : 'fail'}
      />
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'fail' }) {
  return (
    <div className="calc-row">
      <span className="calc-row-label">{label}</span>
      <span className={`calc-row-value${accent ? ` accent-${accent}` : ''}`}>{value}</span>
    </div>
  );
}
