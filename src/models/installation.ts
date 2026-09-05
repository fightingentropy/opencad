import type { BaseEntity, Entity, Project } from '../types';

/** Site progress is independent of drawing issue/approval and as-built status. */
export type InstallationStatus = 'planned' | 'in-progress' | 'completed';

export const INSTALLATION_STATUSES: readonly InstallationStatus[] = ['planned', 'in-progress', 'completed'];
export const INSTALLATION_STATUS_LABELS: Record<InstallationStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  completed: 'Completed',
};

export const INSTALLATION_LIMITS = {
  commentLength: 4000,
  authorLength: 100,
  activityCount: 2000,
} as const;

interface InstallationActivityBase {
  id: string;
  createdAt: number;
  /** Display attribution, not a verified inspection signature. */
  author?: string;
}

export type InstallationActivity = InstallationActivityBase & (
  | { kind: 'status'; status: InstallationStatus; previousStatus: InstallationStatus }
  | { kind: 'comment'; text: string }
);

export interface InstallationRecord {
  status: InstallationStatus;
  updatedAt: number;
  /** Present only while the part is currently complete. Earlier completions remain in activities. */
  completedAt?: number;
  activities: InstallationActivity[];
}

export type ProjectInstallationActivity = InstallationActivity & {
  sheetId: string;
  sheetName: string;
  entityId: string;
  entityLabel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;

export const isInstallationStatus = (value: unknown): value is InstallationStatus =>
  value === 'planned' || value === 'in-progress' || value === 'completed';

export const isInstallationActivity = (value: unknown): value is InstallationActivity => {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return false;
  if (!isTimestamp(value.createdAt)) return false;
  if (value.author !== undefined && (
    typeof value.author !== 'string' || value.author.length > INSTALLATION_LIMITS.authorLength
  )) return false;
  if (value.kind === 'status') return isInstallationStatus(value.status) && isInstallationStatus(value.previousStatus);
  return value.kind === 'comment' && typeof value.text === 'string'
    && value.text.trim().length > 0 && value.text.length <= INSTALLATION_LIMITS.commentLength;
};

/** Used by file/autosave validation without discarding the user's original history. */
export const installationRecordDefects = (value: unknown): string[] => {
  if (!isRecord(value)) return ['installation is not an object'];
  const defects: string[] = [];
  if (!isInstallationStatus(value.status)) defects.push('invalid installation status');
  if (!isTimestamp(value.updatedAt)) defects.push('invalid installation updated date');
  if (value.completedAt !== undefined && !isTimestamp(value.completedAt)) defects.push('invalid completion date');
  if (value.status !== 'completed' && value.completedAt !== undefined) defects.push('incomplete part has a completion date');
  if (!Array.isArray(value.activities)) {
    defects.push('missing installation activity list');
  } else if (value.activities.length > INSTALLATION_LIMITS.activityCount) {
    defects.push('installation activity limit exceeded');
  } else {
    const ids = new Set<string>();
    for (const activity of value.activities) {
      if (!isInstallationActivity(activity)) {
        defects.push('invalid installation activity');
        break;
      }
      if (ids.has(activity.id)) {
        defects.push('duplicate installation activity id');
        break;
      }
      ids.add(activity.id);
    }
  }
  return defects;
};

/** Old drawings start as planned; a drawing phase is not installation evidence. */
export const installationStatus = (entity: Pick<BaseEntity, 'installation'>): InstallationStatus =>
  isInstallationStatus(entity.installation?.status) ? entity.installation.status : 'planned';

export const installationEntityLabel = (entity: Entity): string => {
  if ('tag' in entity && entity.tag) return entity.tag;
  if ('label' in entity && entity.label) return entity.label;
  if ('name' in entity && entity.name) return String(entity.name);
  if ('reference' in entity && entity.reference) return String(entity.reference);
  const kind = 'equipmentKind' in entity ? entity.equipmentKind
    : 'containmentType' in entity ? entity.containmentType : entity.kind;
  return `${kind.replaceAll('-', ' ')} · ${entity.id.slice(0, 6)}`;
};

/** Project-wide, newest first. Copy rows so sorting never mutates entity history. */
export const installationActivities = (project: Project): ProjectInstallationActivity[] => {
  const result: ProjectInstallationActivity[] = [];
  for (const [sheetId, sheet] of Object.entries(project.sheets)) {
    for (const [entityId, entity] of Object.entries(sheet.entities)) {
      const activities: unknown = entity.installation?.activities;
      if (!Array.isArray(activities)) continue;
      for (const activity of [...activities].reverse()) {
        // Imported files are validated; this also tolerates older/untrusted collaboration peers.
        if (!isInstallationActivity(activity)) continue;
        result.push({ ...activity, sheetId, sheetName: sheet.name, entityId, entityLabel: installationEntityLabel(entity) });
      }
    }
  }
  // Stable sorting retains the newest appended entry first when a clock tick
  // contains multiple events on the same part.
  return result.sort((a, b) => b.createdAt - a.createdAt);
};
