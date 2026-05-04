// Cable schedule actions — immutable Project transforms plus the
// `useCableActions` hook that wraps them onto the live store.
//
// The pure helpers (`addCable`, `updateCable`, ...) take a Project and
// return a new Project. They are used by the sample data factory and
// by tests. The hook wraps the store's mutation methods so React
// components can dispatch with one call.

import type { Project } from '../types';
import type { Cable, CableId, CableSchedule } from '../models/cable';
import type { EntityId } from '../types';
import { emptyCableSchedule } from '../models/cable';
import { useStore } from './store';

// ---------- Pure helpers --------------------------------------------------

const ensureSchedule = (project: Project): CableSchedule =>
  project.cableSchedule ?? emptyCableSchedule();

export const addCable = (project: Project, cable: Cable): Project => {
  const schedule = ensureSchedule(project);
  if (schedule.cables[cable.id]) return project; // no-op on duplicate
  return {
    ...project,
    cableSchedule: {
      cables: { ...schedule.cables, [cable.id]: cable },
      cableOrder: [...schedule.cableOrder, cable.id],
    },
    modified: Date.now(),
  };
};

export const updateCable = (
  project: Project,
  id: CableId,
  patch: Partial<Cable>,
): Project => {
  const schedule = project.cableSchedule;
  if (!schedule) return project;
  const existing = schedule.cables[id];
  if (!existing) return project;
  return {
    ...project,
    cableSchedule: {
      ...schedule,
      cables: { ...schedule.cables, [id]: { ...existing, ...patch } },
    },
    modified: Date.now(),
  };
};

export const removeCable = (project: Project, id: CableId): Project => {
  const schedule = project.cableSchedule;
  if (!schedule || !schedule.cables[id]) return project;
  const cables = { ...schedule.cables };
  delete cables[id];
  return {
    ...project,
    cableSchedule: {
      cables,
      cableOrder: schedule.cableOrder.filter((cid) => cid !== id),
    },
    modified: Date.now(),
  };
};

// Replace the cable's route with the supplied containment IDs and update
// the assignedCableIds on each containment entity it now passes through.
export const assignCableToContainment = (
  project: Project,
  cableId: CableId,
  containmentIds: EntityId[],
): Project => {
  const schedule = project.cableSchedule;
  if (!schedule) return project;
  const cable = schedule.cables[cableId];
  if (!cable) return project;

  // 1) Update the cable's route
  const nextSchedule: CableSchedule = {
    ...schedule,
    cables: {
      ...schedule.cables,
      [cableId]: { ...cable, route: [...containmentIds] },
    },
  };

  // 2) Update each affected containment entity's assignedCableIds. Because
  //    a containment can live on any sheet, we walk every sheet looking
  //    for entities with the given IDs.
  const previousIds = new Set(cable.route);
  const nextIds = new Set(containmentIds);
  const sheets = { ...project.sheets };
  let touched = false;

  for (const sheetId of project.sheetOrder) {
    const sheet = sheets[sheetId];
    if (!sheet) continue;
    let sheetChanged = false;
    const entities = { ...sheet.entities };

    // Remove cable from containments it no longer routes through
    for (const id of previousIds) {
      if (nextIds.has(id)) continue;
      const e = entities[id];
      if (!e || e.kind !== 'containment') continue;
      const current = e.assignedCableIds ?? [];
      if (!current.includes(cableId)) continue;
      entities[id] = {
        ...e,
        assignedCableIds: current.filter((cid) => cid !== cableId),
      };
      sheetChanged = true;
    }

    // Add cable to newly routed containments
    for (const id of nextIds) {
      const e = entities[id];
      if (!e || e.kind !== 'containment') continue;
      const current = e.assignedCableIds ?? [];
      if (current.includes(cableId)) continue;
      entities[id] = {
        ...e,
        assignedCableIds: [...current, cableId],
      };
      sheetChanged = true;
    }

    if (sheetChanged) {
      sheets[sheetId] = { ...sheet, entities };
      touched = true;
    }
  }

  return {
    ...project,
    cableSchedule: nextSchedule,
    sheets: touched ? sheets : project.sheets,
    modified: Date.now(),
  };
};

// Drop a single containment from the cable's route — the inverse of
// assigning a single new ID. Used by the route editor's "remove segment"
// button so the caller doesn't have to recompute the full route array.
export const unassignCableFromContainment = (
  project: Project,
  cableId: CableId,
  containmentId: EntityId,
): Project => {
  const schedule = project.cableSchedule;
  if (!schedule) return project;
  const cable = schedule.cables[cableId];
  if (!cable) return project;
  const nextRoute = cable.route.filter((id) => id !== containmentId);
  if (nextRoute.length === cable.route.length) return project;
  return assignCableToContainment(project, cableId, nextRoute);
};

// ---------- Hook ---------------------------------------------------------

export interface CableActions {
  add: (cable: Cable) => void;
  update: (id: CableId, patch: Partial<Cable>) => void;
  remove: (id: CableId) => void;
  assignToContainment: (id: CableId, containmentIds: EntityId[]) => void;
  unassignFromContainment: (id: CableId, containmentId: EntityId) => void;
}

export const useCableActions = (): CableActions => {
  const setProjectPatch = useStore((s) => s.setProjectPatch);
  const storeAdd = useStore((s) => s.addCable);
  const storeUpdate = useStore((s) => s.updateCable);
  const storeRemove = useStore((s) => s.removeCable);

  return {
    add: storeAdd,
    update: storeUpdate,
    remove: storeRemove,
    assignToContainment: (id, containmentIds) => {
      const project = useStore.getState().project;
      const next = assignCableToContainment(project, id, containmentIds);
      if (next === project) return;
      setProjectPatch({
        cableSchedule: next.cableSchedule,
        sheets: next.sheets,
      });
    },
    unassignFromContainment: (id, containmentId) => {
      const project = useStore.getState().project;
      const next = unassignCableFromContainment(project, id, containmentId);
      if (next === project) return;
      setProjectPatch({
        cableSchedule: next.cableSchedule,
        sheets: next.sheets,
      });
    },
  };
};
