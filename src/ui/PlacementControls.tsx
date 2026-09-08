import { addRouteDrawingPoint, beginComponentPlacement, beginRouteDrawing, cancelComponentPlacement, finishRouteDrawing,
  undoRouteDrawingPoint, updatePlacementOptions, useComponentPlacement } from '../state/component-placement';
import { DimensionInput } from './DimensionInput';
import { AppIcon } from './AppIcon';
import { pathLength } from '../lib/route-path';

export function PlacementControls() {
  const pending = useComponentPlacement(state => state.pending);
  const connection = useComponentPlacement(state => state.connection);
  const position = useComponentPlacement(state => state.position);
  if (pending?.surface !== '3d') return null;
  const shaping = pending.operation === 'endpoint' || pending.operation === 'extend';
  const drawing = pending.operation === 'route';
  const last = pending.routePoints?.at(-1);
  const legLength = last && position ? Math.hypot(position.x - last.x, position.y - last.y) : 0;
  const angle = pending.legAngle ?? (last && position ? Math.atan2(position.y - last.y, position.x - last.x) : 0);
  return <div className="scene-placement-controls" role="region" aria-label="Placement controls">
    <div className="scene-placement-title"><span>{drawing ? (pending.source ? 'Extend route' : pending.component.title) : pending.operation === 'move' ? 'Move part' : shaping ? 'Adjust route' : pending.component.title}</span>
      <button type="button" aria-label="Cancel placement" title="Cancel placement (Esc)" onClick={() => cancelComponentPlacement()}><AppIcon name="close" size={15} /></button></div>
    {pending.prototype.kind === 'containment' && !pending.source && (drawing || pending.operation === 'insert') && <div className="scene-placement-modes" aria-label="Routing mode">
      <button type="button" aria-pressed={!drawing} onClick={() => beginComponentPlacement(pending.component, { operation: 'insert', elevation: pending.elevation })}>Place section</button>
      <button type="button" aria-pressed={drawing} onClick={() => { beginRouteDrawing(pending.component); updatePlacementOptions({ elevation: pending.elevation }); }}>Draw route</button>
    </div>}
    {drawing ? <div className="scene-route-fields">
      {last && <>
        <div className="scene-route-field"><DimensionInput label="Leg length" value={pending.length ?? legLength} onCommit={length => updatePlacementOptions({ length })} />
          {pending.length != null && <button type="button" aria-label="Use cursor length" title="Use cursor length" onClick={() => updatePlacementOptions({ length: undefined })}>×</button>}</div>
        <div className="scene-route-field"><DimensionInput label="Angle" value={Math.round(angle * 180 / Math.PI * 100) / 100} unit="°" onCommit={degrees => updatePlacementOptions({ legAngle: degrees * Math.PI / 180 })} />
          {pending.legAngle != null && <button type="button" aria-label="Use cursor angle" title="Use cursor angle" onClick={() => updatePlacementOptions({ legAngle: undefined })}>×</button>}</div>
      </>}
      <DimensionInput label="Elevation" value={pending.elevation ?? 0} onCommit={elevation => updatePlacementOptions({ elevation })} />
      {last && Math.abs(last.z - (pending.elevation ?? 0)) > 0.01 && <button type="button" className="scene-inline-action" onClick={() => addRouteDrawingPoint({ ...last, z: pending.elevation })}>Add rise / drop</button>}
      <div className="scene-route-actions">
        <button type="button" disabled={!pending.routeSteps?.length} aria-label="Remove last route point" title="Remove last point (Backspace)" onClick={undoRouteDrawingPoint}><AppIcon name="undo" size={15} /></button>
        <span>{(pathLength(pending.routePoints ?? []) / 1000).toFixed(2)} m</span>
        <button type="button" disabled={!last || !position} onClick={() => { if (position) addRouteDrawingPoint(position); }}>Add leg</button>
        <button type="button" className="scene-route-finish" disabled={(pending.routePoints?.length ?? 0) < 2} onClick={finishRouteDrawing}>Finish</button>
      </div>
    </div> : !shaping ? <div className="scene-placement-fields">
      {pending.length != null && <DimensionInput key={'length:' + pending.length} label="Length" value={pending.length} onCommit={length => updatePlacementOptions({ length })} />}
      {pending.elevation != null && <DimensionInput key={'elevation:' + pending.elevation} label="Elevation" value={pending.elevation} onCommit={elevation => updatePlacementOptions({ elevation })} />}
      <button type="button" className="scene-rotate-placement" onClick={() => updatePlacementOptions({ rotation: pending.rotation + Math.PI / 2 })} title="Rotate 90° (R)" aria-label="Rotate placement 90 degrees"><AppIcon name="rotate" size={16} />{Math.round(((pending.rotation * 180 / Math.PI) % 360 + 360) % 360)}°</button>
    </div> : <DimensionInput label="Point elevation" value={pending.elevation ?? 0} onCommit={elevation => updatePlacementOptions({ elevation })} />}
    <div className="scene-placement-footer">
      <span role="status">{connection ? 'Snap · ' + connection.label.toLowerCase() : drawing ? last ? 'Click next point · Enter to finish' : 'Click a start point' : shaping ? (pending.drag ? 'Drag to adjust' : 'Click to extend') + ' · Shift for 45°' : 'Click to place · R to rotate'}</span>
      {(pending.operation === 'insert' || pending.operation === 'duplicate') && <label><input type="checkbox" checked={pending.repeat} onChange={event => updatePlacementOptions({ repeat: event.target.checked })} />Repeat</label>}
    </div>
    {(drawing || connection) && pending.prototype.kind === 'containment' && <label className="scene-join-choice"><input type="checkbox" checked={!!pending.keepJoined} onChange={event => updatePlacementOptions({ keepJoined: event.target.checked })} />Keep connections joined</label>}
  </div>;
}
