import { useEffect, useMemo, useState, type RefObject } from 'react';
import * as THREE from 'three';
import type { Entity, Project } from '../types';
import { analyzeSceneClearance, boxCorners, DEFAULT_ACCESS_MM, DEFAULT_CLEARANCE_MM, type ClearanceIssue } from '../lib/scene-clearance';
import { keepRouteConnections } from '../lib/route-connections';
import { componentPlacementPreview, useComponentPlacement } from '../state/component-placement';
import { useStore } from '../state/store';
import { shouldRejectLocalProjectMutation } from '../state/collaboration-guard';
import { DimensionInput } from '../ui/DimensionInput';

export function SceneClearanceOverlay({ project, selection, cameraRef, mountRef, rootRef }: {
  project: Project; selection: ReadonlySet<string>; cameraRef: RefObject<THREE.PerspectiveCamera>;
  mountRef: RefObject<HTMLDivElement>; rootRef: RefObject<THREE.Group>;
}) {
  const pending = useComponentPlacement(state => state.pending);
  const position = useComponentPlacement(state => state.position);
  const [marks, setMarks] = useState<{ id: string; paths: string[]; x: number; y: number; label: string; kind: string }[]>([]);
  const evaluated = useMemo(() => {
    const sheet = project.sheets[project.activeSheetId];
    let candidate = pending && position ? componentPlacementPreview(position) : sheet?.entities[[...selection][0]];
    if (!candidate || !['containment', 'equipment', 'wall'].includes(candidate.kind)) return null;
    candidate = { ...candidate, id: pending?.source?.id ?? pending?.prototype.id ?? candidate.id };
    let staged = project;
    let related: Entity[] = [];
    let problem = '';
    if (pending?.source) {
      try {
        const result = keepRouteConnections(project, { ...project, sheets: { ...project.sheets,
          [sheet.id]: { ...sheet, entities: { ...sheet.entities, [candidate.id]: candidate } } } }, [candidate.id]);
        staged = result.project;
        candidate = staged.sheets[sheet.id].entities[candidate.id];
        related = result.changedIds.filter(id => id !== candidate!.id).map(id => staged.sheets[sheet.id].entities[id]);
      } catch (error) { problem = error instanceof Error ? error.message : 'The joined route cannot follow this move.'; }
    }
    const seen = new Set<string>();
    const issues = [candidate, ...related].flatMap(entity => analyzeSceneClearance(staged, entity)).filter(issue => {
      const key = [issue.sourceId, issue.targetId].sort().join(':') + ':' + issue.kind;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => a.gap - b.gap);
    return { issues, problem };
  }, [project, selection, pending, position]);
  const visible = evaluated?.issues.slice(0, 3);

  useEffect(() => {
    let frame = 0, previous = '';
    const update = () => {
      const camera = cameraRef.current, mount = mountRef.current, root = rootRef.current;
      const next: typeof marks = [];
      if (camera && mount && root) {
        const sheet = project.sheets[project.activeSheetId];
        const floor = project.floors?.[sheet.floorId ?? ''];
        const building = project.buildings?.[floor?.buildingId ?? sheet.buildingId ?? ''];
        const origin = root.getObjectByName('floor:' + floor?.id)?.getWorldPosition(new THREE.Vector3())
          ?? new THREE.Vector3(building?.gridOriginX ?? 0, building?.gridOriginY ?? 0, floor?.ffl ?? 0);
        const projectPoint = (point: { x: number; y: number; z: number }) => {
          const p = new THREE.Vector3(point.x, point.y, point.z).add(origin).project(camera);
          return p.z < -1 || p.z > 1 ? null : { x: Math.round((p.x + 1) / 2 * mount.clientWidth), y: Math.round((1 - p.y) / 2 * mount.clientHeight) };
        };
        for (const issue of visible ?? []) {
          const paths: string[] = [];
          for (const box of [issue.sourceBox, issue.targetBox]) {
            const corners = boxCorners(box).map(projectPoint);
            corners.forEach((a, i) => [0, 1, 2].forEach(axis => {
              const b = corners[i | (1 << axis)];
              if (!(i & (1 << axis)) && a && b) paths.push(`M${a.x},${a.y}L${b.x},${b.y}`);
            }));
          }
          const from = projectPoint(issue.from), to = projectPoint(issue.to);
          if (from && to) {
            paths.push(`M${from.x},${from.y}L${to.x},${to.y}`);
            next.push({ id: issue.id, paths, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 12, kind: issue.kind,
              label: issue.kind === 'access' ? 'Access space' : issue.kind === 'overlap' ? 'Overlap' : Math.round(issue.gap) + ' mm' });
          }
        }
      }
      const key = JSON.stringify(next);
      if (key !== previous) { previous = key; setMarks(next); }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [evaluated, project, cameraRef, mountRef, rootRef]);

  if (!evaluated) return null;
  const describe = (issue: ClearanceIssue) => issue.kind === 'access' ? 'Access space occupied' : issue.kind === 'overlap' ? 'Overlap' : Math.round(issue.gap) + ' mm gap';
  const updateGuide = (key: 'clearanceMm' | 'equipmentAccessMm', value: number) => {
    if (value < 0 || value > 10000 || shouldRejectLocalProjectMutation()) return false;
    useStore.getState().setProjectPatch({ coordination: { ...project.coordination, [key]: value } });
    return true;
  };
  return <>
    <div className="scene-clearance-overlay" aria-hidden="true">
      <svg>{marks.map(mark => <path key={mark.id} className={mark.kind} d={mark.paths.join(' ')} />)}</svg>
      {marks.map(mark => <span className={'scene-clearance-label ' + mark.kind} key={mark.id} style={{ left: mark.x, top: mark.y }}>{mark.label}</span>)}
    </div>
    <details className={'scene-clearance-card' + (evaluated.issues.length || evaluated.problem ? ' has-issues' : '')} open>
      <summary>Clearances <span>{evaluated.problem ? 'Connection blocked' : evaluated.issues.length ? evaluated.issues.length + ' to review' : 'No conflicts'}</span></summary>
      {evaluated.problem && <p className="scene-clearance-problem" role="status">{evaluated.problem}</p>}
      {visible?.map(issue => <button type="button" key={issue.id} disabled={!!pending} className={'scene-clearance-row ' + issue.kind}
        onClick={() => useStore.getState().setSelection([issue.targetId])}>
        <span>{issue.targetLabel}</span><strong>{describe(issue)}</strong>
      </button>)}
      {evaluated.issues.length > 3 && <p>+{evaluated.issues.length - 3} more in the clearance report</p>}
      <details className="scene-clearance-settings"><summary>Guides · {project.coordination?.clearanceMm ?? DEFAULT_CLEARANCE_MM} mm</summary>
        <DimensionInput label="Clearance guide" value={project.coordination?.clearanceMm ?? DEFAULT_CLEARANCE_MM} disabled={!!pending}
          onCommit={value => updateGuide('clearanceMm', value)} />
        <DimensionInput label="Equipment access" value={project.coordination?.equipmentAccessMm ?? DEFAULT_ACCESS_MM} disabled={!!pending}
          onCommit={value => updateGuide('equipmentAccessMm', value)} />
        <p>Project guides. Check final spacing and working space against the selected equipment. Curved bends use leg envelopes.</p>
      </details>
    </details>
  </>;
}
