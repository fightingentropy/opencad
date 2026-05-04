// Revision utilities operate on Sheet.meta — appending revisions,
// computing the next P-prefix or C-prefix code, and gating edits when
// a sheet has been issued for construction.

import type { Sheet } from '../types';
import type {
  DrawingRevision,
  RevisionStatus,
  SheetMeta,
} from '../models/revision';
import { REVISION_STATUSES } from '../models/revision';

// Append a revision row to a sheet, returning a new Sheet object so
// callers can drop it straight into a Zustand-style immutable update.
// The supplied revision becomes the current revision.
export const addRevision = (sheet: Sheet, rev: DrawingRevision): Sheet => {
  const existing = sheet.meta?.revisions ?? [];
  const meta: SheetMeta = {
    ...(sheet.meta ?? {}),
    revisions: [...existing, rev],
    currentRevision: rev.code,
    status: rev.status,
  };
  return { ...sheet, meta };
};

// Pre-contract revisions (S0–S2) get the "P" prefix; everything from
// S3 onwards uses "C". The numeric suffix is the next free integer
// scoped to that prefix, padded to two digits.
export const nextRevisionCode = (
  meta: SheetMeta | undefined,
  status: RevisionStatus,
): string => {
  // BS EN ISO 19650 convention: P = preliminary, C = contractual.
  const isContract =
    status === 'S3' ||
    status === 'S4' ||
    status === 'S5' ||
    status === 'S6' ||
    status === 'S7';
  const prefix = isContract ? 'C' : 'P';

  let max = 0;
  for (const r of meta?.revisions ?? []) {
    if (typeof r.code !== 'string') continue;
    if (!r.code.startsWith(prefix)) continue;
    const n = parseInt(r.code.slice(1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = Math.min(99, max + 1);
  return `${prefix}${String(next).padStart(2, '0')}`;
};

// Editing is locked from S3 onwards unless the sheet is in as-built
// (S5) mode, which explicitly allows mark-up against installed work.
export const canEditSheet = (sheet: Sheet): boolean => {
  const status = sheet.meta?.status;
  if (!status) return true;
  // S5 (as-built) is editable to record what was actually installed.
  if (status === 'S5') return true;
  const info = REVISION_STATUSES[status];
  if (!info) return true;
  return info.editable;
};
