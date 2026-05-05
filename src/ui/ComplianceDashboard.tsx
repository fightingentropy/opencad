import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import { runComplianceChecks } from '../calc';
import type { ComplianceIssue } from '../calc';
import { findSheetForEntity, fmtNum, fmtPct } from './whole-site-helpers';

export function ComplianceDashboard({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const setActiveSheet = useStore((s) => s.setActiveSheet);
  const setSelection = useStore((s) => s.setSelection);

  const report = useMemo(() => runComplianceChecks(project), [project]);

  const navigate = (issue: ComplianceIssue) => {
    const sheetId = issue.sheetId ?? findSheetForEntity(project, issue.entityId)?.id;
    if (sheetId) setActiveSheet(sheetId);
    if (issue.entityId) setSelection([issue.entityId]);
    onClose();
  };

  const card = (
    title: string,
    value: string,
    status: 'good' | 'amber' | 'red' | 'neutral',
    sub?: string,
  ) => (
    <div className={`compliance-card status-${status}`}>
      <div className="compliance-card-title">{title}</div>
      <div className="compliance-card-value">{value}</div>
      {sub && <div className="compliance-card-sub">{sub}</div>}
    </div>
  );

  const fillIssues = report.byKind.fill ?? 0;
  const segregationIssues = report.byKind.segregation ?? 0;
  const supportIssues = report.byKind['support-spacing'] ?? 0;
  const vdropIssues = report.byKind['voltage-drop'] ?? 0;
  const fireIssues = report.byKind['fire-stop'] ?? 0;

  const fillStatus: 'good' | 'amber' | 'red' =
    fillIssues === 0 ? 'good' : report.errors > 0 ? 'red' : 'amber';
  const segregationStatus: 'good' | 'red' =
    segregationIssues === 0 ? 'good' : 'red';
  const supportStatus: 'good' | 'amber' =
    supportIssues === 0 ? 'good' : 'amber';
  const vdropStatus: 'good' | 'red' =
    vdropIssues === 0 ? 'good' : 'red';
  const fireStatus: 'good' | 'amber' =
    fireIssues === 0 ? 'good' : 'amber';

  const overallRatio = report.totalChecks > 0
    ? report.passed / report.totalChecks
    : 1;

  const visibleIssues = report.issues;

  const severityClass = (sev: ComplianceIssue['severity']): 'red' | 'amber' =>
    sev === 'error' ? 'red' : 'amber';

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
            {card(
              'Fill Compliance',
              report.containmentCount === 0 ? '—' : fmtPct(overallRatio),
              fillStatus,
              `${report.containmentCount} containments · avg ${fmtNum(report.averageFillPct, 1)}% · ${fillIssues} issue${fillIssues === 1 ? '' : 's'}`,
            )}
            {card(
              'Support Spacing',
              `${supportIssues}`,
              supportStatus,
              supportIssues === 0 ? 'All runs within span' : 'Long runs flagged',
            )}
            {card(
              'Segregation',
              `${segregationIssues}`,
              segregationStatus,
              segregationIssues === 0 ? 'No violations' : 'Mixed-category routes detected',
            )}
            {card(
              'Fire Stops',
              `${fireIssues}`,
              fireStatus,
              fireIssues === 0 ? 'All seals designed' : 'Penetration designs pending',
            )}
            {card(
              'Voltage Drop',
              `${vdropIssues}`,
              vdropStatus,
              `${report.cableCount} cables checked`,
            )}
          </div>
          <div className="compliance-violations">
            <div className="compliance-section-header">
              Issues ({visibleIssues.length}) · {report.errors} error{report.errors === 1 ? '' : 's'} · {report.warnings} warning{report.warnings === 1 ? '' : 's'}
            </div>
            <div className="compliance-violation-list">
              {visibleIssues.length === 0 && (
                <div className="compliance-empty">No issues detected — design is compliant.</div>
              )}
              {visibleIssues.map((issue, i) => (
                <div
                  key={`${issue.kind}-${issue.entityId}-${i}`}
                  className={`compliance-violation severity-${severityClass(issue.severity)}`}
                  onClick={() => navigate(issue)}
                  title="Click to navigate"
                >
                  <span className="violation-kind">{issue.kind}</span>
                  <span className="violation-message">{issue.message}</span>
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
