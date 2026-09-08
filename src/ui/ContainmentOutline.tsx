import { useMemo } from 'react';
import type { ContainmentEntity, Project } from '../types';
import { useStore } from '../state/store';
import { focusInstallation } from './InstallationPanel';
import './containment-workspace.css';
import { AppIcon } from './AppIcon';
import { runCommand } from '../lib/commands';
import { isPhysicalEntity, physicalAnchor, physicalElevation, physicalHeading, type PhysicalEntity } from '../lib/scene-edit';
import { polylineLength } from '../lib/fittings';
import { addRouteSupports, physicalEditProblem, setRouteConnectionsLocked, updatePhysicalProperty, updateRoutePointElevation, type PhysicalProperty } from '../state/scene-actions';
import { DimensionInput } from './DimensionInput';
import { computeContainmentFill } from '../calc/fill';
import { computeSupportSpacingWithTrace } from '../calc/supports';
import { DEFAULT_STANDARDS } from '../models/standards';
import { hasHeightChanges, routePath } from '../lib/route-path';
import { routeEndStates } from '../lib/route-connections';
import { StructureControls } from './StructureControls';
import { openRunDrawings } from './RunDrawingDialog';

const names: Record<string, string> = {
  tray: 'Cable tray', trunking: 'Trunking', basket: 'Wire basket', conduit: 'Conduit',
  ladder: 'Cable ladder', duct: 'Duct', busbar: 'Busbar trunking',
};
const pretty = (value: string) => value.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
const nameFor = (entity: PhysicalEntity) => entity.kind === 'containment' ? names[entity.containmentType]
  : entity.kind === 'equipment' ? entity.tag + ' · ' + pretty(entity.equipmentKind) : pretty(entity.supportKind);
const sizeFor = (entity: PhysicalEntity) => entity.kind === 'containment'
  ? entity.containmentType === 'conduit' ? 'Ø' + entity.width + ' mm' : entity.width + ' × ' + entity.height + ' mm'
  : entity.kind === 'equipment' ? Math.abs(entity.b.x - entity.a.x) + ' × ' + Math.abs(entity.b.y - entity.a.y) + ' mm'
    : (entity.channelLength ?? 600) + ' mm';

function RouteFeedback({ entity, project, disabled }: { entity: ContainmentEntity; project: Project; disabled: boolean }) {
  const feedback = useMemo(() => {
    const cables = Object.values(project.cableSchedule?.cables ?? {}).filter(cable => cable.route?.includes(entity.id));
    const profile = project.standardsProfile ?? DEFAULT_STANDARDS.BS7671;
    const fill = computeContainmentFill(entity, cables, profile);
    const attached = Object.values(project.sheets[project.activeSheetId].entities);
    const supports = attached.filter(part => part.kind === 'support' && part.supportingContainmentIds.includes(entity.id));
    const fittings = attached.filter(part => part.kind === 'fitting' && part.containmentId === entity.id);
    return { fill, supports, fittings, profile, spacing: computeSupportSpacingWithTrace(entity) };
  }, [entity, project]);
  const { fill, supports, fittings, profile, spacing } = feedback;
  const fillIssue = fill.cableCount > 0 && fill.fillStatus !== 'ok';
  const missingSupports = !supports.length && physicalElevation(entity, project) > 0;
  return <details className="scene-design-checks" key={entity.id}>
    <summary aria-label="Design checks">Design checks{(fillIssue || missingSupports) && <span className="scene-check-count">{Number(fillIssue) + Number(missingSupports)}</span>}</summary>
    <button type="button" className={'scene-feedback-row' + (fillIssue ? ' has-warning' : '')} onClick={() => runCommand('dialog.cable-schedule')}>
      <span>Capacity</span><strong>{fill.cableCount ? fill.fillPct.toFixed(1) + '% / ' + Math.round(fill.limit * 100) + '%' : 'Assign cables'}</strong>
    </button>
    {fillIssue && <button type="button" className="scene-check-message" onClick={() => runCommand('dialog.compliance')}>
      {fill.fillStatus === 'over' ? 'Fill exceeds the selected profile limit.' : 'Fill is approaching the selected profile limit.'} Review →
    </button>}
    <div className="scene-feedback-row"><span>Supports</span><strong>{supports.length} placed</strong></div>
    {hasHeightChanges(entity) && <p className="scene-check-message">Vertical and sloping fixings require a separate support design.</p>}
    {missingSupports && <p className="scene-check-message">This elevated route has no supports.</p>}
    <p className="scene-check-note" title="Existing BS 7671 support dataset. Verify spacing against the chosen manufacturer's system.">Spacing guide: {(spacing.spacingMm / 1000).toFixed(2)} m</p>
    <button type="button" className="scene-inline-action" disabled={disabled} onClick={() => addRouteSupports(entity.id)}>{supports.length ? 'Update support layout' : 'Lay out supports'}</button>
    <div className="scene-feedback-row"><span>Fittings</span><strong>{fittings.length}</strong></div>
    <div className="scene-feedback-row"><span>Route quantity</span><strong>{(polylineLength(entity.points) / 1000).toFixed(2)} m</strong></div>
    <p className="scene-check-note">Capacity · {profile.code} · {profile.edition}</p>
    <button type="button" className="scene-inline-action" onClick={() => runCommand('dialog.bom')}>Open materials list →</button>
  </details>;
}

