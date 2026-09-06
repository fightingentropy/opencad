import { describe, expect, it } from 'vitest';
import type { CatalogueProduct } from '../../models/catalogue';
import { SYMBOL_LIST } from '../../symbols/library';
import type { Project } from '../../types';
import { createComponentEntity, getInsertableComponents } from '../component-library';

const project = (): Project => ({
  id: 'project', name: 'Components', created: 0, modified: 0,
  units: 'mm', standard: 'IEC', activeSheetId: 'sheet', activeLayerId: 'symbols',
  layers: {
    symbols: { id: 'symbols', name: 'Symbols', color: '#fff', visible: true, locked: false, lineWidth: 1 },
    containment: { id: 'containment', name: 'Containment', color: '#f00', visible: true, locked: false, lineWidth: 1 },
  },
  layerOrder: ['symbols', 'containment'], sheetOrder: ['sheet'],
  sheets: { sheet: { id: 'sheet', name: 'Layout', number: '1', kind: 'floor-plan', sceneStyle: 'containment', width: 10000, height: 10000, entities: {}, entityOrder: [] } },
});

const tray: CatalogueProduct = {
  id: 'tray', manufacturer: 'Example', partNumber: 'TR-300-PG',
  description: 'Perforated steel tray', category: 'cable-tray', subType: 'perforated',
  width: 300, height: 50, stockLength: 3000, material: 'pre-galvanised-steel', finish: 'pre-galv',
};

function withProducts(products: CatalogueProduct[]): Project {
  return { ...project(), catalogues: { custom: {
    id: 'custom', name: 'Project products',
    products: Object.fromEntries(products.map((product) => [product.id, product])),
    productOrder: products.map((product) => product.id),
  } } };
}

