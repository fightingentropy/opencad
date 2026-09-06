import { describe, expect, it } from 'vitest';
import { createContainmentSampleProject } from '../sample-containment';
import { exportProjectJSON, importProjectJSON } from '../io/project';
import { projectStructureDefects } from '../io/project-validation';
import type { ContainmentEntity, Project } from '../types';

const routesIn = (project: Project): ContainmentEntity[] => Object.values(project.sheets)
  .flatMap((sheet) => Object.values(sheet.entities))
  .filter((entity): entity is ContainmentEntity => entity.kind === 'containment');

describe('containment starter project', () => {
  it('contains only tray, trunking and basket on one 3D workplane', () => {
    const project = createContainmentSampleProject();
    const sheet = project.sheets[project.activeSheetId];
    const floor = project.floors?.[sheet.floorId!];
    const routes = routesIn(project);

    expect(projectStructureDefects(project)).toEqual([]);
    expect(project.sheetOrder).toEqual([sheet.id]);
    expect(sheet.sceneStyle).toBe('containment');
    expect(sheet.entityOrder).toHaveLength(3);
    expect(routes.map((route) => route.containmentType).sort()).toEqual(['basket', 'tray', 'trunking']);
    expect(floor?.sheetIds).toEqual([sheet.id]);
    expect(project.buildings?.[floor!.buildingId]?.floorOrder).toEqual([floor?.id]);
    expect(project.sites?.[project.activeSiteId!]?.buildingOrder).toEqual([floor?.buildingId]);
    expect(Object.values(project.cableSchedule?.cables ?? {})).toEqual([]);
    expect(Object.values(project.systems ?? {})).toEqual([]);
    expect(Object.values(project.zones ?? {})).toEqual([]);
    expect(Object.values(project.penetrationSeals ?? {})).toEqual([]);
    expect(routes.every((route) => !route.installation && !route.systemId && !route.assignedCableIds?.length)).toBe(true);
  });

  it('uses the documented section sizes at one neutral datum', () => {
    const project = createContainmentSampleProject();
    const routes = routesIn(project);
    expect(project.units).toBe('mm');
    expect(routes.map(({ containmentType, width, height }) => [containmentType, width, height])).toEqual([
      ['tray', 300, 50],
      ['trunking', 150, 150],
      ['basket', 300, 54],
    ]);
    expect(new Set(routes.map((route) => route.elevation))).toEqual(new Set([0]));
    expect(new Set(routes.map((route) => route.color)).size).toBe(1);
    expect(routes.every((route) => route.material?.includes('galvanised'))).toBe(true);
  });

  it('keeps complete route envelopes apart and every straight usable', () => {
    const project = createContainmentSampleProject();
    const sheet = project.sheets[project.activeSheetId];
    const routes = routesIn(project);
    const bounds = routes.map((route) => {
      const halfWidth = route.width! / 2;
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1];
        const b = route.points[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        expect(length).toBeGreaterThanOrEqual(1000);
        expect(length).toBeLessThanOrEqual(3000);
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      const box = {
        minX: Math.min(...route.points.map((point) => point.x)) - halfWidth,
        maxX: Math.max(...route.points.map((point) => point.x)) + halfWidth,
        minY: Math.min(...route.points.map((point) => point.y)) - halfWidth,
        maxY: Math.max(...route.points.map((point) => point.y)) + halfWidth,
      };
      expect(box.minX).toBeGreaterThan(0);
      expect(box.maxX).toBeLessThan(sheet.width);
      expect(box.minY).toBeGreaterThan(0);
      expect(box.maxY).toBeLessThan(sheet.height);
      return box;
    });

    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i];
        const b = bounds[j];
        const gap = Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY);
        expect(gap).toBeGreaterThanOrEqual(600);
      }
    }
  });

  it('round-trips without adding installation entities or losing its view intent', () => {
    const project = createContainmentSampleProject();
    const restored = importProjectJSON(exportProjectJSON(project));
    expect(restored.sheets[restored.activeSheetId].sceneStyle).toBe('containment');
    expect(restored.sheetOrder).toEqual(project.sheetOrder);
    expect(routesIn(restored)).toEqual(routesIn(project));
    expect(Object.values(restored.sheets).flatMap((sheet) => Object.values(sheet.entities))).toHaveLength(3);
    expect(Object.values(restored.cableSchedule?.cables ?? {})).toEqual([]);
  });
});
