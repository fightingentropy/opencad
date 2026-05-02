import type { Project } from '../types';

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
  if (file.format !== 'opencad-electrical') throw new Error('Not an OpenCAD project file');
  return file.project as Project;
};
