// Project-wide compliance check: aggregates fill, segregation, support
// spacing and voltage drop into a single report.

import type { Project, ContainmentEntity, EntityId, SheetId, SupportEntity } from '../types';
import type { Cable } from '../models/cable';
import type { StandardsProfile, StandardsTrace } from '../models/standards';
import { DEFAULT_STANDARDS, createStandardsTrace } from '../models/standards';
import { computeContainmentFill } from './fill';
import { checkSegregation } from './segregation';
import { polylineLength, computeSupportSpacing } from './supports';
import { computeVoltageDrop } from './voltage-drop';
import { checkProtectiveDeviceCoordination } from './protective-device';
import { analyzeSceneClearance } from '../lib/scene-clearance';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueKind =
  | 'fill'
  | 'segregation'
  | 'support-spacing'
  | 'clearance'
  | 'voltage-drop'
  | 'protective-device'
  | 'fire-stop'
  | 'cable-route';

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
  standards: StandardsTrace;
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

const containmentsBySheet = (
  project: Project,
): { containment: ContainmentEntity; sheetId: SheetId }[] => {
  const out: { containment: ContainmentEntity; sheetId: SheetId }[] = [];
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e?.kind === 'containment') out.push({ containment: e as ContainmentEntity, sheetId: sid });
    }
  }
  return out;
};

const supportsByContainment = (project: Project): Map<EntityId, SupportEntity[]> => {
  const out = new Map<EntityId, SupportEntity[]>();
  for (const sid of project.sheetOrder) {
    const sheet = project.sheets[sid];
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e?.kind !== 'support') continue;
      const support = e as SupportEntity;
      for (const containmentId of support.supportingContainmentIds) {
        const list = out.get(containmentId) ?? [];
        list.push(support);
        out.set(containmentId, list);
      }
    }
  }
  return out;
};

const checkContainmentClearance = (project: Project, issues: ComplianceIssue[]): void => {
  const seen = new Set<string>();
  for (const { containment, sheetId } of containmentsBySheet(project)) {
    for (const issue of analyzeSceneClearance({ ...project, activeSheetId: sheetId }, containment)) {
      const key = [issue.sourceId, issue.targetId].sort().join(':') + ':' + issue.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      const source = containment.label ?? containment.containmentType;
      issues.push({ entityId: containment.id, sheetId, kind: 'clearance',
        severity: issue.kind === 'clearance' ? 'warning' : 'error',
        message: issue.kind === 'access' ? `${source} enters equipment access space: ${issue.targetLabel}`
          : issue.kind === 'overlap' ? `${source} overlaps ${issue.targetLabel}`
          : `${source} to ${issue.targetLabel}: ${Math.round(issue.gap)} mm clearance (guide ${issue.limit} mm)`,
        measured: Math.max(0, issue.gap), limit: issue.limit, unit: 'mm' });
    }
  }
};

export const runComplianceChecks = (project: Project): ComplianceReport => {
  const standards: StandardsProfile = project.standardsProfile ?? DEFAULT_STANDARDS.BS7671;
  const issues: ComplianceIssue[] = [];
  const cableMap = project.cableSchedule?.cables ?? {};
  const cables = Object.values(cableMap);
  const containments = allContainments(project);
  const supportMap = supportsByContainment(project);

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
    // support on any run longer than the allowed span, then flag long
    // runs for a detailed support layout review.
    const len = polylineLength(c.points);
    const maxSpan = computeSupportSpacing(c);
    const supports = supportMap.get(c.id) ?? [];
    if (len > maxSpan && supports.length === 0) {
      issues.push({
        entityId: c.id,
        sheetId,
        kind: 'support-spacing',
        severity: 'warning',
        message: `Containment ${c.label ?? c.id} has no supports on a ${(len / 1000).toFixed(1)}m run`,
        measured: 0,
        limit: maxSpan / 1000,
        unit: 'm',
      });
    } else if (len > maxSpan * 4) {
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

  checkContainmentClearance(project, issues);

  // Cable voltage drop checks
  for (const cable of cables) {
    if (cable.designCurrent && cable.estimatedLength) {
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

    // This implementation is intentionally limited to the BS relation. The
    // other selectable profiles remain marked partial and must not silently
    // reuse a UK overload-protection rule.
    const cableAmpacity = cable.calculated?.ampacity ?? cable.calculated?.baseAmpacity;
    if (
      standards.code === 'BS7671' &&
      cable.designCurrent !== undefined &&
      cable.protectiveDeviceRating !== undefined &&
      cableAmpacity !== undefined
    ) {
      const coordination = checkProtectiveDeviceCoordination({
        designCurrentA: cable.designCurrent,
        deviceRatingA: cable.protectiveDeviceRating,
        cableAmpacityA: cableAmpacity,
        standardsCode: standards.code,
      });
      if (!coordination.ok) {
        issues.push({
          entityId: cable.id,
          kind: 'protective-device',
          severity: 'error',
          message: `Cable ${cable.reference} overload coordination fails Ib <= In <= Iz (${cable.designCurrent} A <= ${cable.protectiveDeviceRating} A <= ${cableAmpacity.toFixed(1)} A)`,
          measured: cable.protectiveDeviceRating,
          limit: cableAmpacity,
          unit: 'A',
        });
      }
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
    clearance: 0,
    'voltage-drop': 0,
    'protective-device': 0,
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
    standards: createStandardsTrace(standards, [
      'fill-limits',
      'space-factor-trunking-bs7671',
      'support-spans-opencad',
      'segregation-bs7671',
      'voltage-drop-limits',
      'voltage-drop-pvc-single-phase-bs7671',
      'voltage-drop-xlpe-three-phase-bs7671',
      'overload-coordination-bs7671',
    ]),
  };
};
