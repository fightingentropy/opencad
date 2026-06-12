import { create } from 'zustand';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusState {
  status: SaveStatus;
  /** Epoch ms of the last successful save; null until the first one lands. */
  lastSavedAt: number | null;
  /** Short human-readable reason when status is 'error', e.g. "storage full". */
  error: string | null;
  setSaving: () => void;
  setSaved: (at?: number) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useSaveStatus = create<SaveStatusState>((set) => ({
  status: 'idle',
  lastSavedAt: null,
  error: null,
  setSaving: () => set({ status: 'saving', error: null }),
  setSaved: (at) => set({ status: 'saved', lastSavedAt: at ?? Date.now(), error: null }),
  // lastSavedAt is deliberately preserved on error — "last good save was
  // 14:32" is useful context when the current save is failing.
  setError: (message) => set({ status: 'error', error: message }),
  reset: () => set({ status: 'idle', lastSavedAt: null, error: null }),
}));

/**
 * Imperative API for non-React callers (the persistence layer). Mirrors the
 * notify()/dismissNotification() pattern in notifications.ts.
 */
export const markSaving = (): void => useSaveStatus.getState().setSaving();
export const markSaved = (at?: number): void => useSaveStatus.getState().setSaved(at);
export const markSaveError = (message: string): void => useSaveStatus.getState().setError(message);
