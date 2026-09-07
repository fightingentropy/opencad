import type { EditorState, Project, ToolId } from '../types';
import { getSpatialToolComponent } from '../lib/component-library';
import { beginComponentPlacement, cancelComponentPlacement } from './component-placement';
import { useStore } from './store';
import { hasSpatialWorkspace } from '../lib/scene-edit';

export function toolPlacementComponent(project: Project, viewMode: EditorState['viewMode'], tool: string) {
  if (viewMode !== '3d' || !hasSpatialWorkspace(project)) return undefined;
  return getSpatialToolComponent(tool);
}

/** Tool entry points share the active workspace instead of switching views in the UI. */
export function activateTool(tool: ToolId): void {
  const state = useStore.getState();
  const component = toolPlacementComponent(state.project, state.editor.viewMode, tool);
  if (component) {
    beginComponentPlacement(component);
    return;
  }
  cancelComponentPlacement();
  if (state.editor.viewMode === '3d' && tool !== 'select' && tool !== 'pan') state.setViewMode('2d');
  state.setTool(tool);
}
