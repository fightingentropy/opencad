import { create } from 'zustand';
import type { Entity, Project, Vec2 } from '../types';
import { createComponentEntity, type InsertableComponent } from '../lib/component-library';
import { shouldRejectLocalProjectMutation } from './collaboration-guard';
import { useStore } from './store';
import { dismissNotification, notify } from './notifications';

export interface ComponentPlacement {
  component: InsertableComponent;
  project: Project;
  sheetId: string;
  layerId: string;
  viewMode: '2d' | 'split' | '3d';
  surface: '2d' | '3d';
  hint: string;
}

export const useComponentPlacement = create<{
  pending: ComponentPlacement | null;
  position: Vec2 | null;
}>(() => ({ pending: null, position: null }));

const placementProblem = (project: Project, layerId: string): string | null => {
  if (shouldRejectLocalProjectMutation()) return 'This collaboration session is read-only.';
  if (!project.sheets[project.activeSheetId]) return 'Open a drawing before adding a component.';
  const layer = project.layers[layerId];
  if (!layer) return 'Choose a layer before adding a component.';
  if (layer.locked) return 'Unlock the active layer before adding a component.';
  if (!layer.visible) return 'Show the active layer before adding a component.';
  return null;
};

const reportPlacementProblem = (message: string): void => {
  useStore.getState().setStatus(message);
  notify('warning', message, { id: 'component-placement', timeoutMs: 6000 });
};

export function cancelComponentPlacement(message = ''): void {
  if (!useComponentPlacement.getState().pending) return;
  useComponentPlacement.setState({ pending: null, position: null });
  if (message) reportPlacementProblem(message);
  else useStore.getState().setStatus('');
}

/** Starts one insertion; previews never enter the project or undo history. */
export function beginComponentPlacement(component: InsertableComponent): boolean {
  cancelComponentPlacement();
  const state = useStore.getState();
  const problem = placementProblem(state.project, state.project.activeLayerId);
  if (problem) {
    reportPlacementProblem(problem);
    return false;
  }
  try {
    createComponentEntity(component, { x: 0, y: 0 }, state.project);
  } catch (error) {
    reportPlacementProblem(error instanceof Error ? error.message : 'This component cannot be added to the current drawing.');
    return false;
  }
  dismissNotification('component-placement');
  const sheet = state.project.sheets[state.project.activeSheetId];
  const canPlaceIn3D = state.editor.viewMode === '3d'
    && sheet.sceneStyle === 'containment'
    && component.kind === 'containment'
    && ['tray', 'trunking', 'basket'].includes(component.containmentType ?? '');
  const surface = canPlaceIn3D ? '3d' : '2d';
  state.setTool('select');
  state.setPendingSymbol(null);
  state.clearSelection();
  if (surface === '2d' && state.editor.viewMode !== '2d') state.setViewMode('2d');
  const current = useStore.getState();
  const hint = `Place ${component.title}${surface === '2d' ? ' in 2D' : ''} · Click to place · Esc to cancel`;
  useComponentPlacement.setState({
    pending: {
      component, project: current.project, sheetId: current.project.activeSheetId,
      layerId: current.project.activeLayerId, viewMode: current.editor.viewMode, surface, hint,
    },
    position: null,
  });
  current.setStatus(hint);
  return true;
}

export function setComponentPlacementPosition(position: Vec2 | null): void {
  if (!useComponentPlacement.getState().pending) return;
  if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) return;
  useComponentPlacement.setState({ position });
}

export function componentPlacementPreview(position: Vec2): Entity | null {
  const pending = useComponentPlacement.getState().pending;
  if (!pending) return null;
  try {
    return {
      ...createComponentEntity(pending.component, position, pending.project),
      id: 'component-placement-preview',
    };
  } catch (error) {
    cancelComponentPlacement(error instanceof Error ? error.message : 'This component cannot be added to the current drawing.');
    return null;
  }
}

export function commitComponentPlacement(position: Vec2): Entity | null {
  const pending = useComponentPlacement.getState().pending;
  if (!pending || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const state = useStore.getState();
  if (state.project !== pending.project || state.project.activeSheetId !== pending.sheetId
    || state.editor.viewMode !== pending.viewMode) {
    cancelComponentPlacement();
    return null;
  }
  let entity: Entity;
  try {
    entity = createComponentEntity(pending.component, position, state.project);
  } catch (error) {
    cancelComponentPlacement(error instanceof Error ? error.message : 'This component cannot be added to the current drawing.');
    return null;
  }
  const problem = placementProblem(state.project, entity.layerId);
  if (problem) {
    cancelComponentPlacement(problem);
    return null;
  }
  // Clear the transient session before the normal store mutation fires its
  // subscribers. One click is one entity and one undo entry.
  useComponentPlacement.setState({ pending: null, position: null });
  state.addEntity(entity);
  const inserted = useStore.getState().project.sheets[pending.sheetId]?.entities[entity.id];
  if (!inserted) return null;
  state.setSelection([entity.id]);
  state.setStatus(`Added ${pending.component.title}`);
  return entity;
}

// A pending part belongs to the exact drawing and view in which it began.
// Undo, remote edits, layer changes and opening another project invalidate it.
const stopWatching = useStore.subscribe((state) => {
  const pending = useComponentPlacement.getState().pending;
  if (pending && (state.project !== pending.project
    || state.project.activeLayerId !== pending.layerId
    || state.editor.viewMode !== pending.viewMode
    || state.editor.tool !== 'select')) cancelComponentPlacement();
});

const onEscape = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || !useComponentPlacement.getState().pending) return;
  event.preventDefault();
  cancelComponentPlacement();
};
if (typeof window !== 'undefined') window.addEventListener('keydown', onEscape, true);
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopWatching();
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onEscape, true);
});
