import { describe, expect, it } from 'vitest';
import { createWholeSiteSampleProject } from '../sample-whole-site';
import type { ContainmentEntity, Project, Sheet } from '../types';

const containmentsOn = (sheet: Sheet): ContainmentEntity[] => (
  sheet.entityOrder
    .map((id) => sheet.entities[id])
    .filter((entity): entity is ContainmentEntity => entity?.kind === 'containment')
);

const officeSheets = (project: Project): Sheet[] => (
  Object.values(project.sheets).filter((sheet) => sheet.name.startsWith('Office'))
);

describe('whole-site sample containment layout', () => {
  it('uses one grey main trunking spine with the lighting-side route as basket', () => {
    const project = createWholeSiteSampleProject();
    const offices = officeSheets(project);

    expect(offices.length).toBeGreaterThan(0);
    for (const sheet of offices) {
      const containments = containmentsOn(sheet);
      const mainTrunking = containments.find((c) => c.label === 'Main power trunking — 100×100');
      const lightingBasket = containments.find((c) => c.label === 'Lighting basket — 150×100');
      const oldLightingTrunking = containments.find((c) => c.label === 'Lighting feeder trunking — 150×100');

      expect(mainTrunking?.containmentType).toBe('trunking');
      expect(mainTrunking?.color).toBe('#bcc1c8');
      expect(lightingBasket?.containmentType).toBe('basket');
      expect(lightingBasket?.color).toBe('#bcc1c8');
      expect(oldLightingTrunking).toBeUndefined();
    }
  });
});
