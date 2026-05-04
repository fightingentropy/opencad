// Site / building / floor / zone / system actions.
//
// Same shape as cable-actions: pure helpers that take a Project and
// return a new Project, plus a `useSiteActions` hook for components.
// Sites/buildings/floors/zones are kept on the project as keyed records
// with explicit ordering arrays — adds append, removes splice and
// detach related children where helpful.

import { nanoid } from 'nanoid';
import type { Project } from '../types';
import type {
  Site,
  Building,
  Floor,
  Zone,
  ElectricalSystem,
  SiteId,
  BuildingId,
  FloorId,
  ZoneId,
  SystemId,
} from '../models/site';
import { useStore } from './store';

const newId = (): string => nanoid(10);

// ---------- Pure helpers --------------------------------------------------

const ensureRecord = <T>(rec: Record<string, T> | undefined): Record<string, T> =>
  rec ?? {};

export const addSite = (
  project: Project,
  init: Partial<Site> & Pick<Site, 'name'>,
): Project => {
  const id = init.id ?? newId();
  const site: Site = {
    id,
    name: init.name,
    description: init.description,
    address: init.address,
    latitude: init.latitude,
    longitude: init.longitude,
    supplyVoltage: init.supplyVoltage,
    frequency: init.frequency,
    earthingSystem: init.earthingSystem,
    buildingOrder: init.buildingOrder ?? [],
  };
  return {
    ...project,
    sites: { ...ensureRecord(project.sites), [id]: site },
    activeSiteId: project.activeSiteId ?? id,
    modified: Date.now(),
  };
};

export const addBuilding = (
  project: Project,
  siteId: SiteId,
  init: Partial<Building> & Pick<Building, 'name'>,
): Project => {
  const sites = ensureRecord(project.sites);
  const site = sites[siteId];
  if (!site) return project;
  const id = init.id ?? newId();
  const building: Building = {
    id,
    siteId,
    name: init.name,
    number: init.number,
    description: init.description,
    use: init.use,
    height: init.height,
    gridOriginX: init.gridOriginX,
    gridOriginY: init.gridOriginY,
    floorOrder: init.floorOrder ?? [],
  };
  return {
    ...project,
    sites: {
      ...sites,
      [siteId]: { ...site, buildingOrder: [...site.buildingOrder, id] },
    },
    buildings: { ...ensureRecord(project.buildings), [id]: building },
    activeBuildingId: project.activeBuildingId ?? id,
    modified: Date.now(),
  };
};

export const addFloor = (
  project: Project,
  buildingId: BuildingId,
  init: Partial<Floor> & Pick<Floor, 'name' | 'level' | 'ffl' | 'floorHeight'>,
): Project => {
  const buildings = ensureRecord(project.buildings);
  const building = buildings[buildingId];
  if (!building) return project;
  const id = init.id ?? newId();
  const floor: Floor = {
    id,
    buildingId,
    name: init.name,
    level: init.level,
    ffl: init.ffl,
    floorHeight: init.floorHeight,
    slabThickness: init.slabThickness,
    ceilingVoid: init.ceilingVoid,
    raisedFloor: init.raisedFloor,
    zoneOrder: init.zoneOrder ?? [],
    sheetIds: init.sheetIds ?? [],
  };
  return {
    ...project,
    buildings: {
      ...buildings,
      [buildingId]: { ...building, floorOrder: [...building.floorOrder, id] },
    },
    floors: { ...ensureRecord(project.floors), [id]: floor },
    activeFloorId: project.activeFloorId ?? id,
    modified: Date.now(),
  };
};

export const addZone = (
  project: Project,
  floorId: FloorId,
  init: Partial<Zone> & Pick<Zone, 'name' | 'classification'>,
): Project => {
  const floors = ensureRecord(project.floors);
  const floor = floors[floorId];
  if (!floor) return project;
  const id = init.id ?? newId();
  const zone: Zone = {
    id,
    floorId,
    name: init.name,
    classification: init.classification,
    ipRating: init.ipRating,
    fireRating: init.fireRating,
    uniclass: init.uniclass,
    hazardousZone: init.hazardousZone,
    bounds: init.bounds,
  };
  return {
    ...project,
    floors: {
      ...floors,
      [floorId]: { ...floor, zoneOrder: [...floor.zoneOrder, id] },
    },
    zones: { ...ensureRecord(project.zones), [id]: zone },
    modified: Date.now(),
  };
};

