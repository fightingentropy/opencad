import type { ContainmentEntity } from '../types';
import { useStore } from '../state/store';
import { focusInstallation } from './InstallationPanel';
import './containment-workspace.css';
import { AppIcon } from './AppIcon';
import { runCommand } from '../lib/commands';

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
    <div className="containment-outline-heading"><h1>Objects <span>{routes.length}</span></h1><button type="button" aria-label="Add component" title="Add component (⌘K)" onClick={() => runCommand('help.palette')}><AppIcon name="plus" size={17} /></button></div>
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
      <div className="containment-outline-label"><span>Properties</span><span className="containment-property-actions"><button type="button" onClick={() => focusInstallation(selected.id)} aria-label="Focus route" title="Focus route"><AppIcon name="focus" size={15} /></button><button type="button" onClick={() => useStore.getState().clearSelection()} aria-label="Clear selection" title="Clear selection"><AppIcon name="close" size={15} /></button></span></div>
      <dl>
        <div><dt>Width</dt><dd>{selected.width} mm</dd></div>
        <div><dt>Depth</dt><dd>{selected.height} mm</dd></div>
        <div><dt>Length</dt><dd>{(routeLength(selected) / 1000).toFixed(2)} m</dd></div>
        {selected.finish ? <div><dt>Finish</dt><dd>{selected.finish.replaceAll('-', ' ')}</dd></div> : selected.material ? <div><dt>Material</dt><dd>{selected.material.replaceAll('-', ' ')}</dd></div> : null}
      </dl>
    </section> : null}
  </aside>;
}
