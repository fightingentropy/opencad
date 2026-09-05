import { useEffect, useMemo, useState } from 'react';
import type { Entity, Project } from '../types';
import { useStore } from '../state/store';
import { installationStatus, installationActivities, type InstallationStatus } from '../models/installation';
import { setInstallationStatus, addInstallationComment } from '../state/installation-actions';
import { shouldRejectLocalProjectMutation } from '../state/collaboration-guard';
import './installation.css';

export const STATUS_LABELS: Record<InstallationStatus, string> = { planned: 'Planned', 'in-progress': 'In progress', completed: 'Completed' };
export const isInstallationEntity = (e: Entity): boolean => ['containment', 'equipment', 'support', 'fitting', 'riser', 'penetration', 'fire-barrier', 'symbol', 'wire'].includes(e.kind);
export const assetLabel = (e: Entity): string => ('tag' in e && e.tag) || ('label' in e && e.label) || `${e.kind} · ${e.id.slice(0, 6)}`;
export const installationAssets = (project: Project) => project.sheetOrder.flatMap((sheetId) => {
  const sheet = project.sheets[sheetId];
  return sheet ? sheet.entityOrder.flatMap((id) => {
    const entity = sheet.entities[id];
    return entity && isInstallationEntity(entity) ? [{ entity, sheetId, floor: project.floors?.[sheet.floorId ?? '']?.name ?? sheet.name }] : [];
  }) : [];
});

export function focusInstallation(entityId: string, isolate = false) {
  window.dispatchEvent(new CustomEvent('opencad:focus-entity', { detail: { entityId, isolate } }));
}

function selectAsset(sheetId: string, entityId: string, focus = true) {
  const state = useStore.getState();
  if (state.project.activeSheetId !== sheetId) state.setActiveSheet(sheetId);
  state.setSelection([entityId]);
  if (focus) requestAnimationFrame(() => focusInstallation(entityId));
}

export function InstallationBrowser() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.editor.selection);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [floor, setFloor] = useState('all');
  const assets = useMemo(() => installationAssets(project), [project]);
  const counts = assets.reduce((out, a) => { out[installationStatus(a.entity)]++; return out; }, { planned: 0, 'in-progress': 0, completed: 0 });
  const completed = assets.length ? Math.round(counts.completed / assets.length * 100) : 0;
  const filtered = assets.filter(({ entity, floor: assetFloor }) =>
    (kind === 'all' || entity.kind === kind) && (status === 'all' || installationStatus(entity) === status) &&
    (floor === 'all' || floor === assetFloor) && `${assetLabel(entity)} ${entity.kind} ${'description' in entity ? entity.description : ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="installation-browser">
    <div className="installation-heading"><span className="eyebrow">PROJECT EXPLORER</span><h2>Installation model</h2><p>{project.name}</p></div>
    <div className="installation-progress"><div><strong>{completed}<small>%</small></strong><span>installation completed<br />{counts.completed} of {assets.length} components</span></div>
      <div className="installation-progress-track" role="progressbar" aria-label="Installation completed" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${completed}%` }} /></div>
      <div className="installation-counts"><span><i className="status-dot completed" />{counts.completed} done</span><span><i className="status-dot in-progress" />{counts['in-progress']} active</span><span><i className="status-dot planned" />{counts.planned} planned</span></div>
    </div>
    <div className="asset-filters">
      <input aria-label="Search components" placeholder="Search tag, equipment, route…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select aria-label="Component floor" value={floor} onChange={(e) => setFloor(e.target.value)}><option value="all">All floors</option>{[...new Set(assets.map((a) => a.floor))].map((name) => <option key={name}>{name}</option>)}</select>
      <div><select aria-label="Component type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All components</option>{[...new Set(assets.map((a) => a.entity.kind))].map((k) => <option value={k} key={k}>{k}</option>)}</select>
        <select aria-label="Component status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All states</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></div>
    </div>
    <div className="asset-list-heading"><span>COMPONENTS</span><span>{filtered.length}</span></div>
    <div className="asset-list">{filtered.slice(0, 200).map(({ entity, sheetId, floor: name }) => <button type="button" className={`asset-row${selection.has(entity.id) ? ' selected' : ''}`} key={`${sheetId}:${entity.id}`} onClick={() => selectAsset(sheetId, entity.id)} aria-label={`Inspect ${assetLabel(entity)}`}>
      <span className={`asset-glyph ${entity.kind}`}>{entity.kind === 'equipment' ? '▥' : entity.kind === 'containment' ? '⤴' : '◇'}</span><span><strong>{assetLabel(entity)}</strong><small>{entity.kind === 'equipment' ? entity.equipmentKind.replaceAll('-', ' ') : entity.kind} · {name}</small></span><i className={`status-dot ${installationStatus(entity)}`} title={STATUS_LABELS[installationStatus(entity)]} />
    </button>)}{!filtered.length && <p className="installation-empty">No components match these filters.</p>}{filtered.length > 200 && <p className="installation-empty">Showing 200 of {filtered.length}. Search or filter to narrow the list.</p>}</div>
    <div className="installation-footnote">Select a component to locate it in 3D.</div>
  </div>;
}

