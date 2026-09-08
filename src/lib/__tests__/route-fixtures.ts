import type { ContainmentEntity, Entity, EquipmentEntity, Project, RoutePoint } from '../../types';
import { createEmptyProject } from '../../state/store';

export const routeFixture = (id = 'route', points: RoutePoint[] = [{ x: 0, y: 0, z: 2400 }, { x: 3000, y: 0, z: 2400 }]): ContainmentEntity => ({
  id, kind: 'containment', layerId: 'test-layer', visible: true, locked: false, label: id,
  containmentType: 'tray', width: 300, height: 50, elevation: points[0]?.z ?? 2400, points,
});
export const boardFixture = (): EquipmentEntity => ({
  id: 'board', kind: 'equipment', layerId: 'test-layer', visible: true, locked: false,
  equipmentKind: 'distribution-board', tag: 'DB-1', a: { x: 2700, y: -200 }, b: { x: 3300, y: 200 }, height: 1800, elevation: 0,
});
export function routeProject(...entities: Entity[]): Project {
  const project = createEmptyProject();
  const layer = { id: 'test-layer', name: 'Test', color: '#8899aa', visible: true, locked: false, lineWidth: 1 };
  project.layers[layer.id] = layer; project.layerOrder.push(layer.id); project.activeLayerId = layer.id;
  const sheet = project.sheets[project.activeSheetId];
  sheet.sceneStyle = 'containment'; sheet.entities = Object.fromEntries(entities.map(e => [e.id, e])); sheet.entityOrder = entities.map(e => e.id);
  return project;
}
