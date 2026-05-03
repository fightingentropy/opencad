import type { Project } from '../types';

// Bump this whenever the bundled sample project changes meaningfully —
// users with an autosave from a previous demo will skip it and load the
// new sample on next reload.
const STORAGE_KEY = 'opencad.project.v5';

export function loadStoredProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    if (!parsed || !parsed.id || !parsed.sheets || !parsed.sheetOrder) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface SaveResult {
  ok: boolean;
  reason?: 'quota' | 'unavailable' | 'unknown';
  bytes?: number;
}

let quotaWarned = false;

export function saveStoredProject(p: Project): SaveResult {
  let serialized = '';
  try {
    serialized = JSON.stringify(p);
  } catch {
    return { ok: false, reason: 'unknown' };
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true, bytes: serialized.length };
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      // Various browsers report quota differently — name covers Firefox/Safari/Chromium.
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014);
    if (isQuota) {
      if (!quotaWarned) {
        quotaWarned = true;
        // Tell the user once per session — repeated alerts on every keystroke
        // would be its own kind of bug.
        console.warn(`[opencad] localStorage full (${serialized.length} bytes). Autosave is paused until you free space or save the project to disk via File → Save.`);
      }
      return { ok: false, reason: 'quota', bytes: serialized.length };
    }
    return { ok: false, reason: 'unavailable' };
  }
}

export function clearStoredProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    quotaWarned = false;
  } catch {
    // ignore
  }
}
