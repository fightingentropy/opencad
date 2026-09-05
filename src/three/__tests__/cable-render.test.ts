import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderCablesInContainment } from '../CableInTray3D';
import { roundedRoute } from '../ContainmentGeometry';
import type { Cable } from '../../models/cable';
import type { ContainmentEntity } from '../../types';

const route = (overrides: Partial<ContainmentEntity> = {}): ContainmentEntity => ({
  id: 'tray', kind: 'containment', layerId: 'routes', visible: true, locked: false,
  containmentType: 'tray', width: 300, height: 100, elevation: 2400,
  points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }],
  ...overrides,
});
const cable = (id: string, outerDiameter = 20): Cable => ({
  id, reference: `C-${id}`, from: 'DB1', to: 'Plant', circuitType: 'power',
  construction: 'XLPE/SWA/PVC', cores: 3, csa: 4, hasEarth: true,
  voltage: 400, outerDiameter, route: ['tray'],
});

describe('roundedRoute', () => {
  it('offsets the endpoints using the actual first and last heading', () => {
    const vertical = roundedRoute([{ x: 0, y: 0 }, { x: 0, y: 1000 }], 10, 50, undefined, 20)!;
    expect(vertical.getPointAt(0).toArray()).toEqual([-20, 0, 10]);
    expect(vertical.getPointAt(1).toArray()).toEqual([-20, 1000, 10]);
    const west = roundedRoute([{ x: 1000, y: 0 }, { x: 0, y: 0 }], 10, 50, undefined, 20)!;
    expect(west.getPointAt(0).toArray()).toEqual([1000, -20, 10]);
    expect(west.getPointAt(1).toArray()).toEqual([0, -20, 10]);
  });

  it('handles headings straddling minus/plus pi without flipping the bundle', () => {
    const curve = roundedRoute([{ x: 1000, y: 10 }, { x: 0, y: 0 }, { x: -1000, y: 10 }], 20, 50, undefined, 25)!;
    const middle = curve.getPointAt(0.5);
    expect(middle.y).toBeLessThan(-24);
    expect(Math.abs(middle.x)).toBeLessThan(1);
  });

  it('rounds bends without overshooting the route or changing the elevation', () => {
    const curve = roundedRoute([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], 2415, 200)!;
    expect(curve.curves.some((part) => part instanceof THREE.QuadraticBezierCurve3)).toBe(true);
    for (const point of curve.getSpacedPoints(100)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1000);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1000);
      expect(point.z).toBeCloseTo(2415, 9);
    }
  });

  it('deduplicates route vertices and flips the actual geometry before offsetting', () => {
    const curve = roundedRoute([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1000 }], 10, 100, 2000, 20)!;
    expect(curve.getPointAt(0).toArray()).toEqual([20, 2000, 10]);
    expect(curve.getPointAt(1).toArray()).toEqual([20, 1000, 10]);
  });
});

describe('renderCablesInContainment', () => {
  it('renders real cable IDs with finite geometry, capped ends and shared run tie geometry', () => {
    const obj = renderCablesInContainment(route(), [cable('1'), cable('2')]);
    expect(obj.userData.renderedCableCount).toBe(2);
    expect(obj.userData.omittedCableCount).toBe(0);
    expect(obj.getObjectByName('cable-retaining-bands')).toBeInstanceOf(THREE.InstancedMesh);
    const ids = new Set<string>();
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        expect(child.userData.entityId).toBe('tray');
        const positions = child.geometry.getAttribute('position');
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        if (child.name === 'cable-jacket') ids.add(child.userData.cableId);
      }
    });
    expect(ids).toEqual(new Set(['1', '2']));
    expect(obj.getObjectByName('cable:C-1')?.children.filter((child) => child.name === 'cable-cut-end')).toHaveLength(2);
  });

  it('seats cable jackets above the ladder bearing faces', () => {
    const obj = renderCablesInContainment(route({ containmentType: 'ladder', points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] }), [cable('1')], { showCleats: false });
    obj.updateMatrixWorld(true);
    const jacket = obj.getObjectByName('cable-jacket')!;
    const bounds = new THREE.Box3().setFromObject(jacket);
    expect(bounds.min.z).toBeGreaterThanOrEqual(2420.9);
    expect(bounds.max.z).toBeLessThan(2450);
  });

  it('omits overflowing cables instead of drawing them through the walls', () => {
    const obj = renderCablesInContainment(route({ width: 30, height: 30 }), [cable('1'), cable('2'), cable('3', 80)], { showCleats: false });
    expect(obj.userData.renderedCableCount).toBe(1);
    expect(obj.userData.omittedCableCount).toBe(2);
    expect(obj.userData.crossSectionOverflow).toBe(true);
  });

  it('packs multi-compartment trunking without intersecting divider walls', () => {
    const obj = renderCablesInContainment(route({ containmentType: 'trunking', width: 100, height: 50, compartments: 2, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }), Array.from({ length: 5 }, (_, i) => cable(String(i), 18)), { showCleats: false });
    obj.updateMatrixWorld(true);
    expect(obj.userData.renderedCableCount).toBe(5);
    obj.traverse((child) => {
      if (child.name !== 'cable-jacket') return;
      const bounds = new THREE.Box3().setFromObject(child);
      expect(bounds.max.y < -0.75 || bounds.min.y > 0.75).toBe(true);
    });
  });

  it('keeps conduit cable cross-sections inside its circular wall', () => {
    const obj = renderCablesInContainment(route({ containmentType: 'conduit', width: 50, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }), Array.from({ length: 10 }, (_, i) => cable(String(i), 8)), { showCleats: false });
    obj.updateMatrixWorld(true);
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name === 'cable-jacket') {
        const positions = child.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          expect(Math.hypot(positions.getY(i), positions.getZ(i) - 2425)).toBeLessThanOrEqual(22.51);
        }
      }
    });
    expect(obj.userData.renderedCableCount).toBeGreaterThan(0);
  });

  it('allows a bounded overview without retention detail and reports the visibility limit', () => {
    const obj = renderCablesInContainment(route(), [cable('1'), cable('2'), cable('3')], { maxCables: 1, detail: 'overview' });
    expect(obj.userData.renderedCableCount).toBe(1);
    expect(obj.userData.omittedCableCount).toBe(2);
    expect(obj.getObjectByName('cable-retaining-bands')).toBeUndefined();
    expect(renderCablesInContainment(route(), [cable('1')], { maxCables: 0 }).children).toHaveLength(0);
  });
});
