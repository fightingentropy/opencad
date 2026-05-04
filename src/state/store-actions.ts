// Selector hooks layered on top of the Zustand store.
//
// Why a companion module? `store.ts` keeps the core CRUD surface focused
// on entities / sheets / layers. Whole-site projects introduce a wider
// data graph (sites, buildings, floors, zones, systems, cable schedule,
// standards profile) and the UI panels need ergonomic, memo-friendly
// accessors for that graph without bloating the main store.
//
// All hooks here are thin selectors that read from `useStore` and return
// either the underlying object reference or `null`. Memoization is
// handled by Zustand's reference-equality semantics — selectors return
// the same object reference across renders unless the underlying slice
// changes, so React.memo / useMemo upstream get cheap re-renders.

import { useStore } from './store';
import { DEFAULT_STANDARDS } from '../models/standards';
import { emptyCableSchedule } from '../models/cable';
import type { CableSchedule } from '../models/cable';
import type { StandardsProfile } from '../models/standards';
import type {
  Site,
  Building,
  Floor,
  ElectricalSystem,
  SystemId,
  FloorId,
} from '../models/site';
import type { Sheet } from '../types';

// Keep a single empty schedule reference so consumers never see a fresh
// object every render — that would defeat memoization upstream.
const EMPTY_CABLE_SCHEDULE: CableSchedule = emptyCableSchedule();

export const useCableSchedule = (): CableSchedule =>
  useStore((s) => s.project.cableSchedule ?? EMPTY_CABLE_SCHEDULE);

export const useSites = (): Record<string, Site> =>
  useStore((s) => s.project.sites ?? {});

export const useBuildings = (): Record<string, Building> =>
  useStore((s) => s.project.buildings ?? {});

export const useFloors = (): Record<string, Floor> =>
  useStore((s) => s.project.floors ?? {});

export const useStandardsProfile = (): StandardsProfile =>
  useStore((s) => s.project.standardsProfile ?? DEFAULT_STANDARDS.BS7671);

export const useSystems = (): Record<SystemId, ElectricalSystem> =>
  useStore((s) => s.project.systems ?? {});

export const useSystem = (systemId: SystemId | undefined): ElectricalSystem | null =>
  useStore((s) => {
    if (!systemId) return null;
    return s.project.systems?.[systemId] ?? null;
  });

export const useActiveFloor = (): Floor | null =>
  useStore((s) => {
    const id = s.project.activeFloorId;
    if (!id) return null;
    return s.project.floors?.[id] ?? null;
  });

export const useActiveBuilding = (): Building | null =>
  useStore((s) => {
    const id = s.project.activeBuildingId;
    if (!id) return null;
    return s.project.buildings?.[id] ?? null;
  });

export const useActiveSite = (): Site | null =>
  useStore((s) => {
    const id = s.project.activeSiteId;
    if (!id) return null;
    return s.project.sites?.[id] ?? null;
  });

// Sheets assigned to a floor. Returns the actual Sheet objects in the
// floor's declared order; ignores any sheet IDs that have since been
// deleted from the project (the floor metadata can lag behind).
export const useFloorSheets = (floorId: FloorId | undefined): Sheet[] =>
  useStore((s) => {
    if (!floorId) return [];
    const floor = s.project.floors?.[floorId];
    if (!floor) return [];
    const out: Sheet[] = [];
    for (const sid of floor.sheetIds) {
      const sheet = s.project.sheets[sid];
      if (sheet) out.push(sheet);
    }
    return out;
  });

// Convenience: list of cables in cableOrder (pre-resolved). UI tables
// almost always want the array form.
export const useCableList = () =>
  useStore((s) => {
    const sched = s.project.cableSchedule;
    if (!sched) return [];
    return sched.cableOrder.map((id) => sched.cables[id]).filter(Boolean);
  });

// Project-level metadata bundle — used by the title block. Keep it as
// a single selector so the component re-renders only on project metadata
// edits (not on every entity change).
export const useProjectMeta = () =>
  useStore((s) => ({
    name: s.project.name,
    client: s.project.client,
    engineer: s.project.engineer,
    projectNumber: s.project.projectNumber,
    originatorCode: s.project.originatorCode,
    standard: s.project.standard,
  }));
