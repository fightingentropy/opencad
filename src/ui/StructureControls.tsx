import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { Project, WallEntity } from '../types';
import { useStore } from '../state/store';
import { shouldRejectLocalProjectMutation } from '../state/collaboration-guard';
import { isPhysicalEntity, physicalAnchor } from '../lib/scene-edit';
import { DimensionInput } from './DimensionInput';
import { notify } from '../state/notifications';

const valuesFor = (wall: WallEntity) => {
  const a = wall.points[0], b = wall.points.at(-1)!;
  return { x: a.x, y: a.y, length: Math.hypot(b.x - a.x, b.y - a.y), width: wall.thickness,
    height: wall.height ?? 3000, elevation: wall.elevation ?? 0, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
};
const valid = (values: ReturnType<typeof valuesFor>) => Object.values(values).every(Number.isFinite)
  && Math.abs(values.x) <= 1e6 && Math.abs(values.y) <= 1e6 && Math.abs(values.elevation) <= 1e5
  && values.length >= 10 && values.length <= 1e6 && values.width >= 10 && values.width <= 10000
  && values.height >= 10 && values.height <= 100000;
const shape = (wall: WallEntity, values: ReturnType<typeof valuesFor>): WallEntity => ({ ...wall,
  points: [{ x: values.x, y: values.y }, { x: values.x + Math.cos(values.angle * Math.PI / 180) * values.length,
    y: values.y + Math.sin(values.angle * Math.PI / 180) * values.length }],
  thickness: values.width, height: values.height, elevation: values.elevation,
});
const labels = { x: 'Start X', y: 'Start Y', length: 'Length', width: 'Width', height: 'Height', elevation: 'Bottom elevation', angle: 'Rotation' };

export function StructureControls({ project, selection }: { project: Project; selection: ReadonlySet<string> }) {
  const sheet = project.sheets[project.activeSheetId];
  const walls = Object.values(sheet?.entities ?? {}).filter((e): e is WallEntity => e.kind === 'wall');
  const selected = walls.find(w => selection.has(w.id));
  const [adding, setAdding] = useState(false);
  const update = (key: keyof ReturnType<typeof valuesFor>, value: number) => {
    if (!selected || selected.points.length !== 2 || selected.locked || project.layers[selected.layerId]?.locked || shouldRejectLocalProjectMutation()) return false;
    const values = { ...valuesFor(selected), [key]: value };
    if (!valid(values)) return false;
    useStore.getState().updateEntity(selected.id, shape(selected, values)); return true;
  };
  return <>
    <details className="scene-structure-list">
      <summary>Structure <span>{walls.length || ''}</span></summary>
      {walls.map(wall => <button type="button" key={wall.id} aria-pressed={selection.has(wall.id)} onClick={() => useStore.getState().setSelection([wall.id])}>
        {wall.label || (wall.structuralRole === 'beam' ? 'Beam' : 'Wall')}<small>{wall.thickness} × {wall.height ?? 3000} mm</small>
      </button>)}
      <button type="button" className="scene-inline-action" disabled={shouldRejectLocalProjectMutation()} onClick={() => setAdding(true)}>+ Add beam or wall</button>
    </details>
    {selected && <section className="containment-properties" aria-label="Structure properties">
      <div className="containment-outline-label">{selected.label || (selected.structuralRole === 'beam' ? 'Beam' : 'Wall')}</div>
      {selected.points.length === 2 ? (Object.keys(labels) as (keyof typeof labels)[]).map(key => <DimensionInput key={selected.id + ':' + key}
        label={labels[key]} value={valuesFor(selected)[key]} unit={key === 'angle' ? '°' : 'mm'}
        disabled={selected.locked || project.layers[selected.layerId]?.locked || shouldRejectLocalProjectMutation()} onCommit={value => update(key, value)} />)
        : <p className="scene-check-note">Edit this wall’s individual points in the plan view.</p>}
    </section>}
    {adding && <AddStructureDialog project={project} onClose={() => setAdding(false)} />}
  </>;
}

function AddStructureDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const selected = project.sheets[project.activeSheetId].entities[[...useStore.getState().editor.selection][0]];
  const anchor = isPhysicalEntity(selected) ? physicalAnchor(selected) : { x: 0, y: 0 };
  const [role, setRole] = useState<'beam' | 'wall'>('beam');
  const [values, setValues] = useState({ x: anchor.x - 1500, y: anchor.y, length: 3000, width: 300, height: 400, elevation: 2600, angle: 0 });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  const add = () => {
    if (!valid(values) || shouldRejectLocalProjectMutation()) return;
    const state = useStore.getState(), layer = state.project.layers[state.project.activeLayerId];
    if (!layer || layer.locked || !layer.visible) { notify('warning', 'Choose a visible, unlocked layer before adding structure.'); return; }
    const wall = shape({ id: nanoid(), kind: 'wall', layerId: layer.id, visible: true, locked: false,
      points: [], thickness: values.width, structuralRole: role, construction: 'concrete', label: role === 'beam' ? 'Beam' : 'Wall' }, values);
    state.addEntity(wall); state.setSelection([wall.id]); onClose();
  };
  return <div className="scene-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={formRef} className="scene-structure-dialog" role="dialog" aria-modal="true" aria-label="Add structure" onSubmit={event => { event.preventDefault(); add(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button, select')].filter(e => !(e as HTMLButtonElement).disabled);
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next?.focus(); }
        }
      }}>
      <div className="scene-dialog-heading"><h2>Add structure</h2><button type="button" aria-label="Close structure dialog" onClick={onClose}>×</button></div>
      <label className="scene-dialog-field">Type<select value={role} onChange={event => { const role = event.target.value as 'beam' | 'wall'; setRole(role);
        setValues(values => ({ ...values, height: role === 'beam' ? 400 : 3000, elevation: role === 'beam' ? 2600 : 0 })); }}><option value="beam">Beam</option><option value="wall">Wall</option></select></label>
      <div className="scene-structure-fields">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <label key={key} className="scene-dialog-field">{labels[key]} ({key === 'angle' ? '°' : 'mm'})
        <input type="number" value={values[key]} step={key === 'angle' ? 90 : 100} onChange={event => setValues({ ...values, [key]: event.target.valueAsNumber })} required />
      </label>)}</div>
      <p>Use measured dimensions and the height above finished floor level.</p>
      <div className="scene-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!valid(values)}>Add {role}</button></div>
    </form>
  </div>;
}
