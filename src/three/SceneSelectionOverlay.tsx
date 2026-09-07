import { useEffect, useState, type RefObject } from 'react';
import * as THREE from 'three';
import type { Project, Vec2 } from '../types';
import { isPhysicalEntity, physicalAnchor, physicalElevation } from '../lib/scene-edit';
import { beginEntityPlacement, componentPlacementPreview, useComponentPlacement } from '../state/component-placement';
import { physicalEditProblem, rotatePhysicalEntity } from '../state/scene-actions';
import { useStore } from '../state/store';
import { AppIcon } from '../ui/AppIcon';
import { entitySceneRoots } from './InstallationAppearance';

interface Mark { x: number; y: number; label?: string; index?: number; kind: 'point' | 'move' | 'label' | 'snap'; }
interface OverlayState { marks: Mark[]; line: string; }
const visibleInScene = (object: THREE.Object3D) => {
  for (let part: THREE.Object3D | null = object; part; part = part.parent) if (!part.visible) return false;
  return true;
};

export function SceneSelectionOverlay({ project, selection, cameraRef, mountRef, rootRef }: {
  project: Project; selection: ReadonlySet<string>;
  cameraRef: RefObject<THREE.PerspectiveCamera>; mountRef: RefObject<HTMLDivElement>; rootRef: RefObject<THREE.Group>;
}) {
  const pending = useComponentPlacement(state => state.pending);
  const position = useComponentPlacement(state => state.position);
  const connection = useComponentPlacement(state => state.connection);
  const [overlay, setOverlay] = useState<OverlayState>({ marks: [], line: '' });
  const sheet = project.sheets[project.activeSheetId];
  const selected = selection.size === 1 ? sheet?.entities[[...selection][0]] : undefined;
  const entity = isPhysicalEntity(selected) ? selected : undefined;
  const disabled = !entity || !!physicalEditProblem(entity, project);

  useEffect(() => {
    let frame = 0;
    let last = '';
    const update = () => {
      const camera = cameraRef.current;
      const mount = mountRef.current;
      const root = rootRef.current;
      const candidate = pending && position ? componentPlacementPreview(position) : entity;
      const marks: Mark[] = [];
      let line = '';
      const displayed = candidate && isPhysicalEntity(candidate) ? candidate : null;
      if (camera && mount && root && displayed) {
        const rendered = pending ? null : entitySceneRoots(root).find(part => part.userData.entityId === displayed.id);
        const show = pending || (rendered && visibleInScene(rendered));
        if (show) {
          const floor = sheet?.floorId ? project.floors?.[sheet.floorId] : undefined;
          const building = floor ? project.buildings?.[floor.buildingId] : undefined;
          const floorObject = root.getObjectByName('floor:' + floor?.id);
          const origin = floorObject?.getWorldPosition(new THREE.Vector3())
            ?? new THREE.Vector3(building?.gridOriginX ?? 0, building?.gridOriginY ?? 0, floor?.ffl ?? 0);
          const elevation = physicalElevation(displayed, project);
          const top = displayed.kind === 'containment' ? (displayed.height ?? displayed.width ?? 30) : 0;
          const projectPoint = (point: Vec2): Vec2 | null => {
            const vector = new THREE.Vector3(point.x + origin.x, point.y + origin.y, elevation + origin.z + top + 3).project(camera);
            if (vector.z < -1 || vector.z > 1) return null;
            return { x: Math.round((vector.x + 1) / 2 * mount.clientWidth), y: Math.round((1 - vector.y) / 2 * mount.clientHeight) };
          };
          const anchor = projectPoint(physicalAnchor(displayed));
          if (anchor && !pending && !disabled) marks.push({ ...anchor, kind: 'move' });
          if (displayed.kind === 'containment') {
            const points = displayed.points.map(projectPoint);
            line = points.filter((point): point is Vec2 => !!point).map(point => point.x + ',' + point.y).join(' ');
            if (!pending && !disabled) points.forEach((point, index) => { if (point) marks.push({ ...point, index, kind: 'point' }); });
            displayed.points.slice(1).forEach((point, index) => {
              const a = displayed.points[index];
              const middle = projectPoint({ x: (a.x + point.x) / 2, y: (a.y + point.y) / 2 });
              const pa = points[index], pb = points[index + 1];
              if (middle && pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) > 90) marks.push({
                x: middle.x, y: middle.y - 17, kind: 'label', label: (Math.hypot(point.x - a.x, point.y - a.y) / 1000).toFixed(2) + ' m',
              });
            });
          }
          if (connection) {
            const snap = projectPoint(connection.target);
            if (snap) marks.push({ ...snap, kind: 'snap', label: connection.label });
          }
        }
      }
      const next = { marks, line };
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setOverlay(next); }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [project, selection, entity, disabled, pending, position, connection, sheet, cameraRef, mountRef, rootRef]);

  useEffect(() => {
    if (!entity || disabled || pending) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.matches('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); event.stopImmediatePropagation(); rotatePhysicalEntity(entity.id);
      } else if (key === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); event.stopImmediatePropagation(); beginEntityPlacement(entity.id, 'move');
      } else if (key === 'd' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); event.stopImmediatePropagation(); beginEntityPlacement(entity.id, 'duplicate');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [entity, disabled, pending]);

  return <>
    <div className="scene-selection-overlay" aria-label="Selection measurements">
      {overlay.line && <svg className="scene-route-guide" aria-hidden="true"><polyline points={overlay.line} /></svg>}
      {overlay.marks.map((mark, index) => mark.kind === 'point' || mark.kind === 'move'
        ? <button type="button" key={mark.kind + ':' + mark.index} className={'scene-edit-handle ' + mark.kind}
          style={{ left: mark.x, top: mark.y }} aria-label={mark.kind === 'move' ? 'Drag to move part' : 'Drag route point ' + ((mark.index ?? 0) + 1)}
          title={mark.kind === 'move' ? 'Drag to move' : 'Drag to reshape · Shift for 45°'}
          onPointerDown={event => {
            if (event.button !== 0 || !entity || disabled) return;
            event.preventDefault(); event.stopPropagation();
            const canvas = mountRef.current?.querySelector('canvas');
            if (beginEntityPlacement(entity.id, mark.kind === 'move' ? 'move' : 'endpoint', mark.index, {
              pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
            })) canvas?.setPointerCapture(event.pointerId);
          }}>{mark.kind === 'move' && <AppIcon name="move" size={13} />}</button>
        : <span key={mark.kind + ':' + index} className={'scene-measurement ' + mark.kind} style={{ left: mark.x, top: mark.y }}>{mark.label}</span>)}
    </div>
    {entity && !pending && <div className="scene-selection-tools" role="toolbar" aria-label="Edit selected part">
      <button type="button" disabled={disabled} onClick={() => beginEntityPlacement(entity.id, 'move')} title="Move (G)"><AppIcon name="move" size={16} />Move</button>
      <button type="button" disabled={disabled} onClick={() => rotatePhysicalEntity(entity.id)} title="Rotate 90° (R)" aria-label="Rotate part 90 degrees"><AppIcon name="rotate" size={16} /></button>
      <button type="button" disabled={disabled} onClick={() => beginEntityPlacement(entity.id, 'duplicate')} title="Duplicate (⌘D)" aria-label="Duplicate part"><AppIcon name="duplicate" size={16} /></button>
      {entity.kind === 'containment' && <details className="scene-extend-menu"><summary aria-label="Extend route" title="Extend route"><AppIcon name="extend" size={16} /></summary>
        <div><button type="button" disabled={disabled} onClick={() => beginEntityPlacement(entity.id, 'extend', entity.points.length - 1)}>Extend end</button>
          <button type="button" disabled={disabled} onClick={() => beginEntityPlacement(entity.id, 'extend', 0)}>Extend start</button></div>
      </details>}
      <span className="scene-tool-divider" />
      <button type="button" onClick={() => useStore.getState().clearSelection()} title="Clear selection" aria-label="Finish editing part"><AppIcon name="close" size={15} /></button>
    </div>}
  </>;
}
