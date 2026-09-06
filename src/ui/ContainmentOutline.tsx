import type { ContainmentEntity } from '../types';
import { useStore } from '../state/store';
import { focusInstallation } from './InstallationPanel';
import './containment-workspace.css';

const names: Record<string, string> = { tray: 'Cable tray', trunking: 'Trunking', basket: 'Wire basket' };
const routeLength = (entity: ContainmentEntity) => entity.points.reduce((sum, point, i, points) =>
  i ? sum + Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) : sum, 0);

export function ContainmentOutline() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.editor.selection);
  const sheet = project.sheets[project.activeSheetId];
  const routes = (sheet?.entityOrder ?? []).flatMap((id) => {
    const entity = sheet.entities[id];
    return entity?.kind === 'containment' && ['tray', 'trunking', 'basket'].includes(entity.containmentType) ? [entity] : [];
  });
  const selected = routes.find((route) => selection.has(route.id));
  return <aside className="containment-outline" aria-label="Containment outline">
    <div className="containment-outline-heading"><h1>Containment layout</h1><p>Open tops · dimensions in mm</p></div>
    <div className="containment-outline-label">Routes <span>{routes.length}</span></div>
    <div className="containment-route-list">{routes.map((route) => <button
      type="button" key={route.id} aria-label={`Inspect ${names[route.containmentType]}`}
      aria-pressed={selection.has(route.id)} className={selection.has(route.id) ? 'selected' : ''}
      onClick={() => useStore.getState().setSelection([route.id])}
    >
      <svg viewBox="0 0 36 28" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M5 6v16h26V6" />
        {route.containmentType === 'basket' ? <path d="M5 12h26M5 17h26M11 6v16M18 6v16M25 6v16" /> : route.containmentType === 'tray' ? <path d="M10 19h3m3 0h3m3 0h3M5 6h3m20 0h3" /> : <path d="M5 6h3m20 0h3" />}
      </svg>
      <span><strong>{names[route.containmentType]}</strong><small>{route.width} × {route.height} mm</small></span>
    </button>)}</div>
    {selected ? <section className="containment-properties" aria-label="Route properties">
      <div className="containment-outline-label">Selected route <button type="button" onClick={() => useStore.getState().clearSelection()} aria-label="Clear selection">×</button></div>
      <dl>
        <div><dt>Type</dt><dd>{names[selected.containmentType]}</dd></div>
        <div><dt>Width</dt><dd>{selected.width} mm</dd></div>
        <div><dt>Depth</dt><dd>{selected.height} mm</dd></div>
        <div><dt>Route length</dt><dd>{(routeLength(selected) / 1000).toFixed(2)} m</dd></div>
        <div><dt>Finish</dt><dd>{selected.finish ? selected.finish.replaceAll('-', ' ') : 'Unspecified'}</dd></div>
        <div><dt>Top</dt><dd>Open</dd></div>
      </dl>
      <button type="button" className="containment-focus" onClick={() => focusInstallation(selected.id)}>Focus route</button>
    </section> : <p className="containment-selection-hint">Select a route to inspect its dimensions.</p>}
    <div className="containment-outline-footer">Drag to orbit<br />Scroll to zoom · Right-drag to pan</div>
  </aside>;
}
