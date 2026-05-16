import * as THREE from 'three';
import type { ContainmentEntity, Project } from '../types';
import type { Floor } from '../models/site';
import { defaultElevation } from './elevations';

export interface MeasurementRow {
  label: string;
  value: string;
}

export interface ContainmentMeasurement {
  title: string;
  rows: MeasurementRow[];
}

export function formatMm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value).toLocaleString('en-GB')} mm`;
}

export function formatSignedMm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '±0 mm';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toLocaleString('en-GB')} mm`;
}

export function containmentRouteLength(containment: ContainmentEntity): number {
  let length = 0;
  for (let i = 0; i < containment.points.length - 1; i++) {
    const a = containment.points[i];
    const b = containment.points[i + 1];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

export function containmentSizeLabel(containment: ContainmentEntity): string {
  const width = containment.width ?? 100;
  if (containment.containmentType === 'conduit') return `Ø${Math.round(width)} mm`;
  const height = containment.height ?? 50;
  return `${Math.round(width)} × ${Math.round(height)} mm`;
}

export function findContainment(project: Project, entityId: string): ContainmentEntity | undefined {
  for (const sid of project.sheetOrder) {
    const entity = project.sheets[sid]?.entities[entityId];
    if (entity?.kind === 'containment') return entity;
  }
  return undefined;
}

export function floorForContainment(
  project: Project,
  containmentId: string,
  preferredFloorId?: string,
): Floor | undefined {
  if (preferredFloorId) {
    const preferred = project.floors?.[preferredFloorId];
    if (preferred?.sheetIds.some((sid) => project.sheets[sid]?.entities[containmentId])) {
      return preferred;
    }
  }

  for (const floor of Object.values(project.floors ?? {})) {
    if (floor.sheetIds.some((sid) => project.sheets[sid]?.entities[containmentId])) {
      return floor;
    }
  }
  return undefined;
}

export function containmentMeasurement(
  project: Project,
  containment: ContainmentEntity,
  floor?: Floor,
): ContainmentMeasurement {
  const baseZ = defaultElevation(containment, floor);
  const height = containment.containmentType === 'conduit' ? (containment.width ?? 100) : (containment.height ?? 50);
  const topZ = baseZ + height;
  const systemName = containment.systemId ? project.systems?.[containment.systemId]?.name : undefined;
  const subType = containment.subType ? containment.subType.replaceAll('-', ' ') : undefined;
  const typeLabel = [containment.containmentType, subType].filter(Boolean).join(' · ');
  const rows: MeasurementRow[] = [
    { label: 'Type', value: typeLabel },
    { label: 'Size', value: containmentSizeLabel(containment) },
    { label: 'Bottom from FFL', value: `${formatSignedMm(baseZ)} FFL` },
    { label: 'Top from FFL', value: `${formatSignedMm(topZ)} FFL` },
    { label: 'Route length', value: formatMm(containmentRouteLength(containment)) },
  ];

  if (floor) rows.push({ label: 'Floor datum', value: `${formatSignedMm(floor.ffl)} site datum` });
  if (systemName) rows.push({ label: 'System', value: systemName });
  if (containment.cableCategory) rows.push({ label: 'Cable band', value: containment.cableCategory });

  return {
    title: containment.label || containment.id,
    rows,
  };
}

export function horizontalClearanceMm(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  return Math.hypot(dx, dy);
}

export function verticalClearanceMm(a: THREE.Box3, b: THREE.Box3): number {
  return Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
}
