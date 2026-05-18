import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, Project, Sheet } from '../../types';
import { layoutContainmentsSideBySide } from '../containment-layout';

const makeContainment = (
  id: string,
  points: ContainmentEntity['points'],
  width = 200,
  elevation = 2300,
): ContainmentEntity => ({
  id,
  kind: 'containment',
  layerId: 'containment',
  visible: true,
  locked: false,
  containmentType: 'tray',
  width,
  height: 50,
  points,
  elevation,
});

const makeProject = (containments: ContainmentEntity[]): Project => {
  const sheet: Sheet = {
    id: 'sheet-1',
    name: 'Plan',
    number: '101',
    kind: 'floor-plan',
    width: 10000,
    height: 10000,
    entities: Object.fromEntries(containments.map((containment) => [containment.id, containment])),
    entityOrder: containments.map((containment) => containment.id),
  };
  return {
    id: 'project-1',
    name: 'Project',
    created: 0,
    modified: 0,
    layers: {},
    layerOrder: [],
    sheets: { [sheet.id]: sheet },
    sheetOrder: [sheet.id],
    activeSheetId: sheet.id,
    activeLayerId: 'containment',
    units: 'mm',
    standard: 'IEC',
  };
};

const routeAngle = (containment: ContainmentEntity): number => {
  const first = containment.points[0];
  const last = containment.points[containment.points.length - 1];
  return Math.atan2(last.y - first.y, last.x - first.x);
};

const centreY = (containment: ContainmentEntity): number =>
  containment.points.reduce((sum, point) => sum + point.y, 0) / containment.points.length;

describe('layoutContainmentsSideBySide', () => {
  it('straightens selected containments into parallel same-elevation lanes with clearance', () => {
    const ladder = makeContainment('ladder', [{ x: 0, y: 0 }, { x: 4000, y: 0 }], 300, 2400);
    const tray = makeContainment('tray', [{ x: 0, y: 120 }, { x: 1800, y: 320 }, { x: 4000, y: 260 }], 200, 2200);
    const project = makeProject([ladder, tray]);

    const result = layoutContainmentsSideBySide(project, 'sheet-1', ['ladder', 'tray'], 150);

    expect(result).not.toBeNull();
    const nextSheet = result!.project.sheets['sheet-1'];
    const nextLadder = nextSheet.entities.ladder as ContainmentEntity;
    const nextTray = nextSheet.entities.tray as ContainmentEntity;
    expect(nextTray.points.length).toBe(2);
    expect(routeAngle(nextTray)).toBeCloseTo(routeAngle(nextLadder), 6);
    expect(nextTray.elevation).toBe(nextLadder.elevation);
    const faceGap = Math.abs(centreY(nextTray) - centreY(nextLadder)) - (nextLadder.width ?? 0) / 2 - (nextTray.width ?? 0) / 2;
    expect(faceGap).toBeCloseTo(150, 6);
  });
});
