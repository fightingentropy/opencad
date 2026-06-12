// Narrow zustand selectors shared by the UI.
//
// Subscribing to the whole `project` re-renders a component on every entity
// drag anywhere in the model. The hooks here subscribe to the smallest slice
// a panel actually reads. Every plain selector returns a stable reference for
// unchanged data — no `.map` / `.filter` / object literals outside the
// `useShallow`-wrapped selectors — so zustand's strict-equality check skips
// re-renders when the slice didn't change.
//
// The bare `select*` functions are exported alongside the hooks so the
// reference-stability contract can be unit-tested without rendering React.

import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store';
import type { Entity, EntityId, Project, Sheet } from '../types';

type StoreState = ReturnType<typeof useStore.getState>;

// ---------- Plain selectors (stable references) ----------

export const selectActiveSheet = (s: StoreState): Sheet =>
  s.project.sheets[s.project.activeSheetId];

export const selectActiveSheetId = (s: StoreState): Project['activeSheetId'] =>
  s.project.activeSheetId;

export const selectActiveLayerId = (s: StoreState): Project['activeLayerId'] =>
  s.project.activeLayerId;

export const selectSheets = (s: StoreState): Project['sheets'] => s.project.sheets;

export const selectSheetOrder = (s: StoreState): Project['sheetOrder'] =>
  s.project.sheetOrder;

export const selectLayers = (s: StoreState): Project['layers'] => s.project.layers;

export const selectLayerOrder = (s: StoreState): Project['layerOrder'] =>
  s.project.layerOrder;

export const selectCableSchedule = (s: StoreState): Project['cableSchedule'] =>
  s.project.cableSchedule;

export const selectStandardsProfile = (s: StoreState): Project['standardsProfile'] =>
  s.project.standardsProfile;

export const selectSystems = (s: StoreState): Project['systems'] => s.project.systems;

export const selectCatalogues = (s: StoreState): Project['catalogues'] =>
  s.project.catalogues;

export const selectPenetrationSeals = (s: StoreState): Project['penetrationSeals'] =>
  s.project.penetrationSeals;

export const selectSites = (s: StoreState): Project['sites'] => s.project.sites;

export const selectBuildings = (s: StoreState): Project['buildings'] =>
  s.project.buildings;

export const selectFloors = (s: StoreState): Project['floors'] => s.project.floors;

export const selectZones = (s: StoreState): Project['zones'] => s.project.zones;

export const selectActiveFloorId = (s: StoreState): Project['activeFloorId'] =>
  s.project.activeFloorId;

export const selectMarkups = (s: StoreState): Project['markups'] => s.project.markups;

export const selectItpItems = (s: StoreState): Project['itpItems'] =>
  s.project.itpItems;

export const selectProjectName = (s: StoreState): string => s.project.name;

export const selectSelection = (s: StoreState): Set<EntityId> => s.editor.selection;

// Single-selection helper: the one selected entity on the active sheet, or
// null for empty / multi selections. Returns the entity object straight out
// of the store, so the reference only changes when that entity changes.
export const selectSelectedEntity = (s: StoreState): Entity | null => {
  if (s.editor.selection.size !== 1) return null;
  const [only] = s.editor.selection;
  const sheet = s.project.sheets[s.project.activeSheetId];
  return sheet?.entities[only] ?? null;
};

// ---------- Shallow selectors (fresh container, stable members) ----------

// Title-block / status-bar metadata. Picked into a fresh object, so consumers
// must subscribe through `useShallow` (see useProjectMeta below).
export interface ProjectMeta {
  id: string;
  name: string;
  client: string | undefined;
  engineer: string | undefined;
  units: Project['units'];
  standard: Project['standard'];
}

export const selectProjectMeta = (s: StoreState): ProjectMeta => ({
  id: s.project.id,
  name: s.project.name,
  client: s.project.client,
  engineer: s.project.engineer,
  units: s.project.units,
  standard: s.project.standard,
});

// Sheets in tab order. Fresh array each call — subscribe via `useShallow` so
// it only counts as changed when a sheet object (or the order) changed.
export const selectSheetList = (s: StoreState): Sheet[] =>
  s.project.sheetOrder.map((id) => s.project.sheets[id]);

// ---------- Hooks ----------

/** Active sheet object — changes whenever its entities change. */
export const useActiveSheet = (): Sheet => useStore(selectActiveSheet);

export const useActiveSheetId = (): Project['activeSheetId'] =>
  useStore(selectActiveSheetId);

export const useActiveLayerId = (): Project['activeLayerId'] =>
  useStore(selectActiveLayerId);

/** Whole sheets map — for genuinely cross-sheet consumers (BOM, find, …). */
export const useSheets = (): Project['sheets'] => useStore(selectSheets);

export const useSheetOrder = (): Project['sheetOrder'] => useStore(selectSheetOrder);

export const useLayers = (): Project['layers'] => useStore(selectLayers);

export const useLayerOrder = (): Project['layerOrder'] => useStore(selectLayerOrder);

export const useCableSchedule = (): Project['cableSchedule'] =>
  useStore(selectCableSchedule);

export const useStandardsProfile = (): Project['standardsProfile'] =>
  useStore(selectStandardsProfile);

export const useSystems = (): Project['systems'] => useStore(selectSystems);

export const useCatalogues = (): Project['catalogues'] => useStore(selectCatalogues);

export const usePenetrationSeals = (): Project['penetrationSeals'] =>
  useStore(selectPenetrationSeals);

export const useSites = (): Project['sites'] => useStore(selectSites);

export const useBuildings = (): Project['buildings'] => useStore(selectBuildings);

export const useFloors = (): Project['floors'] => useStore(selectFloors);

export const useZones = (): Project['zones'] => useStore(selectZones);

export const useActiveFloorId = (): Project['activeFloorId'] =>
  useStore(selectActiveFloorId);

export const useMarkups = (): Project['markups'] => useStore(selectMarkups);

export const useItpItems = (): Project['itpItems'] => useStore(selectItpItems);

export const useProjectName = (): string => useStore(selectProjectName);

/** Project header fields (name, client, units, …) — shallow-compared. */
export const useProjectMeta = (): ProjectMeta => useStore(useShallow(selectProjectMeta));

/** Ordered sheet list for tabs — shallow-compared per element. */
export const useSheetList = (): Sheet[] => useStore(useShallow(selectSheetList));

/** Current selection Set — replaced wholesale by the store on change. */
export const useSelection = (): Set<EntityId> => useStore(selectSelection);

/** The single selected entity on the active sheet, or null. */
export const useSelectedEntity = (): Entity | null => useStore(selectSelectedEntity);
