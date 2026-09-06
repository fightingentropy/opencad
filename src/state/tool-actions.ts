import type { EditorState, Project, ToolId } from '../types';
import { getContainmentToolComponent } from '../lib/component-library';
import { beginComponentPlacement, cancelComponentPlacement } from './component-placement';
import { useStore } from './store';

export function toolPlacementComponent(project: Project, viewMode: EditorState['viewMode'], tool: string) {
  if (viewMode !== '3d' || project.sheets[project.activeSheetId]?.sceneStyle !== 'containment') return undefined;
  return getContainmentToolComponent(tool);
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