function PhysicalProperties({ selected, project }: { selected: PhysicalEntity; project: Project }) {
  const disabled = !!physicalEditProblem(selected, project);
  const anchor = physicalAnchor(selected);
  const field = (label: string, property: PhysicalProperty, value: number, unit = 'mm') =>
    <DimensionInput key={selected.id + ':' + property + ':' + value} label={label} value={value} unit={unit} disabled={disabled}
      onCommit={number => updatePhysicalProperty(selected.id, property, number)} />;
  return <section className="containment-properties" aria-label={selected.kind === 'containment' ? 'Route properties' : 'Part properties'}>
    <div className="containment-outline-label"><span>Properties</span><span className="containment-property-actions">
      <button type="button" onClick={() => focusInstallation(selected.id)} aria-label="Focus route" title="Focus part"><AppIcon name="focus" size={15} /></button>
      <button type="button" onClick={() => useStore.getState().clearSelection()} aria-label="Clear selection" title="Clear selection"><AppIcon name="close" size={15} /></button>
    </span></div>
    <div className="scene-properties-fields">
      {selected.kind === 'containment' && <>
        {field(selected.containmentType === 'conduit' ? 'Diameter' : 'Width', 'width', selected.width ?? 100)}
        {selected.containmentType !== 'conduit' && field('Depth', 'depth', selected.height ?? 50)}
        {field('Length', 'length', polylineLength(selected.points))}
      </>}
      {selected.kind === 'equipment' && <>
        {field('Width', 'width', Math.abs(selected.b.x - selected.a.x))}
        {field('Depth', 'depth', Math.abs(selected.b.y - selected.a.y))}
        {field('Height', 'height', selected.height ?? 1000)}
        {field('Front access', 'accessDepth', selected.accessDepth ?? project.coordination?.equipmentAccessMm ?? 600)}
      </>}
      {selected.kind === 'support' && <>
        {field('Channel length', 'length', selected.channelLength ?? 600)}
        {field('Rod length', 'height', selected.rodLength ?? 1000)}
      </>}
      {field('Elevation', 'elevation', physicalElevation(selected, project))}
    </div>
    <details className="scene-position-fields">
      <summary>Position & rotation</summary>
      {field('X', 'x', anchor.x)}{field('Y', 'y', anchor.y)}
      {field('Rotation', 'rotation', physicalHeading(selected) * 180 / Math.PI, '°')}
    </details>
    {selected.kind === 'containment' && <details className="scene-position-fields">
      <summary>Route points & connections</summary>
      <label className="scene-join-choice"><input type="checkbox" disabled={disabled} checked={!!selected.connectionsLocked}
        onChange={event => setRouteConnectionsLocked(selected.id, event.target.checked)} />Keep connections joined</label>
      <p className="scene-check-note">{routeEndStates(selected, project).filter(end => end.connected).length} connected · {routeEndStates(selected, project).filter(end => !end.connected).length} open ends</p>
      {routePath(selected, project.floors?.[project.sheets[project.activeSheetId].floorId ?? '']).map((point, index) => <DimensionInput
        key={selected.id + ':' + index} label={'Point ' + (index + 1) + ' elevation'} value={point.z} disabled={disabled}
        onCommit={value => updateRoutePointElevation(selected.id, index, value)} />)}
    </details>}
    {selected.kind === 'containment' && <>
      {(selected.finish || selected.material) && <div className="scene-material-line">{pretty(selected.finish ?? selected.material!)}</div>}
      <button type="button" className="scene-inline-action scene-drawing-action" onClick={() => openRunDrawings(selected.id)}>Create run drawings →</button>
      <RouteFeedback entity={selected} project={project} disabled={disabled} />
    </>}
  </section>;
}

export function ContainmentOutline() {
  const project = useStore(state => state.project);
  const selection = useStore(state => state.editor.selection);
  const sheet = project.sheets[project.activeSheetId];
  const parts = (sheet?.entityOrder ?? []).flatMap(id => {
    const entity = sheet.entities[id];
    return isPhysicalEntity(entity) && !(entity.kind === 'support' && entity.autoGenerated) ? [entity] : [];
  });
  const selectedEntity = sheet?.entities[[...selection][0]];
  const selected = isPhysicalEntity(selectedEntity) ? selectedEntity : null;
  return <aside className="containment-outline" aria-label="Containment outline">
    <div className="containment-outline-heading"><h1>Objects <span>{parts.length}</span></h1>
      <button type="button" aria-label="Add component" title="Add component (⌘K)" onClick={() => runCommand('help.palette')}><AppIcon name="plus" size={17} /></button>
    </div>
    <div className="containment-route-list">{parts.map(part => <button type="button" key={part.id} aria-label={'Inspect ' + nameFor(part)}
      aria-pressed={selection.has(part.id)} className={selection.has(part.id) ? 'selected' : ''}
      onClick={() => useStore.getState().setSelection([part.id])}>
      <svg viewBox="0 0 36 28" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        {part.kind === 'equipment' ? <><rect x="7" y="2" width="22" height="24" rx="1" /><path d="M18 2v24M21 13v3" /></>
          : part.kind === 'support' ? <path d="M7 3v21h24M4 3h6M24 3h6M27 3v17H7" />
            : part.containmentType === 'conduit' ? <><circle cx="18" cy="14" r="10" /><circle cx="18" cy="14" r="7" /></>
              : <><path d="M5 6v16h26V6" />{part.containmentType === 'basket' ? <path d="M5 12h26M5 17h26M11 6v16M18 6v16M25 6v16" />
                : part.containmentType === 'tray' ? <path d="M10 19h3m3 0h3m3 0h3M5 6h3m20 0h3" /> : <path d="M5 6h3m20 0h3" />}</>}
      </svg>
      <span><strong>{nameFor(part)}</strong><small>{sizeFor(part)}</small></span>
    </button>)}</div>
    <StructureControls project={project} selection={selection} />
    {selected && <PhysicalProperties selected={selected} project={project} />}
  </aside>;
}
