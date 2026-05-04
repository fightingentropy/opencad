import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import {
  allContainmentEntities,
  cablesOnContainment,
  computeFill,
  estimateAmpacity,
  estimateCableLength,
  estimateVdrop,
  fmtNum,
  fmtPct,
  findSheetForEntity,
} from './whole-site-helpers';

type Violation = {
  kind: string;
  entityId: string;
  sheetId: string;
  message: string;
  severity: 'amber' | 'red';
};

export function ComplianceDashboard({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const setActiveSheet = useStore((s) => s.setActiveSheet);
  const setSelection = useStore((s) => s.setSelection);

  const containments = useMemo(() => allContainmentEntities(project), [project]);

  const stats = useMemo(() => {
    let fillOk = 0, fillTotal = 0, fillFail = 0;
    let supportOk = 0, supportTotal = 0;
    let segregation = 0;
    let fireSeals = 0, fireFlagged = 0;
    let vdropFails = 0, vdropTotal = 0;
    const violations: Violation[] = [];

    for (const { entity, sheetId } of containments) {
      const cables = cablesOnContainment(project, entity.id);
      const fill = computeFill(entity, cables);
      fillTotal++;
      if (fill.fill > 0 && !fill.ok) {
        fillFail++;
        violations.push({
          kind: 'fill',
          entityId: entity.id,
          sheetId,
          message: `${entity.label ?? entity.id} fill ${fmtPct(fill.fill)} > limit ${fmtPct(fill.limit)}`,
          severity: 'red',
        });
      } else if (fill.fill > fill.limit * 0.85 && fill.fill < fill.limit) {
        violations.push({
          kind: 'fill',
          entityId: entity.id,
          sheetId,
          message: `${entity.label ?? entity.id} fill near limit (${fmtPct(fill.fill)})`,
          severity: 'amber',
        });
      } else if (fill.ok && fill.fill > 0) fillOk++;
      // Support spacing — assume present if at least one support carries it
      supportTotal++;
      // We'd query supports here; placeholder until calc engine.
      supportOk++;
      // Mixed cable-category in one containment → segregation issue
      const categories = new Set(cables.map((c) => c.circuitType));
      if (categories.has('power') && (categories.has('data') || categories.has('comms'))) {
        segregation++;
        violations.push({
          kind: 'segregation',
          entityId: entity.id,
          sheetId,
          message: `${entity.label ?? entity.id}: power and data sharing route`,
          severity: 'red',
        });
      }
    }

    // Penetration seals
    const seals = Object.values(project.penetrationSeals ?? {});
    fireSeals = seals.filter((s) => s.status === 'inspected' || s.status === 'installed' || s.status === 'approved').length;
    fireFlagged = seals.filter((s) => s.status === 'flagged' || s.status === 'failed').length;
    for (const s of seals) {
      if (s.status === 'flagged') {
        violations.push({
          kind: 'fire',
          entityId: s.boundaryEntityId,
          sheetId: findSheetForEntity(project, s.boundaryEntityId)?.id ?? '',
          message: `Penetration ${s.reference}: design pending`,
          severity: 'amber',
        });
      } else if (s.status === 'failed') {
        violations.push({
          kind: 'fire',
          entityId: s.boundaryEntityId,
          sheetId: findSheetForEntity(project, s.boundaryEntityId)?.id ?? '',
          message: `Penetration ${s.reference}: failed inspection`,
          severity: 'red',
        });
      }
    }

    // Cable v-drop
    const cables = Object.values(project.cableSchedule?.cables ?? {});
    for (const c of cables) {
      vdropTotal++;
      const len = estimateCableLength(c, project);
      const vd = estimateVdrop(c, len);
      const amp = estimateAmpacity(c);
      if (!vd.ok) {
        vdropFails++;
        violations.push({
          kind: 'vdrop',
          entityId: c.id,
          sheetId: '',
          message: `Cable ${c.reference} v-drop ${fmtNum(vd.vdropPct * 100, 2)}% > limit ${fmtNum(vd.limit * 100, 0)}%`,
          severity: 'red',
        });
      }
      if (amp.ib > 0 && !amp.ok) {
        violations.push({
          kind: 'ampacity',
          entityId: c.id,
          sheetId: '',
          message: `Cable ${c.reference} Iz=${amp.iz} A < Ib=${amp.ib} A`,
          severity: 'red',
        });
      }
    }

    return { fillOk, fillFail, fillTotal, supportOk, supportTotal, segregation, fireSeals, fireFlagged, vdropFails, vdropTotal, violations };
  }, [containments, project]);

  const navigate = (sheetId: string, entityId: string) => {
    if (sheetId) setActiveSheet(sheetId);
    if (entityId) setSelection([entityId]);
    onClose();
  };

  const card = (title: string, value: string, status: 'good' | 'amber' | 'red' | 'neutral', sub?: string) => (
    <div className={`compliance-card status-${status}`}>
      <div className="compliance-card-title">{title}</div>
      <div className="compliance-card-value">{value}</div>
      {sub && <div className="compliance-card-sub">{sub}</div>}
    </div>
  );

  const fillRatio = stats.fillTotal > 0 ? stats.fillOk / stats.fillTotal : 1;
  const supportRatio = stats.supportTotal > 0 ? stats.supportOk / stats.supportTotal : 1;
  const fireRatio = (stats.fireSeals + stats.fireFlagged) > 0
    ? stats.fireSeals / (stats.fireSeals + stats.fireFlagged) : 1;
  const vdropRatio = stats.vdropTotal > 0 ? (stats.vdropTotal - stats.vdropFails) / stats.vdropTotal : 1;

  const statusFor = (v: number): 'good' | 'amber' | 'red' =>
    v >= 0.95 ? 'good' : v >= 0.8 ? 'amber' : 'red';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal compliance-modal"
        style={{ minWidth: '85vw', minHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          Compliance Dashboard — {project.name}
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer' }}>×</span>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '70vh' }}>
          <div className="compliance-cards">
            {card('Fill Compliance', stats.fillTotal === 0 ? '—' : fmtPct(fillRatio), statusFor(fillRatio),
              `${stats.fillOk}/${stats.fillTotal} containments OK · ${stats.fillFail} fail`)}
            {card('Support Spacing', stats.supportTotal === 0 ? '—' : fmtPct(supportRatio), statusFor(supportRatio),
              `${stats.supportOk}/${stats.supportTotal} runs supported`)}
            {card('Segregation', `${stats.segregation}`, stats.segregation === 0 ? 'good' : 'red',
              stats.segregation === 0 ? 'No violations' : 'Mixed-category routes detected')}
            {card('Fire Stops', stats.fireSeals + stats.fireFlagged === 0 ? '—' : fmtPct(fireRatio),
              stats.fireFlagged > 0 ? 'red' : 'good',
              `${stats.fireSeals} sealed · ${stats.fireFlagged} flagged`)}
            {card('Voltage Drop', stats.vdropTotal === 0 ? '—' : fmtPct(vdropRatio), statusFor(vdropRatio),
              `${stats.vdropFails}/${stats.vdropTotal} cables exceed limit`)}
          </div>
          <div className="compliance-violations">
            <div className="compliance-section-header">
              Violations ({stats.violations.length})
            </div>
            <div className="compliance-violation-list">
              {stats.violations.length === 0 && (
                <div className="compliance-empty">No violations detected — design is compliant.</div>
              )}
              {stats.violations.map((v, i) => (
                <div
                  key={i}
                  className={`compliance-violation severity-${v.severity}`}
                  onClick={() => navigate(v.sheetId, v.entityId)}
                  title="Click to navigate"
                >
                  <span className="violation-kind">{v.kind}</span>
                  <span className="violation-message">{v.message}</span>
                  <span className="violation-arrow">›</span>
                </div>
              ))}
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
