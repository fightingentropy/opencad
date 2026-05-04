// Markup / review thread actions. Markup items live in a flat record
// keyed by their id. Each item belongs to a sheet and tracks an
// open/resolved status with an optional reply thread.

import { nanoid } from 'nanoid';
import type { Project } from '../types';
import type { MarkupItem, MarkupReply } from '../models/revision';
import { useStore } from './store';

const newId = (): string => nanoid(10);

const ensureMarkups = (project: Project): Record<string, MarkupItem> =>
  project.markups ?? {};

// ---------- Pure helpers --------------------------------------------------

export const addMarkup = (
  project: Project,
  init: Omit<MarkupItem, 'id' | 'createdAt' | 'updatedAt' | 'status'> &
    Partial<Pick<MarkupItem, 'id' | 'status'>>,
): Project => {
  const id = init.id ?? newId();
  const now = Date.now();
  const item: MarkupItem = {
    id,
    sheetId: init.sheetId,
    anchorPoint: init.anchorPoint,
    anchorEntityId: init.anchorEntityId,
    kind: init.kind,
    text: init.text,
    author: init.author,
    authorRole: init.authorRole,
    createdAt: now,
    updatedAt: now,
    status: init.status ?? 'open',
    color: init.color,
    replies: init.replies,
  };
  return {
    ...project,
    markups: { ...ensureMarkups(project), [id]: item },
    modified: now,
  };
};

export const resolveMarkup = (
  project: Project,
  id: string,
  resolvedBy: string,
  resolutionNote?: string,
  resultStatus: MarkupItem['status'] = 'resolved',
): Project => {
  const markups = project.markups;
  if (!markups || !markups[id]) return project;
  const now = Date.now();
  return {
    ...project,
    markups: {
      ...markups,
      [id]: {
        ...markups[id],
        status: resultStatus,
        resolvedBy,
        resolvedAt: now,
        resolutionNote,
        updatedAt: now,
      },
    },
    modified: now,
  };
};

export const replyToMarkup = (
  project: Project,
  id: string,
  reply: Omit<MarkupReply, 'id' | 'createdAt'> & Partial<Pick<MarkupReply, 'id' | 'createdAt'>>,
): Project => {
  const markups = project.markups;
  if (!markups || !markups[id]) return project;
  const now = Date.now();
  const r: MarkupReply = {
    id: reply.id ?? newId(),
    author: reply.author,
    text: reply.text,
    createdAt: reply.createdAt ?? now,
  };
  const target = markups[id];
  return {
    ...project,
    markups: {
      ...markups,
      [id]: {
        ...target,
        replies: [...(target.replies ?? []), r],
        updatedAt: now,
      },
    },
    modified: now,
  };
};

export const removeMarkup = (project: Project, id: string): Project => {
  const markups = project.markups;
  if (!markups || !markups[id]) return project;
  const next = { ...markups };
  delete next[id];
  return { ...project, markups: next, modified: Date.now() };
};

// ---------- Hook ---------------------------------------------------------

export interface MarkupActions {
  add: (
    init: Omit<MarkupItem, 'id' | 'createdAt' | 'updatedAt' | 'status'> &
      Partial<Pick<MarkupItem, 'id' | 'status'>>,
  ) => string;
  resolve: (
    id: string,
    resolvedBy: string,
    resolutionNote?: string,
    status?: MarkupItem['status'],
  ) => void;
  reply: (
    id: string,
    reply: Omit<MarkupReply, 'id' | 'createdAt'> &
      Partial<Pick<MarkupReply, 'id' | 'createdAt'>>,
  ) => void;
  remove: (id: string) => void;
}

export const useMarkupActions = (): MarkupActions => {
  const setProjectPatch = useStore((s) => s.setProjectPatch);
  return {
    add: (init) => {
      const project = useStore.getState().project;
      const id = init.id ?? newId();
      const next = addMarkup(project, { ...init, id });
      if (next === project) return id;
      setProjectPatch({ markups: next.markups });
      return id;
    },
    resolve: (id, resolvedBy, resolutionNote, status) => {
      const project = useStore.getState().project;
      const next = resolveMarkup(project, id, resolvedBy, resolutionNote, status);
      if (next === project) return;
      setProjectPatch({ markups: next.markups });
    },
    reply: (id, reply) => {
      const project = useStore.getState().project;
      const next = replyToMarkup(project, id, reply);
      if (next === project) return;
      setProjectPatch({ markups: next.markups });
    },
    remove: (id) => {
      const project = useStore.getState().project;
      const next = removeMarkup(project, id);
      if (next === project) return;
      setProjectPatch({ markups: next.markups });
    },
  };
};
