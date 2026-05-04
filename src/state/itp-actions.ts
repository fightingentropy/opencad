// Inspection & Test Plan (ITP) actions. Each ITP item is a discrete
// QA / commissioning checklist row with a status, responsibility and
// (optionally) attached design entities and inspector signature.

import { nanoid } from 'nanoid';
import type { Project } from '../types';
import type { ITPItem } from '../models/fire';
import { useStore } from './store';

const newId = (): string => nanoid(10);

const ensureItp = (project: Project): Record<string, ITPItem> =>
  project.itpItems ?? {};

// ---------- Pure helpers --------------------------------------------------

export const addITPItem = (
  project: Project,
  init: Partial<ITPItem> &
    Pick<ITPItem, 'reference' | 'activity' | 'acceptanceCriteria' | 'controlPoint' | 'responsibility'>,
): Project => {
  const id = init.id ?? newId();
  const item: ITPItem = {
    id,
    reference: init.reference,
    activity: init.activity,
    acceptanceCriteria: init.acceptanceCriteria,
    controlPoint: init.controlPoint,
    responsibility: init.responsibility,
    status: init.status ?? 'pending',
    appliedTo: init.appliedTo,
    inspector: init.inspector,
    inspectedAt: init.inspectedAt,
    notes: init.notes,
    evidenceUrls: init.evidenceUrls,
  };
  return {
    ...project,
    itpItems: { ...ensureItp(project), [id]: item },
    modified: Date.now(),
  };
};

export const updateITPItem = (
  project: Project,
  id: string,
  patch: Partial<ITPItem>,
): Project => {
  const items = project.itpItems;
  if (!items || !items[id]) return project;
  return {
    ...project,
    itpItems: {
      ...items,
      [id]: { ...items[id], ...patch },
    },
    modified: Date.now(),
  };
};

// "Clear" an ITP — record an inspector pass and bump status. Distinct
// from delete: an ITP is rarely removed, instead it's marked cleared.
export const clearITPItem = (
  project: Project,
  id: string,
  inspector: string,
  notes?: string,
): Project => {
  const items = project.itpItems;
  if (!items || !items[id]) return project;
  return {
    ...project,
    itpItems: {
      ...items,
      [id]: {
        ...items[id],
        status: 'cleared',
        inspector,
        inspectedAt: Date.now(),
        notes: notes ?? items[id].notes,
      },
    },
    modified: Date.now(),
  };
};

export const removeITPItem = (project: Project, id: string): Project => {
  const items = project.itpItems;
  if (!items || !items[id]) return project;
  const next = { ...items };
  delete next[id];
  return { ...project, itpItems: next, modified: Date.now() };
};

// ---------- Hook ---------------------------------------------------------

export interface ItpActions {
  add: (
    init: Partial<ITPItem> &
      Pick<ITPItem, 'reference' | 'activity' | 'acceptanceCriteria' | 'controlPoint' | 'responsibility'>,
  ) => string;
  update: (id: string, patch: Partial<ITPItem>) => void;
  clear: (id: string, inspector: string, notes?: string) => void;
  remove: (id: string) => void;
}

export const useItpActions = (): ItpActions => {
  const setProjectPatch = useStore((s) => s.setProjectPatch);
  return {
    add: (init) => {
      const project = useStore.getState().project;
      const id = init.id ?? newId();
      const next = addITPItem(project, { ...init, id });
      if (next === project) return id;
      setProjectPatch({ itpItems: next.itpItems });
      return id;
    },
    update: (id, patch) => {
      const project = useStore.getState().project;
      const next = updateITPItem(project, id, patch);
      if (next === project) return;
      setProjectPatch({ itpItems: next.itpItems });
    },
    clear: (id, inspector, notes) => {
      const project = useStore.getState().project;
      const next = clearITPItem(project, id, inspector, notes);
      if (next === project) return;
      setProjectPatch({ itpItems: next.itpItems });
    },
    remove: (id) => {
      const project = useStore.getState().project;
      const next = removeITPItem(project, id);
      if (next === project) return;
      setProjectPatch({ itpItems: next.itpItems });
    },
  };
};
