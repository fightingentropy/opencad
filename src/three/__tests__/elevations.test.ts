import { describe, expect, it } from 'vitest';
import type { ContainmentEntity, ContainmentType } from '../../types';
import type { Floor } from '../../models/site';
import { defaultElevation } from '../elevations';

const floorWithCeilingVoid: Floor = {
  id: 'floor-1',
  buildingId: 'building-1',
  name: 'Ground',
  level: 0,
  ffl: 0,
  floorHeight: 3000,
  slabThickness: 250,
  ceilingVoid: 600,
  zoneOrder: [],
  sheetIds: [],
};

function containment(
  id: string,
  type: ContainmentType,
  width: number,
  height: number,
): ContainmentEntity {
  return {
    id,
    kind: 'containment',
    layerId: 'containment-layer',
    visible: true,
    locked: false,
    containmentType: type,
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ],
    width,
    height,
  };
}

describe('defaultElevation', () => {
  it('keeps high-level containment families in separate ceiling-void bands', () => {
    const ladder = containment('ladder', 'ladder', 600, 100);
    const trunking = containment('trunking', 'trunking', 100, 100);
    const basket = containment('basket', 'basket', 300, 100);
    const tray = containment('tray', 'tray', 300, 80);

    const ladderBottom = defaultElevation(ladder, floorWithCeilingVoid);
    const trunkingBottom = defaultElevation(trunking, floorWithCeilingVoid);
    const basketBottom = defaultElevation(basket, floorWithCeilingVoid);
    const trayBottom = defaultElevation(tray, floorWithCeilingVoid);

    expect(ladderBottom).toBeGreaterThan(trunkingBottom + (trunking.height ?? 0));
    expect(trunkingBottom).toBeGreaterThan(basketBottom + (basket.height ?? 0));
    expect(basketBottom).toBeGreaterThan(trayBottom + (tray.height ?? 0));
    expect(new Set([ladderBottom, trunkingBottom, basketBottom, trayBottom]).size).toBe(4);
  });
});
