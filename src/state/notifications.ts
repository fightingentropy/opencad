import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional second line — e.g. the underlying error message. */
  detail?: string;
  /** ms until auto-dismiss; null means sticky until the user closes it. */
  timeoutMs: number | null;
}

interface NotificationState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'timeoutMs'> & { id?: string; timeoutMs?: number | null }) => string;
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

// Errors stay until dismissed — they usually mean lost work if missed.
const DEFAULT_TIMEOUT: Record<ToastKind, number | null> = {
  info: 4000,
  success: 4000,
  warning: 8000,
  error: null,
};

export const useNotifications = create<NotificationState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = toast.id ?? nanoid(8);
    const next: Toast = {
      id,
      kind: toast.kind,
      message: toast.message,
      detail: toast.detail,
      timeoutMs: toast.timeoutMs === undefined ? DEFAULT_TIMEOUT[toast.kind] : toast.timeoutMs,
    };
    set((s) => ({
      // Re-pushing an existing id replaces it in place, so callers can use a
      // stable id to dedupe recurring warnings (e.g. autosave quota).
      toasts: s.toasts.some((t) => t.id === id)
        ? s.toasts.map((t) => (t.id === id ? next : t))
        : [...s.toasts, next],
    }));
    return id;
  },
  update: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Imperative API for non-React callers (persistence, importers, exporters).
 * Safe to call before the Toast UI is mounted — toasts queue in the store.
 */
export const notify = (
  kind: ToastKind,
  message: string,
  opts?: { detail?: string; timeoutMs?: number | null; id?: string },
): string => useNotifications.getState().push({ kind, message, ...opts });

export const dismissNotification = (id: string): void => useNotifications.getState().dismiss(id);
