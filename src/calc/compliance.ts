// Project-wide compliance check: aggregates fill, segregation, support
// spacing and voltage drop into a single report.

import type { Project, ContainmentEntity, EntityId, SheetId, SupportEntity } from '../types';
import type { Cable } from '../models/cable';
import type { StandardsProfile } from '../models/standards';
import { DEFAULT_STANDARDS } from '../models/standards';
import { computeContainmentFill } from './fill';
import { checkSegregation } from './segregation';
import { polylineLength, computeSupportSpacing } from './supports';
import { computeVoltageDrop } from './voltage-drop';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueKind =
  | 'fill'
  | 'segregation'
  | 'support-spacing'
  | 'clearance'
  | 'voltage-drop'
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

const verticalRangeForContainment = (c: ContainmentEntity): { min: number; max: number } => {
  const base = c.elevation ?? 2200;
  const height = c.containmentType === 'conduit'
    ? (c.width ?? 25)
    : (c.height ?? 50);
  return { min: base, max: base + Math.max(1, height) };
};

const overlapAmount = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.min(aMax, bMax) - Math.max(aMin, bMin);

const halfWidthForContainment = (c: ContainmentEntity): number =>
  Math.max(1, (c.width ?? 100) / 2);

const pointSegmentDistance = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
};

const orientation = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number => (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const onSegment = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean =>
  b.x <= Math.max(a.x, c.x) &&
  b.x >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) &&
  b.y >= Math.min(a.y, c.y);

const segmentsIntersect = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  const eps = 0.001;
  if (Math.abs(o1) < eps && onSegment(a1, b1, a2)) return true;
  if (Math.abs(o2) < eps && onSegment(a1, b2, a2)) return true;
  if (Math.abs(o3) < eps && onSegment(b1, a1, b2)) return true;
  if (Math.abs(o4) < eps && onSegment(b1, a2, b2)) return true;
  return false;
};

const segmentDistance = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): number => {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
};

const minimumFaceGap = (a: ContainmentEntity, b: ContainmentEntity): number | null => {
  if (a.points.length < 2 || b.points.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < a.points.length - 1; i++) {
    for (let j = 0; j < b.points.length - 1; j++) {
      const centerlineGap = segmentDistance(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
      min = Math.min(min, centerlineGap - halfWidthForContainment(a) - halfWidthForContainment(b));
    }
  }
  return Number.isFinite(min) ? min : null;
};

const MIN_CONTAINMENT_CLEARANCE_MM = 150;

const checkContainmentClearance = (
  project: Project,
  issues: ComplianceIssue[],
): void => {
  const entries = containmentsBySheet(project);
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    const aZ = verticalRangeForContainment(a.containment);
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j];
      if (a.sheetId !== b.sheetId) continue;
      const bZ = verticalRangeForContainment(b.containment);
      if (overlapAmount(aZ.min, aZ.max, bZ.min, bZ.max) <= 0) continue;

      const faceGap = minimumFaceGap(a.containment, b.containment);
      if (faceGap === null) continue;
      const labelA = a.containment.label ?? a.containment.containmentType;
      const labelB = b.containment.label ?? b.containment.containmentType;

      if (faceGap < 0) {
        issues.push({
          entityId: a.containment.id,
          sheetId: a.sheetId,
          kind: 'clearance',
          severity: 'error',
          message: `Containments overlap at same elevation: ${labelA} and ${labelB}`,
          measured: 0,
          limit: MIN_CONTAINMENT_CLEARANCE_MM,
          unit: 'mm',
        });
        continue;
      }

      if (faceGap < MIN_CONTAINMENT_CLEARANCE_MM) {
        issues.push({
          entityId: a.containment.id,
          sheetId: a.sheetId,
          kind: 'clearance',
          severity: 'warning',
          message: `Containment clearance below ${MIN_CONTAINMENT_CLEARANCE_MM}mm: ${labelA} to ${labelB} is ${faceGap.toFixed(0)}mm`,
          measured: faceGap,
          limit: MIN_CONTAINMENT_CLEARANCE_MM,
          unit: 'mm',
        });
      }
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
    clearance: 0,
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