function assetFacts(entity: Entity, project: Project): [string, string][] {
  const rows: [string, string][] = [['Type', entity.kind === 'equipment' ? entity.equipmentKind.replaceAll('-', ' ') : entity.kind]];
  const system = entity.systemId && project.systems?.[entity.systemId];
  if (system) rows.push(['System', system.name]);
  if (entity.kind === 'equipment') {
    rows.push(['Footprint', `${Math.round(Math.abs(entity.b.x - entity.a.x))} × ${Math.round(Math.abs(entity.b.y - entity.a.y))} mm`]);
    if (entity.height) rows.push(['Height', `${entity.height} mm`]);
    if (entity.ratedCurrent) rows.push(['Rated current', `${entity.ratedCurrent} A`]);
    if (entity.ratedVoltage) rows.push(['Rated voltage', `${entity.ratedVoltage} V`]);
    if (entity.shortCircuitRating) rows.push(['Fault rating', `${entity.shortCircuitRating} kA`]);
    if (entity.ipRating) rows.push(['Protection', entity.ipRating]);
    if (entity.manufacturer) rows.push(['Manufacturer', entity.manufacturer]);
    if (entity.partNumber) rows.push(['Part number', entity.partNumber]);
  }
  if (entity.kind === 'containment') {
    const length = entity.points.reduce((sum, p, i, points) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0, 0);
    rows.push(['Section', entity.containmentType === 'conduit' ? `Ø${entity.width ?? 25} mm` : `${entity.width ?? 100} × ${entity.height ?? 50} mm`], ['Route length', `${(length / 1000).toFixed(2)} m`], ['Containment', entity.containmentType]);
    if (entity.material) rows.push(['Material', entity.material.replaceAll('-', ' ')]);
  }
  if (entity.kind === 'support') {
    rows.push(['Support', entity.supportKind.replaceAll('-', ' ')]);
    if (entity.channelLength) rows.push(['Channel span', `${entity.channelLength} mm`]);
    if (entity.rodLength) rows.push(['Rod length', `${entity.rodLength} mm`]);
    if (entity.safeWorkingLoadKg) rows.push(['Rated working load', `${entity.safeWorkingLoadKg} kg`]);
    if (entity.anchorType) rows.push(['Anchor', entity.anchorType.replaceAll('-', ' ')]);
  }
  if (entity.kind === 'fitting') {
    rows.push(['Fitting', entity.fittingKind.replaceAll('-', ' ')]);
    if (entity.width && entity.height) rows.push(['Section', `${entity.width} × ${entity.height} mm`]);
    if (entity.angleDeg) rows.push(['Sweep', `${entity.angleDeg}°`]);
    if (entity.catalogPartNumber) rows.push(['Part number', entity.catalogPartNumber]);
  }
  if (entity.kind === 'penetration') {
    const seal = project.penetrationSeals?.[entity.sealId];
    if (seal) {
      rows.push(['Seal reference', seal.reference], ['Recorded status', seal.status]);
      if (seal.requiredRating) rows.push(['Required fire rating', `${seal.requiredRating} min`]);
      if (seal.achievedRating) rows.push(['Recorded fire rating', `${seal.achievedRating} min`]);
    }
  }
  if ('elevation' in entity && entity.elevation != null) rows.push(['Above floor', `${entity.elevation} mm`]);
  if (entity.phase) rows.push(['Construction phase', entity.phase]);
  return rows;
}

export function InstallationPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.editor.selection);
  const [tab, setTab] = useState<'details' | 'timeline'>('details');
  const assets = useMemo(() => installationAssets(project), [project]);
  useEffect(() => setTab('details'), [selection]);
  const selected = assets.find((a) => a.sheetId === project.activeSheetId && selection.has(a.entity.id))
    ?? assets.find((a) => selection.has(a.entity.id));
  return <div className="installation-inspector">
    <div className="installation-heading"><span className="eyebrow">INSTALLATION WORKSPACE</span><h2>{tab === 'timeline' ? 'Project timeline' : 'Component inspector'}</h2></div>
    <div className="installation-tabs"><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Component</button><button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>Timeline</button></div>
    <div className="installation-inspector-body" key={`${tab}:${selected?.sheetId}:${selected?.entity.id}`}>{tab === 'timeline' ? <ActivityTimeline project={project} /> : selected ? <ComponentDetails key={`${project.id}:${selected.sheetId}:${selected.entity.id}`} project={project} {...selected} /> : <div className="installation-empty large"><span>◇</span><h3>Select a component</h3><p>Select equipment, a route, or a support in the model or explorer to view its specifications, record progress, and add site notes.</p><button onClick={() => setTab('timeline')}>View project timeline</button></div>}</div>
  </div>;
}

