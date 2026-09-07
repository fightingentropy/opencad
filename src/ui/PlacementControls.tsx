import { cancelComponentPlacement, updatePlacementOptions, useComponentPlacement } from '../state/component-placement';
import { DimensionInput } from './DimensionInput';
import { AppIcon } from './AppIcon';

export function PlacementControls() {
  const pending = useComponentPlacement(state => state.pending);
  const connection = useComponentPlacement(state => state.connection);
  if (pending?.surface !== '3d') return null;
  const shaping = pending.operation === 'endpoint' || pending.operation === 'extend';
  return <div className="scene-placement-controls" role="region" aria-label="Placement controls">
    <div className="scene-placement-title"><span>{pending.operation === 'move' ? 'Move part' : shaping ? 'Adjust route' : pending.component.title}</span>
      <button type="button" aria-label="Cancel placement" title="Cancel placement (Esc)" onClick={() => cancelComponentPlacement()}><AppIcon name="close" size={15} /></button></div>
    {!shaping && <div className="scene-placement-fields">
      {pending.length != null && <DimensionInput key={'length:' + pending.length} label="Length" value={pending.length} onCommit={length => updatePlacementOptions({ length })} />}
      {pending.elevation != null && <DimensionInput key={'elevation:' + pending.elevation} label="Elevation" value={pending.elevation} onCommit={elevation => updatePlacementOptions({ elevation })} />}
      <button type="button" className="scene-rotate-placement" onClick={() => updatePlacementOptions({ rotation: pending.rotation + Math.PI / 2 })} title="Rotate 90° (R)" aria-label="Rotate placement 90 degrees"><AppIcon name="rotate" size={16} />{Math.round(((pending.rotation * 180 / Math.PI) % 360 + 360) % 360)}°</button>
    </div>}
    <div className="scene-placement-footer">
      <span role="status">{connection ? 'Snap · ' + connection.label.toLowerCase() : shaping ? (pending.drag ? 'Drag to adjust' : 'Click to extend') + ' · Shift for 45°' : 'Click to place · R to rotate'}</span>
      {(pending.operation === 'insert' || pending.operation === 'duplicate') && <label><input type="checkbox" checked={pending.repeat} onChange={event => updatePlacementOptions({ repeat: event.target.checked })} />Repeat</label>}
    </div>
  </div>;
}
