import type { Project } from '../types';
import { emptyCableSchedule } from '../models/cable';
import { DEFAULT_STANDARDS } from '../models/standards';

// Bump this whenever the bundled sample project changes meaningfully —
// users with an autosave from a previous demo will skip it and load the
// new sample on next reload.
const STORAGE_KEY = 'opencad.project.v6';
// Older keys are read once for migration and then evicted, so users with
// a v5 (or earlier) save aren't dropped back to a fresh demo.
const LEGACY_KEYS = ['opencad.project.v5', 'opencad.project.v4'];

// Apply migrations to projects saved by older app versions. Whole-site
// fields are optional in the type, so the migration is mostly about
// filling in derived defaults so downstream code can stop guarding for
// `undefined` on long-lived fields like the cable schedule and standards
// profile.
function migrateProject(parsed: Project): Project {
  const next: Project = { ...parsed };
  if (!next.cableSchedule) next.cableSchedule = emptyCableSchedule();
  if (!next.standardsProfile) next.standardsProfile = DEFAULT_STANDARDS.BS7671;
  // sites / buildings / floors / zones / systems are intentionally left
  // undefined — the UI handles their absence and treats the project as a
  // single-sheet drawing rather than a whole-site project.
  // catalogues / penetrationSeals / itpItems / markups likewise stay
  // undefined; introducing empty records would burden every consumer with
  // a "show empty list" branch.
  return next;
}

function readKey(key: string): Project | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    if (!parsed || !parsed.id || !parsed.sheets || !parsed.sheetOrder) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadStoredProject(): Project | null {
  // Try the current key first.
  const current = readKey(STORAGE_KEY);
  if (current) return migrateProject(current);

  // Fall back to legacy keys, run the migration shim, then evict the
  // legacy entry so the next save lands on the new key cleanly.
  for (const key of LEGACY_KEYS) {
    const legacy = readKey(key);
    if (!legacy) continue;
    const migrated = migrateProject(legacy);
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return migrated;
  }
  return null;
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
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    quotaWarned = false;
  } catch {
    // ignore
  }
}
