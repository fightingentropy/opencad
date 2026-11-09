import { describe, expect, it } from 'vitest';
import type { Entity, Layer, Project } from '../../types';
import { createEmptyProject } from '../../state/store';
import { generateCrossSection } from '../../views';
import { migrateProject } from '../persist';
import { exportProjectJSON, importProjectJSON } from '../project';

// A project as it was saved before generated views and imports were mapped to
// real layers: the entities sit on the sheet with a layer name as their layerId.
function savedWith(build: (project: Project) => Entity[]): Project {
  const project = createEmptyProject();
  const entities = build(project);
  const sheet = project.sheets[project.activeSheetId];
  project.sheets = {
    ...project.sheets,
    [sheet.id]: {
      ...sheet,
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      entityOrder: entities.map((e) => e.id),
    },
  };
  return project;
}

const line = (id: string, layerId: string): Entity => ({
  id, kind: 'line', layerId, visible: true, locked: false, a: { x: 0, y: 0 }, b: { x: 1, y: 1 },
});

const layerNamed = (project: Project, name: string): Layer | undefined =>
  project.layerOrder.map((id) => project.layers[id]).find((layer) => layer.name === name);

const entitiesOf = (project: Project): Entity[] => Object.values(project.sheets[project.activeSheetId].entities);

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
}

describe('layer names saved as layer ids', () => {
  it('moves a saved generated view onto the layers with those names', () => {
    const saved = savedWith((project) => generateCrossSection({
      project, sheetId: project.activeSheetId, cutA: { x: 0, y: 0 }, cutB: { x: 1000, y: 0 }, viewName: 'A-A',
    }));
    const generated = entitiesOf(saved);
    expect(generated.every((e) => saved.layers[e.layerId] === undefined)).toBe(true);
    const before = structuredClone(saved);
    freezeDeep(saved);

    const migrated = migrateProject(saved);

    const restored = entitiesOf(migrated);
    expect(restored).toHaveLength(generated.length);
    for (const e of restored) expect(migrated.layers[e.layerId]).toBeDefined();
    expect(restored.find((e) => e.kind === 'dimension')?.layerId).toBe(layerNamed(migrated, 'Dimensions')?.id);
    expect(restored.find((e) => e.kind === 'text')?.layerId).toBe(layerNamed(migrated, 'Annotation')?.id);
    // Every name already had a layer, so none is added, and the saved copy is untouched.
    expect(migrated.layers).toBe(saved.layers);
    expect(migrated.layerOrder).toBe(saved.layerOrder);
    expect(saved).toEqual(before);
  });

  it('recreates a standard layer the project no longer has, and the Underlay layer for old imports', () => {
    const saved = savedWith((project) => {
      const dimensions = layerNamed(project, 'Dimensions')!;
      delete project.layers[dimensions.id];
      project.layerOrder = project.layerOrder.filter((id) => id !== dimensions.id);
      return [line('dim', 'Dimensions'), line('dxf', 'underlay'), line('ifc-wall', 'underlay')];
    });
    freezeDeep(saved);

    const migrated = migrateProject(saved);

    const { entities } = migrated.sheets[migrated.activeSheetId];
    expect(layerNamed(migrated, 'Dimensions')).toMatchObject({ color: '#5cdcff', lineWidth: 0.3, visible: true });
    expect(entities.dim.layerId).toBe(layerNamed(migrated, 'Dimensions')?.id);
    expect(layerNamed(migrated, 'Underlay')).toMatchObject({ visible: true, locked: false });
    expect(entities.dxf.layerId).toBe(layerNamed(migrated, 'Underlay')?.id);
    expect(entities['ifc-wall'].layerId).toBe(entities.dxf.layerId);
    expect(migrated.layerOrder).toHaveLength(saved.layerOrder.length + 2);
    expect(layerNamed(saved, 'Underlay')).toBeUndefined();
  });

  it('leaves real layer ids and the ids of deleted layers alone', () => {
    const saved = savedWith((project) => [line('real', project.activeLayerId), line('gone', 'k3J9xQ0aZt')]);
    freezeDeep(saved);

    const migrated = migrateProject(saved);

    expect(migrated.sheets[saved.activeSheetId]).toBe(saved.sheets[saved.activeSheetId]);
    expect(migrated.layers).toBe(saved.layers);
    expect(migrated.layerOrder).toBe(saved.layerOrder);
  });

  it('repairs a project file on open and keeps it repaired after a second save and open', () => {
    const saved = savedWith(() => [line('note', 'Annotation'), line('dxf', 'underlay')]);

    const opened = importProjectJSON(exportProjectJSON(saved));
    const reopened = importProjectJSON(exportProjectJSON(opened));

    for (const project of [opened, reopened]) {
      for (const e of entitiesOf(project)) expect(project.layers[e.layerId]).toBeDefined();
    }
    expect(reopened.layerOrder).toEqual(opened.layerOrder);
    expect(reopened.sheets[reopened.activeSheetId].entities).toEqual(opened.sheets[opened.activeSheetId].entities);
  });
});
