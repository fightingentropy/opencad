import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ContainmentEntity, Project, Sheet } from '../../types';
import {
  containmentMeasurement,
  containmentRouteLength,
  floorForContainment,
  formatMm,
  formatSignedMm,
  horizontalClearanceMm,
  verticalClearanceMm,
} from '../measurements';

const containment: ContainmentEntity = {
  id: 'tray-1',
  kind: 'containment',
  layerId: 'containment-layer',
  visible: true,
  locked: false,
  containmentType: 'tray',
  points: [
    { x: 0, y: 0 },
    { x: 3000, y: 4000 },
  ],
  width: 300,
  height: 75,
  elevation: 2400,
  label: 'Main tray',
  systemId: 'system-1',
  cableCategory: 'power',
};

const sheet: Sheet = {
  id: 'sheet-1',
  name: 'Floor Plan',
  number: 'A-100',
  kind: 'floor-plan',
  width: 10000,
  height: 10000,
  entities: { [containment.id]: containment },
  entityOrder: [containment.id],
  floorId: 'floor-1',
  buildingId: 'building-1',
};

const project: Project = {
  id: 'project-1',
  name: 'Measurements',
  created: 0,
  modified: 0,
  layers: {},
  layerOrder: [],
  sheets: { [sheet.id]: sheet },
  sheetOrder: [sheet.id],
  activeSheetId: sheet.id,
  activeLayerId: 'containment-layer',
  units: 'mm',
  standard: 'IEC',
  floors: {
    'floor-1': {
      id: 'floor-1',
      buildingId: 'building-1',
      name: 'Ground',
      level: 0,
      ffl: 3500,
      floorHeight: 3500,
      zoneOrder: [],
      sheetIds: [sheet.id],
    },
  },
  systems: {
    'system-1': {
      id: 'system-1',
      name: 'Power',
      kind: 'power-distribution',
      color: '#b85f00',
    },
  },
};

describe('3D measurement helpers', () => {
  it('formats metric lengths consistently', () => {
    expect(formatMm(1249.6)).toBe('1,250 mm');
    expect(formatSignedMm(0)).toBe('±0 mm');
    expect(formatSignedMm(2400)).toBe('+2,400 mm');
    expect(formatSignedMm(-150)).toBe('-150 mm');
  });

  it('reports containment size, elevation from FFL, and route length', () => {
    const floor = floorForContainment(project, containment.id);
    const measurement = containmentMeasurement(project, containment, floor);

    expect(measurement.title).toBe('Main tray');
    expect(measurement.rows).toContainEqual({ label: 'Size', value: '300 × 75 mm' });
    expect(measurement.rows).toContainEqual({ label: 'Bottom from FFL', value: '+2,400 mm FFL' });
    expect(measurement.rows).toContainEqual({ label: 'Top from FFL', value: '+2,475 mm FFL' });
    expect(measurement.rows).toContainEqual({ label: 'Route length', value: '5,000 mm' });
    expect(measurement.rows).toContainEqual({ label: 'Floor datum', value: '+3,500 mm site datum' });
    expect(measurement.rows).toContainEqual({ label: 'System', value: 'Power' });
    expect(containmentRouteLength(containment)).toBe(5000);
  });

  it('calculates real face-to-face clearances from rendered boxes', () => {
    const left = new THREE.Box3(
      new THREE.Vector3(0, 0, 2400),
      new THREE.Vector3(3000, 300, 2475),
    );
    const right = new THREE.Box3(
      new THREE.Vector3(0, 550, 2400),
      new THREE.Vector3(3000, 850, 2475),
    );
    const below = new THREE.Box3(
      new THREE.Vector3(0, 0, 2100),
      new THREE.Vector3(3000, 300, 2300),
    );

    expect(horizontalClearanceMm(left, right)).toBe(250);
    expect(verticalClearanceMm(left, right)).toBe(0);
    expect(verticalClearanceMm(left, below)).toBe(100);
  });
});
