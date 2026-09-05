import { nanoid } from 'nanoid';
import type { Entity, Project } from '../types';
import {
  INSTALLATION_LIMITS,
  installationRecordDefects,
  installationStatus,
  isInstallationStatus,
  type InstallationActivity,
  type InstallationRecord,
  type InstallationStatus,
} from '../models/installation';
import { shouldRejectLocalProjectMutation } from './collaboration-guard';
import { useStore } from './store';

const cleanAuthor = (author?: string): string | undefined => author?.trim() || undefined;
const validAuthor = (author?: string): boolean =>
  author === undefined || (typeof author === 'string' && author.trim().length <= INSTALLATION_LIMITS.authorLength);

const canAppend = (entity: Entity): boolean => !entity.installation || (
  installationRecordDefects(entity.installation).length === 0
  && entity.installation.activities.length < INSTALLATION_LIMITS.activityCount
);

const withRecord = (
  project: Project,
  sheetId: string,
  entityId: string,
  installation: InstallationRecord,
): Project => {
  const sheet = project.sheets[sheetId];
  return {
    ...project,
    modified: installation.updatedAt,
    sheets: {
      ...project.sheets,
      [sheetId]: {
        ...sheet,
        entities: { ...sheet.entities, [entityId]: { ...sheet.entities[entityId], installation } as Entity },
      },
    },
  };
};

export const withInstallationStatus = (
  project: Project,
  sheetId: string,
  entityId: string,
  status: InstallationStatus,
  author?: string,
): Project => {
  const entity = project.sheets[sheetId]?.entities[entityId];
  if (!entity || !isInstallationStatus(status) || !validAuthor(author) || !canAppend(entity)) return project;
  const previousStatus = installationStatus(entity);
  if (status === previousStatus) return project;
  const now = Date.now();
  const activity: InstallationActivity = {
    id: nanoid(12), kind: 'status', status, previousStatus, createdAt: now, author: cleanAuthor(author),
  };
  return withRecord(project, sheetId, entityId, {
    status,
    updatedAt: now,
    ...(status === 'completed' ? { completedAt: now } : {}),
    activities: [...(entity.installation?.activities ?? []), activity],
  });
};

export const withInstallationComment = (
  project: Project,
  sheetId: string,
  entityId: string,
  text: string,
  author?: string,
): Project => {
  const entity = project.sheets[sheetId]?.entities[entityId];
  if (!entity || typeof text !== 'string' || !validAuthor(author) || !canAppend(entity)) return project;
  const comment = text.trim();
  if (!comment || comment.length > INSTALLATION_LIMITS.commentLength) return project;
  const now = Date.now();
  const activity: InstallationActivity = {
    id: nanoid(12), kind: 'comment', text: comment, createdAt: now, author: cleanAuthor(author),
  };
  return withRecord(project, sheetId, entityId, {
    ...entity.installation,
    status: installationStatus(entity),
    updatedAt: now,
    activities: [...(entity.installation?.activities ?? []), activity],
  });
};

const commitInstallation = (update: (project: Project) => Project): boolean => {
  const state = useStore.getState();
  if (shouldRejectLocalProjectMutation()) {
    state.setStatus('Collaboration viewer: installation edits are disabled');
    return false;
  }
  const next = update(state.project);
  if (next === state.project) return false;
  // Use the requested sheet, not the active sheet. One change = one undo step.
  state.setProjectPatch({ sheets: next.sheets });
  return useStore.getState().project.sheets === next.sheets;
};

export const setInstallationStatus = (
  sheetId: string,
  entityId: string,
  status: InstallationStatus,
  author?: string,
): boolean => commitInstallation((project) => withInstallationStatus(project, sheetId, entityId, status, author));

export const addInstallationComment = (
  sheetId: string,
  entityId: string,
  text: string,
  author?: string,
): boolean => commitInstallation((project) => withInstallationComment(project, sheetId, entityId, text, author));

const actions = { setStatus: setInstallationStatus, addComment: addInstallationComment };
export const useInstallationActions = (): typeof actions => actions;
