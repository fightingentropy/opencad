// Re-exports for the three.js panel viewer + whole-site renderers.
export { Panel3D } from './Panel3D';
export type { Panel3DProps } from './Panel3D';
export { default } from './Panel3D';

// Whole-site / multi-floor 3D modules
export { defaultElevation, elevationsFor } from './elevations';
export {
  renderContainment3D,
  colourFor as containmentColour,
} from './ContainmentRender3D';
export type { RenderOpts as ContainmentRenderOpts, MaterialPalette } from './ContainmentRender3D';
export { renderFitting3D } from './FittingRender3D';
export type { FittingRenderOpts } from './FittingRender3D';
export { renderSupport3D } from './SupportRender3D';
export type { SupportRenderOpts } from './SupportRender3D';
export { renderEquipment3D } from './EquipmentRender3D';
export type { EquipmentRenderOpts } from './EquipmentRender3D';
export { renderCablesInContainment, colourForCircuit } from './CableInTray3D';
export type { CableInTrayOpts } from './CableInTray3D';
export { renderCrossSection } from './CrossSectionViz';
export type { CrossSectionOpts } from './CrossSectionViz';
export { buildBuildingScene } from './BuildingScene';
export type {
  BuildSceneOptions,
  SceneControls,
  SceneLayer,
} from './BuildingScene';
