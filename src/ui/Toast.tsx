import React, { useEffect } from 'react';
import { useNotifications } from '../state/notifications';
import type { Toast as ToastData } from '../state/notifications';

// Single toast row. Owns its auto-dismiss timer: re-pushing the same id
// replaces the toast object in the store, so the effect re-runs and the
// timer restarts — a sticky "Exporting…" toast swapped for a timed success
// toast dismisses on the new toast's schedule.
function ToastItem({ toast }: { toast: ToastData }) {
  const dismiss = useNotifications((s) => s.dismiss);

  useEffect(() => {
    if (toast.timeoutMs === null) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.timeoutMs);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <div className="toast-content">
        <div className="toast-message">{toast.message}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
      </div>
      <button
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Fixed toast stack rendered above the rest of the app chrome (including
 * modal backdrops). Reads from the shared notification store, so both React
 * components and imperative callers (importers, exporters, persistence) can
 * surface messages through the same UI.
 */
export function Toast() {
  const toasts = useNotifications((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
