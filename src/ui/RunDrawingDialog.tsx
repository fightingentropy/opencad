import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Project } from '../types';
import { buildRunDrawingPack, drawingLegs, runDrawingPackPDF, runDrawingPageSVG, selectedRunRoutes } from '../io/run-drawings';
import { notify } from '../state/notifications';
import './run-drawings.css';

const useDrawingDialog = create<{ routeId: string | null }>(() => ({ routeId: null }));
export const openRunDrawings = (routeId: string) => useDrawingDialog.setState({ routeId });

export function RunDrawingDialog({ project }: { project: Project }) {
  const routeId = useDrawingDialog(state => state.routeId);
  return routeId && project.sheets[project.activeSheetId]?.entities[routeId]?.kind === 'containment'
    ? <DrawingDialogContent key={project.id + ':' + routeId} project={project} routeId={routeId}
      onClose={() => useDrawingDialog.setState({ routeId: null })} /> : null;
}

function DrawingDialogContent({ project, routeId, onClose }: { project: Project; routeId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [axis, setAxis] = useState<'x' | 'y' | undefined>();
  const [sectionLeg, setSectionLeg] = useState<number | undefined>();
  const [pageIndex, setPageIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const routes = useMemo(() => selectedRunRoutes(project, routeId, connected), [project, routeId, connected]);
  const legs = useMemo(() => drawingLegs(project, routes), [project, routes]);
  const pack = useMemo(() => buildRunDrawingPack(project, routeId, { includeConnected: connected, elevationAxis: axis, sectionLeg }),
    [project, routeId, connected, axis, sectionLeg]);
  const page = pack.pages[Math.min(pageIndex, pack.pages.length - 1)];
  const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(runDrawingPageSVG(page));
  const moreRoutes = selectedRunRoutes(project, routeId, true).length > 1;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  const exportPDF = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const bytes = await runDrawingPackPDF(pack);
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url; link.download = (pack.title.replace(/[^a-z\d_-]+/gi, '-').replace(/^-|-$/g, '') || 'route') + '-drawings.pdf';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('success', `Exported ${pack.pages.length} drawing pages.`);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'The drawing PDF could not be exported.'); }
    finally { setExporting(false); }
  };
  return <div className="scene-dialog-backdrop" onPointerDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <div ref={ref} className="run-drawing-dialog" role="dialog" aria-modal="true" aria-label="Run drawings" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select')].filter(e => !(e as HTMLButtonElement).disabled);
        if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
          event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    }}>
      <div className="scene-dialog-heading"><div><h2>Run drawings</h2><p>{pack.title} · {(pack.lengthMm / 1000).toFixed(3)} m · {pack.routeIds.length} {pack.routeIds.length === 1 ? 'run' : 'runs'}</p></div>
        <button type="button" aria-label="Close run drawings" onClick={onClose}>×</button></div>
      <div className="run-drawing-options">
        <label><input type="checkbox" checked={connected} disabled={!moreRoutes} onChange={event => { setConnected(event.target.checked); setSectionLeg(undefined); }} />Include connected runs</label>
        <label>Elevation<select aria-label="Elevation view direction" value={axis ?? 'auto'} onChange={event => setAxis(event.target.value === 'auto' ? undefined : event.target.value as 'x' | 'y')}>
          <option value="auto">Auto</option><option value="x">Along X</option><option value="y">Along Y</option></select></label>
        <label>Section<select aria-label="Section cut leg" value={sectionLeg ?? 'auto'} onChange={event => setSectionLeg(event.target.value === 'auto' ? undefined : Number(event.target.value))}>
          <option value="auto">Auto</option>{legs.map((leg, index) => <option key={index} value={index}>{routes.length > 1 ? (leg.route.label || 'Run ' + (routes.indexOf(leg.route) + 1)) + ' · ' : ''}Leg {leg.index + 1}</option>)}</select></label>
      </div>
      <div className="run-drawing-tabs" role="tablist" aria-label="Drawing pages">{pack.pages.map((p, i) => <button type="button" key={i} role="tab" aria-selected={i === pageIndex}
        onClick={() => setPageIndex(i)}>{p.title}</button>)}</div>
      <div className="run-drawing-preview"><img src={image} alt={page.title + ' drawing preview'} /></div>
      <div className="run-drawing-footer"><span>A3 · {page.scale ? '1:' + page.scale : 'Schedule'} · mm</span>
        <button type="button" disabled={exporting} onClick={exportPDF}>{exporting ? 'Preparing PDF…' : `Export PDF · ${pack.pages.length} pages`}</button></div>
    </div>
  </div>;
}
