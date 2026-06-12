import type { Project } from '../types';
import { projectStructureDefects, repairProjectStructure } from './project-validation';
import { migrateProject } from './persist';
import { notify } from '../state/notifications';

export interface ProjectFile {
  format: 'opencad-electrical';
  version: 1;
  project: Project;
}

export const exportProjectJSON = (project: Project): string => {
  const file: ProjectFile = {
    format: 'opencad-electrical',
    version: 1,
    project,
  };
  return JSON.stringify(file, null, 2);
};

export const importProjectJSON = (text: string): Project => {
  const file = JSON.parse(text);
  if (!file || typeof file !== 'object' || file.format !== 'opencad-electrical') {
    throw new Error('Not an OpenCAD project file');
  }
  // Repair before validating: derivable fields (order arrays, active ids)
  // are rebuilt and dangling entityOrder ids dropped rather than rejecting
  // the file — only damage that would mean real data loss (missing sheets or
  // entities containers) is fatal. Unknown extra fields pass through
  // untouched, so files from newer app versions still open.
  const repairs = repairProjectStructure(file.project);
  // Validate before the project gets anywhere near the store: a truncated or
  // hand-edited file with the right marker would otherwise install a broken
  // project, crash the canvas, and let autosave overwrite the last good copy
  // in localStorage with the wreckage.
  const defects = projectStructureDefects(file.project);
  if (defects.length > 0) {
    const shown = defects.slice(0, 3).join('; ');
    const more = defects.length > 3 ? ` (+${defects.length - 3} more)` : '';
    throw new Error(`Project file is damaged or incomplete: ${shown}${more}`);
  }
  if (repairs.length > 0) {
    const shown = repairs.slice(0, 3).join('; ');
    const more = repairs.length > 3 ? ` (+${repairs.length - 3} more)` : '';
    console.warn(`[opencad] project file needed repairs: ${repairs.join('; ')}`);
    // Stable id so re-opening the same damaged file replaces the toast.
    notify('warning', 'Project file needed minor repairs', {
      detail: `${shown}${more}`,
      id: 'open-project-repairs',
    });
  }
  // Same migration shim the autosave loader runs — fills derived defaults
  // (cable schedule, standards profile, catalogues) on files exported by
  // older app versions.
  return migrateProject(file.project as Project);
};
