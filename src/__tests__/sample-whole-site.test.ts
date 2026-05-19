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

const corporateSheets = (project: Project): Sheet[] => (
  Object.values(project.sheets).filter((sheet) => sheet.name.startsWith('Corporate HQ'))
);

const faceGap = (a: ContainmentEntity, b: ContainmentEntity): number => (
  Math.abs((a.points[0]?.y ?? 0) - (b.points[0]?.y ?? 0)) -
  ((a.width ?? 0) / 2 + (b.width ?? 0) / 2)
);

const compactSupportSpan = (containment: ContainmentEntity): number => (
  (containment.width ?? 0) + 120
);

const supportFaceGap = (
  a: ContainmentEntity,
  b: ContainmentEntity,
  bY = b.points[0]?.y ?? 0,
): number => (
  Math.abs((a.points[0]?.y ?? 0) - bY) -
  (compactSupportSpan(a) / 2 + compactSupportSpan(b) / 2)
);

describe('whole-site sample containment layout', () => {
  it('models a single five-level corporate office tower', () => {
    const project = createWholeSiteSampleProject();
    const buildings = Object.values(project.buildings ?? {});
    const building = buildings[0];
    const sheets = corporateSheets(project);

    expect(buildings).toHaveLength(1);
    expect(building?.name).toBe('Apex Corporate Headquarters');
    expect(building?.floorOrder).toHaveLength(5);
    expect(project.sites?.[project.activeSiteId!]?.buildingOrder).toEqual([building?.id]);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Corporate HQ — Ground Floor',
      'Corporate HQ — Level 1 Office',
      'Corporate HQ — Level 2 Office',
      'Corporate HQ — Level 3 Client Suite',
      'Corporate HQ — Roof Plant',
    ]);
  });

  it('uses coordinated service spines on every occupied floor', () => {
    const project = createWholeSiteSampleProject();
    const sheets = corporateSheets(project).filter((sheet) => !sheet.name.includes('Roof'));

    for (const sheet of sheets) {
      const containments = containmentsOn(sheet);
      const prefix = sheet.name.includes('Ground')
        ? 'Ground'
        : `Level ${sheet.name.match(/Level (\d)/)?.[1]}`;
      const power = containments.find((c) => c.label === `${prefix} power ${prefix === 'Ground' ? 'busbar — 800 A' : 'trunking — 300×150'}`);
      const lighting = containments.find((c) => c.label === `${prefix} lighting basket — 150×100`);
      const data = containments.find((c) => c.label === `${prefix} data basket — 300×100`);
      const fire = containments.find((c) => c.label === `${prefix} FP200 fire alarm conduit`);
      const security = containments.find((c) => c.label === `${prefix} security containment conduit`);
      const bms = containments.find((c) => c.label === `${prefix} BMS controls conduit`);

      expect(power?.containmentType).toBe(prefix === 'Ground' ? 'busbar' : 'trunking');
      expect(lighting?.containmentType).toBe('basket');
      expect(data?.containmentType).toBe('basket');
      expect(fire?.containmentType).toBe('conduit');
      expect(security?.containmentType).toBe('conduit');
      expect(bms?.containmentType).toBe('conduit');
      expect(lighting?.color).toBe('#bcc1c8');
      expect(data?.color).toBe('#bcc1c8');
    }
  });

  it('routes the corporate cable schedule through modelled containment', () => {
    const project = createWholeSiteSampleProject();
    const containments = containmentsById(project);
    const cables = Object.values(project.cableSchedule?.cables ?? {});
    const manual = cables
      .filter((cable) => cable.route.length === 0 || (cable.notes ?? '').includes('Manual routing required'))
      .map((cable) => cable.reference);

    expect(manual).toEqual([]);

    const roofFeed = cables.find((cable) => cable.reference === 'PW-MSB-DBRF-005');
    const roofRouteLabels = (roofFeed?.route ?? [])
      .map((id) => containments.get(id)?.label)
      .filter(Boolean);
    expect(roofRouteLabels.some((label) => label?.includes('Roof'))).toBe(true);
  });

  it('keeps parallel service lanes physically separated in the office corridor', () => {
    const project = createWholeSiteSampleProject();
    const level2 = corporateSheets(project).find((sheet) => sheet.name === 'Corporate HQ — Level 2 Office');
    expect(level2).toBeDefined();
    const containments = containmentsOn(level2!);
    const power = containments.find((c) => c.label === 'Level 2 power trunking — 300×150');
    const data = containments.find((c) => c.label === 'Level 2 data basket — 300×100');
    const lighting = containments.find((c) => c.label === 'Level 2 lighting basket — 150×100');
    const fire = containments.find((c) => c.label === 'Level 2 FP200 fire alarm conduit');
    const security = containments.find((c) => c.label === 'Level 2 security containment conduit');
    const bms = containments.find((c) => c.label === 'Level 2 BMS controls conduit');

    expect(power).toBeDefined();
    expect(data).toBeDefined();
    expect(lighting).toBeDefined();
    expect(fire).toBeDefined();
    expect(security).toBeDefined();
    expect(bms).toBeDefined();
    expect(faceGap(data!, power!)).toBeGreaterThanOrEqual(250);
    expect(faceGap(power!, lighting!)).toBeGreaterThanOrEqual(250);
    expect(faceGap(security!, fire!)).toBeGreaterThanOrEqual(250);
    expect(faceGap(lighting!, bms!)).toBeGreaterThanOrEqual(250);
    expect(supportFaceGap(data!, power!)).toBeGreaterThanOrEqual(100);
    expect(supportFaceGap(power!, lighting!)).toBeGreaterThanOrEqual(100);
  });
});