function ComponentDetails({ entity, sheetId, floor, project }: { entity: Entity; sheetId: string; floor: string; project: Project }) {
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState('');
  const status = installationStatus(entity);
  const readOnly = shouldRejectLocalProjectMutation();
  const cables = Object.values(project.cableSchedule?.cables ?? {}).filter((c) => c.fromEntityId === entity.id || c.toEntityId === entity.id || c.route?.includes(entity.id));
  return <>
    <div className="asset-detail-title"><span className={`status-pill ${status}`}>{STATUS_LABELS[status]}</span><h3>{assetLabel(entity)}</h3><p>{floor}</p>{'description' in entity && entity.description && <p>{entity.description}</p>}</div>
    <div className="asset-view-actions"><button onClick={() => focusInstallation(entity.id)}>◎ Focus in 3D</button><button onClick={() => focusInstallation(entity.id, true)}>Isolate part</button></div>
    <section className="installation-section"><h4>INSTALLATION STATUS</h4><div className="installation-status-options">{Object.entries(STATUS_LABELS).map(([key, label]) => <button disabled={readOnly || status === key} className={status === key ? `active ${key}` : ''} aria-pressed={status === key} key={key} onClick={() => { if (!setInstallationStatus(sheetId, entity.id, key as InstallationStatus)) setFeedback('The status could not be updated.'); else setFeedback('Status saved to the timeline.'); }}><i className={`status-dot ${key}`} />{label}</button>)}</div><p className="installation-hint">Completed parts retain full colour. Unfinished parts appear muted in Progress view.</p></section>
    <section className="installation-section"><h4>SPECIFICATIONS</h4><dl className="asset-facts">{assetFacts(entity, project).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{entity.kind === 'equipment' && <p className="installation-hint">Enclosure internals are illustrative. Ratings and connections use the project records.</p>}</section>
    {cables.length > 0 && <section className="installation-section"><h4>CONNECTED CABLES <span>{cables.length}</span></h4><div className="asset-cables">{cables.map((c) => <details key={c.id}><summary>{c.reference}<small>{c.cores}C × {c.csa} mm²</small></summary><p>{c.from} → {c.to}</p><p>{c.construction} · Ø{c.outerDiameter} mm</p></details>)}</div></section>}
    <section className="installation-section"><h4>SITE NOTES & COMMENTS</h4><form onSubmit={(event) => { event.preventDefault(); if (addInstallationComment(sheetId, entity.id, comment)) { setComment(''); setFeedback('Comment saved.'); } else setFeedback('Could not save this comment. Check edit access and the text length.'); }}>
      <textarea aria-label="Component comment" placeholder="Record an observation, snag, or handover note…" maxLength={4000} value={comment} disabled={readOnly} onChange={(event) => setComment(event.target.value)} rows={3} />
      <div className="comment-submit"><small>{readOnly ? 'View-only access' : 'Saved with this component'}</small><button className="primary" type="submit" disabled={readOnly || !comment.trim()}>Add comment</button></div>
      <p role="status" className="installation-feedback">{feedback}</p>
    </form></section>
    <ActivityTimeline project={project} entityId={entity.id} sheetId={sheetId} />
  </>;
}

function ActivityTimeline({ project, entityId, sheetId }: { project: Project; entityId?: string; sheetId?: string }) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(150);
  const allEvents = useMemo(() => installationActivities(project), [project]);
  useEffect(() => setLimit(150), [filter, entityId, sheetId]);
  const events = allEvents.filter((event) => (!entityId || (event.entityId === entityId && event.sheetId === sheetId)) && (filter === 'all' || event.kind === filter));
  return <section className="installation-section activity-section"><div className="activity-title"><h4>{entityId ? 'COMPONENT HISTORY' : 'PROGRESS & COMMENTS'}</h4><select aria-label="Timeline event type" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All events</option><option value="status">Progress</option><option value="comment">Comments</option></select></div>
    {!events.length ? <p className="installation-empty">No {filter === 'all' ? 'activity' : filter === 'status' ? 'progress updates' : 'comments'} yet. Updates appear here as work is recorded.</p> : <ol className="activity-timeline">{events.slice(0, limit).map((event) => <li key={`${event.sheetId}:${event.entityId}:${event.id}`}><i className={`timeline-dot ${event.kind === 'status' ? event.status : 'comment'}`} /><time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      {!entityId && <button className="activity-asset" onClick={() => selectAsset(event.sheetId, event.entityId)}>{event.entityLabel}</button>}
      {event.kind === 'comment' ? <p className="activity-comment">{event.text}</p> : <p className="activity-status">{event.previousStatus ? `${STATUS_LABELS[event.previousStatus]} → ` : ''}<strong>{STATUS_LABELS[event.status]}</strong></p>}
      {event.author && <small>{event.author}</small>}
    </li>)}</ol>}{events.length > limit && <button className="activity-load-more" onClick={() => setLimit((value) => value + 150)}>Load earlier events ({events.length - limit})</button>}
  </section>;
}
