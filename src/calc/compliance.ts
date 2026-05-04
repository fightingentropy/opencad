// Project-wide compliance check: aggregates fill, segregation, support
// spacing and voltage drop into a single report.

import type { Project, ContainmentEntity, EntityId, SheetId } from '../types';
import type { Cable } from '../models/cable';
import type { StandardsProfile } from '../models/standards';
import { DEFAULT_STANDARDS } from '../models/standards';
import { computeContainmentFill } from './fill';
import { checkSegregation } from './segregation';
import { polylineLength, computeSupportSpacing } from './supports';
import { computeVoltageDrop } from './voltage-drop';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueKind = 'fill' | 'segregation' | 'support-spacing' | 'voltage-drop' | 'fire-stop' | 'cable-route';

export interface ComplianceIssue {
  entityId: EntityId;
  sheetId?: SheetId;
  kind: IssueKind;
  severity: IssueSeverity;
  message: string;
  // Optional measured / required pair for display
  measured?: number;
  limit?: number;
  unit?: string;
}

export interface ComplianceReport {
  totalChecks: number;
  passed: number;
  warnings: number;
  errors: number;
  // Per-category counts
  byKind: Record<IssueKind, number>;
  issues: ComplianceIssue[];
  // Project-level summaries
  containmentCount: number;
  cableCount: number;
  averageFillPct: number;
  generatedAt: number;
}

const sheetForEntity = (project: Project, id: EntityId): SheetId | undefined => {
  for (const sid of project.sheetOrder) {
    const s = project.sheets[sid];
    if (s.entities[id]) return sid;
  }
  return undefined;
};

const cablesAssignedTo = (
  containmentId: EntityId,
  cableMap: Record<string, Cable>,
): Cable[] => {
  const out: Cable[] = [];
  for (const c of Object.values(cableMap)) {
    if (c.route?.includes(containmentId)) out.push(c);
  }
  return out;
};

const allContainments = (project: Project): ContainmentEntity[] => {
  const out: ContainmentEntity[] = [];
  for (const sid of project.sheetOrder) {
    const s = project.sheets[sid];
    for (const eid of s.entityOrder) {
      const e = s.entities[eid];
      if (e && e.kind === 'containment') out.push(e as ContainmentEntity);
    }
  }
  return out;
};

export const runComplianceChecks = (project: Project): ComplianceReport => {
  const standards: StandardsProfile = project.standardsProfile ?? DEFAULT_STANDARDS.BS7671;
  const issues: ComplianceIssue[] = [];
  const cableMap = project.cableSchedule?.cables ?? {};
  const cables = Object.values(cableMap);
  const containments = allContainments(project);

  let totalFill = 0;
  let containmentsWithCables = 0;

  for (const c of containments) {
    const sheetId = sheetForEntity(project, c.id);
    const assigned = cablesAssignedTo(c.id, cableMap);

    // Fill check
    if (assigned.length > 0) {
      const r = computeContainmentFill(c, assigned, standards);
      totalFill += r.fillPct;
      containmentsWithCables++;
      if (r.fillStatus === 'over') {
        issues.push({
          entityId: c.id,
          sheetId,
          kind: 'fill',
          severity: 'error',
          message: `Containment ${c.label ?? c.id} over fill limit: ${r.fillPct.toFixed(1)}% (limit ${(r.limit * 100).toFixed(0)}%)`,
          measured: r.fillPct,
          limit: r.limit * 100,
          unit: '%',
        });
      } else if (r.fillStatus === 'warning') {
        issues.push({
          entityId: c.id,
          sheetId,
          kind: 'fill',
          severity: 'warning',
          message: `Containment ${c.label ?? c.id} fill ${r.fillPct.toFixed(1)}% approaching limit`,
          measured: r.fillPct,
          limit: r.limit * 100,
          unit: '%',
        });
      }

      // Segregation
      const seg = checkSegregation(c, assigned);
      for (const v of seg.violations) {
        issues.push({
          entityId: c.id,
          sheetId,
          kind: 'segregation',
          severity: v.severity === 'error' ? 'error' : 'warning',
          message: v.message,
        });
      }
    }

    // Support spacing — sanity check on route length: at least one
    // support per maxSpan + 2 endpoints. Warn if very long with no
    // declared supports (we can't see SupportEntity here without a
    // pass through entities, but the renderer/auto-placer handles it).
    const len = polylineLength(c.points);
    const maxSpan = computeSupportSpacing(c);
    if (len > maxSpan * 4) {
      // long run — informational only
      issues.push({
        entityId: c.id,
        sheetId,
        kind: 'support-spacing',
        severity: 'info',
        message: `Long run ${(len / 1000).toFixed(1)}m (max span ${(maxSpan / 1000).toFixed(1)}m) — verify supports placed`,
        measured: len / 1000,
        limit: maxSpan / 1000,
        unit: 'm',
      });
    }
  }

  // Cable voltage drop checks
  for (const cable of cables) {
    if (!cable.designCurrent || !cable.estimatedLength) continue;
    const r = computeVoltageDrop({
      construction: cable.construction,
      csa: cable.csa,
      lengthM: cable.estimatedLength,
      designCurrentA: cable.designCurrent,
      systemVoltageV: cable.voltage,
      phasing: cable.cores >= 3 ? 'three' : 'single',
      loadCategory: cable.circuitType === 'data' || cable.circuitType === 'comms' ? 'other' : 'other',
      standardsCode: standards.code,
    });
    if (!r.withinLimits) {
      issues.push({
        entityId: cable.id,
        kind: 'voltage-drop',
        severity: 'error',
        message: `Cable ${cable.reference} voltage drop ${r.vdropPct.toFixed(2)}% exceeds limit ${r.limitPct.toFixed(1)}%`,
        measured: r.vdropPct,
        limit: r.limitPct,
        unit: '%',
      });
    }
  }

  // Fire stop coverage — every fire-rated wall crossed by a containment
  // should have a PenetrationSeal. We just count missing ones here.
  const seals = project.penetrationSeals ?? {};
  const flaggedSealCount = Object.values(seals).filter((s) => s.status === 'flagged').length;
  if (flaggedSealCount > 0) {
    issues.push({
      entityId: 'fire-stops',
      kind: 'fire-stop',
      severity: 'warning',
      message: `${flaggedSealCount} fire-stop penetration${flaggedSealCount === 1 ? '' : 's'} flagged but not designed`,
    });
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const passed = Math.max(0, containments.length + cables.length - errors - warnings);
  const byKind: Record<IssueKind, number> = {
    fill: 0,
    segregation: 0,
    'support-spacing': 0,
    'voltage-drop': 0,
    'fire-stop': 0,
    'cable-route': 0,
  };
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;

  return {
    totalChecks: containments.length + cables.length,
    passed,
    warnings,
    errors,
    byKind,
    issues,
    containmentCount: containments.length,
    cableCount: cables.length,
    averageFillPct: containmentsWithCables > 0 ? totalFill / containmentsWithCables : 0,
    generatedAt: Date.now(),
  };
};