describe('insertable component library', () => {
  it('includes all schematic symbols and common containment in serializable, uniquely identified entries', () => {
    const components = getInsertableComponents(project());
    expect(new Set(components.map((component) => component.id)).size).toBe(components.length);
    expect(JSON.parse(JSON.stringify(components))).toEqual(components);
    expect(components.filter((component) => component.kind === 'symbol').map((component) => component.id).sort())
      .toEqual(SYMBOL_LIST.map((symbol) => `symbol:${symbol.id}`).sort());
    expect(new Set(components.filter((component) => component.kind === 'containment').map((component) => component.containmentType)))
      .toEqual(new Set(['tray', 'trunking', 'basket', 'conduit', 'ladder', 'duct', 'busbar']));
    expect(components.some((component) => component.id === 'equipment:distribution-board')).toBe(true);
    expect(components.some((component) => component.id === 'support:trapeze-hanger')).toBe(true);
  });

  it('creates only one independent entity per component and never mutates the project or descriptor', () => {
    const current = project();
    const original = structuredClone(current);
    for (const component of getInsertableComponents(current)) {
      const descriptor = structuredClone(component);
      const point = { x: 4500, y: 3000 };
      const entity = createComponentEntity(component, point, current);
      const another = createComponentEntity(component, point, current);
      expect(entity.id).not.toBe(another.id);
      expect(entity).toMatchObject({ kind: component.kind, visible: true, locked: false });
      expect(current.layers[entity.layerId]).toMatchObject({ visible: true, locked: false });
      if (entity.kind === 'containment') {
        expect(entity.color).toBe('#bcc1c8');
        expect(entity.elevation).toBe(0);
        expect(entity.points.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
      }
      if (entity.kind === 'symbol' || entity.kind === 'support') {
        expect(entity.position).toEqual(point);
        expect(entity.position).not.toBe(point);
      }
      expect(component).toEqual(descriptor);
    }
    expect(current).toEqual(original);
  });

  it('retains catalogue identity, actual stock dimensions and conduit cross-section when placed', () => {
    const current = withProducts([tray, {
      id: 'pipe', manufacturer: 'Example', partNumber: 'C25', description: 'Steel conduit',
      category: 'conduit', diameter: 25, innerDiameter: 21.8, stockLength: 3750,
      subType: 'rigid-steel', material: 'galvanised-steel',
    }]);
    const components = getInsertableComponents(current).filter((component) => component.id.startsWith('catalogue:'));
    expect(components).toHaveLength(2);
    const trayEntry = components.find((component) => component.identifiers?.includes('TR-300-PG'))!;
    expect(trayEntry.keywords).toContain('TR-300-PG');
    const placedTray = createComponentEntity(trayEntry, { x: 5000, y: 200 }, current);
    expect(placedTray).toMatchObject({
      kind: 'containment', containmentType: 'tray', width: 300, height: 50,
      manufacturer: 'Example', catalogPartNumber: 'TR-300-PG', catalogProductId: 'tray',
      subType: 'perforated', material: 'pre-galvanised-steel', finish: 'pre-galv',
      points: [{ x: 3500, y: 200 }, { x: 6500, y: 200 }],
    });
    const pipeEntry = components.find((component) => component.identifiers?.includes('C25'))!;
    const pipe = createComponentEntity(pipeEntry, { x: 0, y: 0 }, current);
    expect(pipe).toMatchObject({
      kind: 'containment', containmentType: 'conduit', width: 25,
      points: [{ x: -1875, y: 0 }, { x: 1875, y: 0 }],
    });
    expect(pipe.kind === 'containment' && pipe.innerCsaMm2).toBeCloseTo(Math.PI * (21.8 / 2) ** 2);
    expect(pipe).not.toHaveProperty('height');
  });

  it('does not invent insertable geometry for hardware, cable or incomplete catalogue stock', () => {
    const current = withProducts([
      { ...tray, id: 'bolt', category: 'fixing' },
      { ...tray, id: 'cable', category: 'cable' },
      { ...tray, id: 'board', category: 'distribution-board' },
      { ...tray, id: 'missing-height', height: undefined },
      { ...tray, id: 'zero-width', width: 0 },
      { ...tray, id: 'invalid-length', stockLength: Infinity },
    ]);
    expect(getInsertableComponents(current).filter((component) => component.id.startsWith('catalogue:'))).toEqual([]);
  });

  it('uses an available unlocked layer and refuses placement when none exists', () => {
    const current = project();
    const component = getInsertableComponents(current).find((component) => component.containmentType === 'tray')!;
    current.layers.containment.locked = true;
    expect(createComponentEntity(component, { x: 0, y: 0 }, current).layerId).toBe('symbols');
    current.layers.symbols.visible = false;
    expect(() => createComponentEntity(component, { x: 0, y: 0 }, current)).toThrow('visible and unlocked');
  });

  it('allocates unique equipment tags across sheets without manufacturing electrical ratings', () => {
    const current = project();
    const component = getInsertableComponents(current).find((component) => component.id === 'equipment:distribution-board')!;
    const first = createComponentEntity(component, { x: 600, y: 225 }, current);
    current.sheets.other = { ...current.sheets.sheet, id: 'other', entities: { [first.id]: first }, entityOrder: [first.id] };
    const second = createComponentEntity(component, { x: 600, y: 225 }, current);
    expect(first).toMatchObject({ tag: 'DB-01', a: { x: 0, y: 0 }, b: { x: 1200, y: 450 } });
    expect(second).toMatchObject({ tag: 'DB-02' });
    expect(second).not.toHaveProperty('ratedCurrent');
    expect(second).not.toHaveProperty('ratedVoltage');
    expect(second).not.toHaveProperty('manufacturer');
  });

  it('keeps standard building elevation defaults and rejects invalid placement coordinates', () => {
    const current = project();
    current.sheets.sheet.sceneStyle = 'building';
    const component = getInsertableComponents(current).find((component) => component.containmentType === 'tray')!;
    expect(createComponentEntity(component, { x: 0, y: 0 }, current)).not.toHaveProperty('elevation');
    expect(() => createComponentEntity(component, { x: NaN, y: 0 }, current)).toThrow('valid placement position');
  });
});
