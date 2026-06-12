import React from 'react';
import { useStore } from '../state/store';
import { loadStoredProject } from '../io/persist';
import { exportProjectJSON } from '../io/project';
import { notify } from '../state/notifications';

/**
 * Filename for the rescue download. Mirrors MenuBar's File → Save naming
 * (`Name.opencad.json`) with a `_backup` suffix so the file re-opens via
 * File → Open without renaming. Exported for tests.
 */
export const backupFilename = (projectName: string): string => {
  const safe = projectName.trim().replace(/\s+/g, '_');
  return `${safe || 'project'}_backup.opencad.json`;
};

interface ErrorBoundaryProps {
  /** Region name shown in the fallback so the user knows which part crashed. */
  label: string;
  /**
   * Extra class(es) for the fallback container. Regions that occupy a grid
   * slot pass their own layout class (e.g. `left-panel`) so the fallback
   * takes the crashed region's place instead of breaking the app grid.
   */
  className?: string;
  /**
   * Called whenever the boundary resets ("Try to continue" or a restore) —
   * lets the host unmount whatever crashed, e.g. close the open modal, so
   * the retry doesn't immediately re-render the same broken tree.
   */
  onReset?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-region error boundary with recovery actions. Each major region of the
 * app (canvas, side panels, modals) mounts its own instance, so one
 * malformed entity crashing a properties render leaves the rest of the app
 * interactive. The fallback offers three escapes:
 *
 * - "Try to continue" re-renders the region as-is — enough for transient
 *   failures (a half-applied collab update, a one-off render glitch).
 * - "Restore last saved project" swaps in the localStorage autosave via the
 *   store's setProject, for when the in-memory project itself is corrupt.
 * - "Download backup" serialises the CURRENT in-memory project to a file so
 *   work since the last autosave can be rescued even while rendering is
 *   broken.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `[opencad] render crash in ${this.props.label}:`,
      error,
      info.componentStack,
    );
  }

  private handleContinue = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  private handleRestore = (): void => {
    const stored = loadStoredProject();
    if (!stored) {
      notify('warning', 'No autosaved project found in browser storage.');
      return;
    }
    useStore.getState().setProject(stored);
    this.props.onReset?.();
    this.setState({ error: null });
    notify('success', 'Restored last saved project.');
  };

  private handleDownload = (): void => {
    try {
      const project = useStore.getState().project;
      const blob = new Blob([exportProjectJSON(project)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFilename(project.name);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // Serialisation of a corrupt project can itself fail — surface it
      // rather than dying silently inside the recovery UI.
      console.error('[opencad] backup download failed', err);
      notify('error', 'Backup download failed', { detail: (err as Error).message });
    }
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { label, className } = this.props;
    return (
      <div className={`error-fallback${className ? ` ${className}` : ''}`} role="alert">
        <div className="error-fallback-card">
          <div className="error-fallback-title">{label} crashed</div>
          <div className="error-fallback-message">{error.message || String(error)}</div>
          <div className="error-fallback-hint">
            The rest of the app is still running. Your project is still in
            memory — download a backup first if this keeps happening.
          </div>
          <div className="error-fallback-actions">
            <button className="btn-primary" onClick={this.handleContinue}>
              Try to continue
            </button>
            <button className="btn-ghost" onClick={this.handleRestore}>
              Restore last saved project
            </button>
            <button className="btn-ghost" onClick={this.handleDownload}>
              Download backup
            </button>
          </div>
        </div>
      </div>
    );
  }
}
