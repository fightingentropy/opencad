import { createEmptyProject, newEntityId } from './state/store';
import type { ContainmentEntity, Project, Sheet, Vec2 } from './types';

const SILVER = '#bcc1c8';

// Each route has a 3 m straight and a 1.5 m return. Separate bands leave
// at least 675 mm between their outside envelopes, including the bends.
const routePoints = (y: number): Vec2[] => [
  { x: 1000, y },
  { x: 4000, y },
  { x: 4000, y: y + 1500 },
];

/** A small containment study; the hierarchy supplies a single 3D workplane. */
export const createContainmentSampleProject = (): Project => {
  const project = createEmptyProject();
  const layerId = newEntityId();
  const sheetId = newEntityId();
  const siteId = newEntityId();
  const buildingId = newEntityId();
  const floorId = newEntityId();

  const common = {
    kind: 'containment' as const,
    layerId,
    visible: true,
    locked: false,
    elevation: 0,
    color: SILVER,
  };

  // Manufacturer dimensions checked 2026-09-06. These are generic route
  // examples using those section sizes, not manufacturer fabrication models.
  const routes: ContainmentEntity[] = [
    {
      ...common,
      id: newEntityId(),
      containmentType: 'tray',
      subType: 'perforated',
      label: 'Perforated tray — 300 × 50 mm',
      width: 300,
      height: 50,
      material: 'pre-galvanised-steel',
      finish: 'pre-galv',
      points: routePoints(1000),
      // Legrand Swifts SRFL300PG: 300 W × 50 H × 3000 L mm.
      // https://www.legrand.co.uk/en/catalog/tray-lengths-1
    },
    {
      ...common,
      id: newEntityId(),
      containmentType: 'trunking',
      subType: 'standard',
      label: 'Steel trunking — 150 × 150 mm',
      width: 150,
      height: 150,
      compartments: 1,
      material: 'pre-galvanised-steel',
      finish: 'pre-galv',
      points: routePoints(3400),
      // Legrand Salamandre MGR66: 150 W × 150 H × 3000 L mm.
      // Supplied with a lid; the containment viewer displays it open.
      // https://www.legrand.co.uk/en/catalog/products/salamandre-1-compartment-pre-galvanised-steel-distribution-trunking-150mm-x-150mm-x-3m-length-mgr66
    },
    {
      ...common,
      id: newEntityId(),
      containmentType: 'basket',
      subType: 'wire-mesh',
      label: 'Wire basket — 300 × 54 mm',
      width: 300,
      height: 54,
      material: 'hot-dip-galvanised',
      finish: 'hot-dip-galv',
      points: routePoints(5800),
      // Legrand Cablofil CM000103: 300 W × 54 H × 3000 L mm.
      // https://www.legrand.co.uk/en/catalog/products/cablofil-hot-dip-galvanised-steel-wire-cable-tray-300mm-x-54mm-x-3m-length-cm000103
    },
  ];

  const sheet: Sheet = {
    id: sheetId,
    name: 'Containment layout',
    number: '001',
    kind: 'floor-plan',
    sceneStyle: 'containment',
    width: 5000,
    height: 8200,
    background: '#0a0e14',
    floorId,
    buildingId,
    entities: Object.fromEntries(routes.map((route) => [route.id, route])),
    entityOrder: routes.map((route) => route.id),
  };

  project.name = 'Containment study';
  project.description = 'Three galvanized steel routes: perforated tray, trunking and wire basket.';
  project.units = 'mm';
  project.standard = 'IEC';
  project.layers = {
    [layerId]: { id: layerId, name: 'Containment', color: SILVER, visible: true, locked: false, lineWidth: 0.6 },
  };
  project.layerOrder = [layerId];
  project.activeLayerId = layerId;
  project.sheets = { [sheetId]: sheet };
  project.sheetOrder = [sheetId];
  project.activeSheetId = sheetId;
  project.sites = { [siteId]: { id: siteId, name: 'Containment study', buildingOrder: [buildingId] } };
  project.buildings = {
    [buildingId]: { id: buildingId, siteId, name: 'Layout', floorOrder: [floorId] },
  };
  project.floors = {
    [floorId]: {
      id: floorId,
      buildingId,
      name: 'Workplane',
      level: 0,
      ffl: 0,
      floorHeight: 3000,
      zoneOrder: [],
      sheetIds: [sheetId],
    },
  };
  project.activeSiteId = siteId;
  project.activeBuildingId = buildingId;
  project.activeFloorId = floorId;
  return project;
};