export const addSystem = (
  project: Project,
  init: Partial<ElectricalSystem> & Pick<ElectricalSystem, 'name' | 'kind' | 'color'>,
): Project => {
  const id = init.id ?? newId();
  const sys: ElectricalSystem = {
    id,
    name: init.name,
    kind: init.kind,
    color: init.color,
    band: init.band,
    description: init.description,
  };
  return {
    ...project,
    systems: { ...ensureRecord(project.systems), [id]: sys },
    modified: Date.now(),
  };
};

export const setActiveBuilding = (
  project: Project,
  id: BuildingId | undefined,
): Project => ({
  ...project,
  activeBuildingId: id,
  modified: Date.now(),
});

export const setActiveFloor = (
  project: Project,
  id: FloorId | undefined,
): Project => {
  // Activating a floor with sheets attached also activates its first sheet
  // — saves the user a click.
  const floor = id ? project.floors?.[id] : undefined;
  const firstSheetId = floor?.sheetIds.find((sid) => project.sheets[sid]);
  return {
    ...project,
    activeFloorId: id,
    activeBuildingId: floor?.buildingId ?? project.activeBuildingId,
    activeSheetId: firstSheetId ?? project.activeSheetId,
    modified: Date.now(),
  };
};

export const setActiveSite = (
  project: Project,
  id: SiteId | undefined,
): Project => ({
  ...project,
  activeSiteId: id,
  modified: Date.now(),
});

// ---------- Hook ---------------------------------------------------------

export interface SiteActions {
  addSite: (init: Partial<Site> & Pick<Site, 'name'>) => string | null;
  addBuilding: (siteId: SiteId, init: Partial<Building> & Pick<Building, 'name'>) => string | null;
  addFloor: (
    buildingId: BuildingId,
    init: Partial<Floor> & Pick<Floor, 'name' | 'level' | 'ffl' | 'floorHeight'>,
  ) => string | null;
  addZone: (
    floorId: FloorId,
    init: Partial<Zone> & Pick<Zone, 'name' | 'classification'>,
  ) => string | null;
  addSystem: (init: Partial<ElectricalSystem> & Pick<ElectricalSystem, 'name' | 'kind' | 'color'>) => SystemId | null;
  setActiveBuilding: (id: BuildingId | undefined) => void;
  setActiveFloor: (id: FloorId | undefined) => void;
  setActiveSite: (id: SiteId | undefined) => void;
  setActiveZone: (id: ZoneId | undefined) => void;
}

// Apply a project transform via the store, returning the assigned ID
// of the newly added record (when applicable). Returns null when the
// transform was a no-op (e.g. parent not found).
const applyAndExtractId = (
  fn: (p: Project) => Project,
  pickId: (p: Project) => string | undefined,
): string | null => {
  const before = useStore.getState().project;
  const after = fn(before);
  if (after === before) return null;
  useStore.getState().setProjectPatch(after);
  return pickId(after) ?? null;
};

export const useSiteActions = (): SiteActions => {
  return {
    addSite: (init) => applyAndExtractId(
      (p) => addSite(p, init),
      (p) => Object.keys(p.sites ?? {}).at(-1),
    ),
    addBuilding: (siteId, init) => applyAndExtractId(
      (p) => addBuilding(p, siteId, init),
      (p) => Object.keys(p.buildings ?? {}).at(-1),
    ),
    addFloor: (buildingId, init) => applyAndExtractId(
      (p) => addFloor(p, buildingId, init),
      (p) => Object.keys(p.floors ?? {}).at(-1),
    ),
    addZone: (floorId, init) => applyAndExtractId(
      (p) => addZone(p, floorId, init),
      (p) => Object.keys(p.zones ?? {}).at(-1),
    ),
    addSystem: (init) => applyAndExtractId(
      (p) => addSystem(p, init),
      (p) => Object.keys(p.systems ?? {}).at(-1),
    ),
    setActiveBuilding: (id) => {
      const p = useStore.getState().project;
      useStore.getState().setProjectPatch(setActiveBuilding(p, id));
    },
    setActiveFloor: (id) => {
      const p = useStore.getState().project;
      useStore.getState().setProjectPatch(setActiveFloor(p, id));
    },
    setActiveSite: (id) => {
      const p = useStore.getState().project;
      useStore.getState().setProjectPatch(setActiveSite(p, id));
    },
    setActiveZone: (_id) => {
      // Reserved for future expansion — zones don't have an explicit
      // active marker on Project today, but this keeps the API symmetric
      // for callers and lets us add the field without a breaking change.
    },
  };
};
