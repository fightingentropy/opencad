import type { ContainmentEntity, EntityId, Project, Sheet, SheetId, Vec2 } from '../types';

const DEFAULT_CLEARANCE_MM = 150;
const DEFAULT_ELEVATION_MM = 2200;

interface Basis {
  dir: Vec2;
  perp: Vec2;
}

interface LayoutItem {
  containment: ContainmentEntity;
  centre: number;
  halfWidth: number;
  longMin: number;
  longMax: number;
}

export interface LayoutContainmentsResult {
  project: Project;
  changedIds: EntityId[];
  clearanceMm: number;
  elevation: number;
}

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

const routeBasis = (containment: ContainmentEntity): Basis | null => {
  if (containment.points.length < 2) return null;
  const first = containment.points[0];
  const last = containment.points[containment.points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const dir = { x: dx / length, y: dy / length };
  return {
    dir,
    perp: { x: -dir.y, y: dir.x },
  };
};

const containmentHalfWidth = (containment: ContainmentEntity): number =>
  Math.max(1, (containment.width ?? 100) / 2);

const medianElevation = (containments: ContainmentEntity[]): number => {
  const values = containments
    .map((containment) => containment.elevation)
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return DEFAULT_ELEVATION_MM;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};

const itemFor = (containment: ContainmentEntity, basis: Basis): LayoutItem | null => {
  if (containment.points.length < 2) return null;
  let centre = 0;
  let longMin = Infinity;
  let longMax = -Infinity;
  for (const point of containment.points) {
    centre += dot(point, basis.perp);
    const longitudinal = dot(point, basis.dir);
    longMin = Math.min(longMin, longitudinal);
    longMax = Math.max(longMax, longitudinal);
  }
  return {
    containment,
    centre: centre / containment.points.length,
    halfWidth: containmentHalfWidth(containment),
    longMin,
    longMax,
  };
};

const pointFromBasis = (longitudinal: number, lateral: number, basis: Basis): Vec2 => ({
  x: basis.dir.x * longitudinal + basis.perp.x * lateral,
  y: basis.dir.y * longitudinal + basis.perp.y * lateral,
});

export function layoutContainmentsSideBySide(
  project: Project,
  sheetId: SheetId,
  containmentIds: EntityId[],
  clearanceMm = DEFAULT_CLEARANCE_MM,
): LayoutContainmentsResult | null {
  const sheet = project.sheets[sheetId];
  if (!sheet) return null;

  const containments = Array.from(new Set(containmentIds))
    .map((id) => sheet.entities[id])
    .filter((entity): entity is ContainmentEntity => entity?.kind === 'containment' && entity.points.length >= 2);

  if (containments.length < 2) return null;

  const basis = routeBasis(containments[0]);
  if (!basis) return null;

  const items = containments
    .map((containment) => itemFor(containment, basis))
    .filter((item): item is LayoutItem => item !== null)
    .sort((a, b) => a.centre - b.centre);

  if (items.length < 2) return null;

  const desiredCentres: number[] = [items[0].centre];
  for (let i = 1; i < items.length; i++) {
    desiredCentres[i] =
      desiredCentres[i - 1] +
      items[i - 1].halfWidth +
      items[i].halfWidth +
      clearanceMm;
  }

  const currentMean = items.reduce((sum, item) => sum + item.centre, 0) / items.length;
  const desiredMean = desiredCentres.reduce((sum, value) => sum + value, 0) / desiredCentres.length;
  const centreShift = currentMean - desiredMean;
  const elevation = medianElevation(containments);

  const entities: Sheet['entities'] = { ...sheet.entities };
  const changedIds: EntityId[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const desiredCentre = desiredCentres[i] + centreShift;
    entities[item.containment.id] = {
      ...item.containment,
      points: [
        pointFromBasis(item.longMin, desiredCentre, basis),
        pointFromBasis(item.longMax, desiredCentre, basis),
      ],
      elevation,
    };
    changedIds.push(item.containment.id);
  }

  return {
    project: {
      ...project,
      sheets: {
        ...project.sheets,
        [sheetId]: {
          ...sheet,
          entities,
        },
      },
      modified: Date.now(),
    },
    changedIds,
    clearanceMm,
    elevation,
  };
}
