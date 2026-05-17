import { describe, expect, it } from 'vitest';
import { createWholeSiteSampleProject } from '../sample-whole-site';
import type { ContainmentEntity, Project, Sheet } from '../types';

const containmentsOn = (sheet: Sheet): ContainmentEntity[] => (
  sheet.entityOrder
    .map((id) => sheet.entities[id])
    .filter((entity): entity is ContainmentEntity => entity?.kind === 'containment')
);

const containmentsById = (project: Project): Map<string, ContainmentEntity> => {
  const out = new Map<string, ContainmentEntity>();
  for (const sheet of Object.values(project.sheets)) {
    for (const containment of containmentsOn(sheet)) out.set(containment.id, containment);
  }
  return out;
};

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

  it('models inter-building duct banks instead of leaving plant feeds as manual routes', () => {
    const project = createWholeSiteSampleProject();
    const containments = containmentsById(project);
    const labels = new Set([...containments.values()].map((c) => c.label));

    expect(labels.has('Site LV duct bank — Office to Plant')).toBe(true);
    expect(labels.has('Plant LV duct entry sleeve')).toBe(true);
    expect(labels.has('Site data duct bank — Office to Plant')).toBe(true);
    expect(labels.has('Plant data duct entry sleeve')).toBe(true);

    const plantFeed = Object.values(project.cableSchedule?.cables ?? {})
      .find((cable) => cable.reference === 'PW-MCC-DB2A-003');
    expect(plantFeed?.notes ?? '').not.toContain('crosses building');

    const routeLabels = (plantFeed?.route ?? [])
      .map((id) => containments.get(id)?.label)
      .filter(Boolean);
    expect(routeLabels).toContain('Site LV duct bank — Office to Plant');
    expect(routeLabels).toContain('Plant LV duct entry sleeve');
  });

  it('keeps plant duct entry sleeves off the same centreline as internal trunking', () => {
    const project = createWholeSiteSampleProject();
    const containments = [...containmentsById(project).values()];
    const plantLvEntry = containments.find((c) => c.label === 'Plant LV duct entry sleeve');
    const plantDataEntry = containments.find((c) => c.label === 'Plant data duct entry sleeve');
    const plantFaEntry = containments.find((c) => c.label === 'Plant fire alarm duct entry sleeve');

    expect(plantLvEntry?.points.map((p) => p.y)).toEqual([9000, 8600, 8600, 9000]);
    expect(plantDataEntry?.points.map((p) => p.y)).toEqual([9300, 9650, 9650, 9300]);
    expect(plantFaEntry?.points.map((p) => p.y)).toEqual([8800, 8500, 8500, 8800]);
  });
});
