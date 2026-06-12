import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../state/store';
import { exportProjectJSON, importProjectJSON } from '../io/project';
import { exportSheetSVG } from '../io/svg';
import { exportSheetPNG } from '../io/png';
import { exportSheetPDF } from '../io/pdf';
import { autoNumberWires } from '../io/wire-numbering';
import { registerUiHandlers, runCommand, shortcutHint } from '../lib/commands';
import { notify } from '../state/notifications';
import { StandardsProfilePicker } from './StandardsProfilePicker';
import { regenerateAutoFeaturesForContainments } from '../lib/auto-feature-actions';
import { layoutContainmentsSideBySide } from '../lib/containment-layout';
import { exportIFC } from '../io/ifc-export';
import { importIFC } from '../io/ifc-import';
import { exportCOBie, cobieToCSVZip } from '../io/cobie';
import { parseDXF } from '../io/dxf-import';
import {
  exportCableSchedule,
  cableScheduleToPDF,
} from '../io/cable-schedule-export';
import { generateContainmentBOM, containmentBOMToCSV } from '../io/containment-bom';
import { cablesToCSV, cablesFromCSV } from '../io/xlsx';
import {
  generateComplianceReport,
  complianceReportToPDF,
} from '../io/compliance-report';
import { generateCostEstimate, costEstimateToCSV } from '../io/cost-estimate';
import { ViewGeneratorModal, ViewGeneratorKind } from './ViewGeneratorModal';

export function MenuBar({
  onShowBom,
  onShowAbout,
  onShowCableSchedule,
  onShowCompliance,
  onShowCatalogue,
  onShowCost,
  onShowCrossSection,
  onShowCollaboration,
}: {
  onShowBom: () => void;
  onShowAbout: () => void;
  onShowCableSchedule?: () => void;
  onShowCompliance?: () => void;
  onShowCatalogue?: () => void;
  onShowCost?: () => void;
  onShowCrossSection?: () => void;
  onShowCollaboration?: () => void;
}) {
  // Render only needs the project header line; every handler below reads the
  // live project via useStore.getState() at invoke time instead of closing
  // over a whole-project subscription.
  const projectName = useStore((s) => s.project.name);
  const projectStandard = useStore((s) => s.project.standard);
  const sheetCount = useStore((s) => s.project.sheetOrder.length);
  const setProject = useStore((s) => s.setProject);
  const resetProject = useStore((s) => s.resetProject);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const selectionSize = useStore((s) => s.editor.selection.size);
  const setStatus = useStore((s) => s.setStatus);
  const addEntity = useStore((s) => s.addEntity);
  const addEntities = useStore((s) => s.addEntities);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hidden import inputs — one per importer so we can configure `accept`
  // and dispatch to the right handler when the user picks a file.
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);
  const cablesInputRef = useRef<HTMLInputElement>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [viewGeneratorKind, setViewGeneratorKind] =
    useState<ViewGeneratorKind | null>(null);

  useEffect(() => {
    const handler = () => {
      setOpenMenu(null);
      setOpenSubmenu(null);
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const click = (m: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenu(openMenu === m ? null : m);
    setOpenSubmenu(null);
  };

  const action = (fn: () => void) => () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
    fn();
  };

  const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadText = (text: string, filename: string, mime: string): void => {
    downloadBlob(new Blob([text], { type: mime }), filename);
  };

  const safeProjectName = (): string =>
    useStore.getState().project.name.replace(/\s+/g, '_');

  const onNew = () => {
    if (confirm('Discard current project?')) resetProject();
  };

  const onSave = () => {
    const project = useStore.getState().project;
    const json = exportProjectJSON(project);
    downloadText(json, `${safeProjectName()}.opencad.json`, 'application/json');
    setStatus(`Saved ${project.name}`);
  };

  const onOpen = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      notify('info', 'Opening project…', { id: 'open-project', timeoutMs: null });
      const text = await file.text();
      const p = importProjectJSON(text);
      setProject(p);
      setStatus(`Opened ${p.name}`);
      notify('success', `Opened ${p.name}`, { id: 'open-project' });
    } catch (err) {
      notify('error', 'Failed to open project', {
        detail: (err as Error).message,
        id: 'open-project',
      });
    }
    e.target.value = '';
  };

  const onExportSVG = () => {
    const project = useStore.getState().project;
    const svg = exportSheetSVG(project);
    const sheet = project.sheets[project.activeSheetId];
    downloadText(svg, `${sheet.name.replace(/\s+/g, '_')}.svg`, 'image/svg+xml');
  };

  const onExportPNG = async () => {
    const project = useStore.getState().project;
    try {
      notify('info', 'Exporting PNG…', { id: 'export-png', timeoutMs: null });
      const blob = await exportSheetPNG(project, 2);
      const sheet = project.sheets[project.activeSheetId];
      downloadBlob(blob, `${sheet.name.replace(/\s+/g, '_')}.png`);
      notify('success', `Exported ${sheet.name.replace(/\s+/g, '_')}.png`, { id: 'export-png' });
    } catch (err) {
      notify('error', 'PNG export failed', {
        detail: (err as Error).message,
        id: 'export-png',
      });
    }
  };

  const onExportPDF = () => {
    exportSheetPDF(useStore.getState().project);
  };

  const onAutoNumber = () => {
    autoNumberWires();
    setStatus('Wire numbers regenerated');
  };

  const onRerunAutoFeatures = () => {
    const state = useStore.getState();
    const proj = state.project;
    const sheetId = proj.activeSheetId;
    const sheet = proj.sheets[sheetId];
    if (!sheet) return;
    const selectedContainmentIds = Array.from(state.editor.selection).filter((id) => {
      const e = sheet.entities[id];
      return e && e.kind === 'containment';
    });
    if (selectedContainmentIds.length === 0) {
      setStatus('Select one or more containments to re-run auto-features');
      return;
    }
    regenerateAutoFeaturesForContainments(selectedContainmentIds);
    setStatus(`Auto-features regenerated for ${selectedContainmentIds.length} containment${selectedContainmentIds.length === 1 ? '' : 's'}`);
  };

  const onStraightenAndSpaceContainments = () => {
    const state = useStore.getState();
    const proj = state.project;
    const sheetId = proj.activeSheetId;
    const sheet = proj.sheets[sheetId];
    if (!sheet) return;
    const selectedContainmentIds = Array.from(state.editor.selection).filter((id) => {
      const entity = sheet.entities[id];
      return entity && entity.kind === 'containment';
    });
    if (selectedContainmentIds.length < 2) {
      setStatus('Select at least two containments to straighten and space');
      return;
    }
    const result = layoutContainmentsSideBySide(proj, sheetId, selectedContainmentIds, 150);
    if (!result || result.changedIds.length < 2) {
      setStatus('Selected containments need valid two-point routes');
      return;
    }
    state.setProjectPatch({ sheets: result.project.sheets });
    regenerateAutoFeaturesForContainments(result.changedIds);
    useStore.getState().setSelection(result.changedIds);
    setStatus(
      `Straightened ${result.changedIds.length} containments at ${result.elevation.toFixed(0)}mm FFL with ${result.clearanceMm}mm side gap`,
    );
  };

  // ---- Export submenu handlers --------------------------------------------

  const onExportIFC = () => {
    try {
      notify('info', 'Exporting IFC…', { id: 'export-ifc', timeoutMs: null });
      const ifc = exportIFC(useStore.getState().project);
      downloadText(ifc, `${safeProjectName()}.ifc`, 'application/x-step');
      setStatus('Exported IFC (BIM) bundle');
      notify('success', 'Exported IFC (BIM) bundle', { id: 'export-ifc' });
    } catch (err) {
      notify('error', 'IFC export failed', {
        detail: (err as Error).message,
        id: 'export-ifc',
      });
    }
  };

  const onExportCOBie = () => {
    try {
      notify('info', 'Exporting COBie…', { id: 'export-cobie', timeoutMs: null });
      const bundle = exportCOBie(useStore.getState().project);
      const csv = cobieToCSVZip(bundle);
      downloadText(csv, `${safeProjectName()}.cobie.csv`, 'text/csv');
      setStatus('Exported COBie bundle');
      notify('success', 'Exported COBie bundle', { id: 'export-cobie' });
    } catch (err) {
      notify('error', 'COBie export failed', {
        detail: (err as Error).message,
        id: 'export-cobie',
      });
    }
  };

  const onExportCableScheduleCSV = () => {
    const project = useStore.getState().project;
    const cables = project.cableSchedule
      ? project.cableSchedule.cableOrder
          .map((id) => project.cableSchedule!.cables[id])
          .filter(Boolean)
      : [];
    if (cables.length === 0) {
      notify('warning', 'No cables in the cable schedule yet.');
      return;
    }
    const csv = cablesToCSV(cables);
    downloadText(csv, `${safeProjectName()}_Cables.csv`, 'text/csv');
    setStatus(`Exported cable schedule (${cables.length} cables)`);
    notify('success', `Exported cable schedule (${cables.length} cables)`, {
      id: 'export-cable-schedule-csv',
    });
  };

  const onExportCableSchedulePDF = async () => {
    const project = useStore.getState().project;
    const rows = exportCableSchedule(project);
    if (rows.length === 0) {
      notify('warning', 'No cables in the cable schedule yet.');
      return;
    }
    try {
      notify('info', 'Exporting cable schedule PDF…', {
        id: 'export-cable-schedule-pdf',
        timeoutMs: null,
      });
      const blob = await cableScheduleToPDF(rows, project);
      downloadBlob(blob, `${safeProjectName()}_CableSchedule.pdf`);
      setStatus(`Exported cable schedule PDF (${rows.length} cables)`);
      notify('success', `Exported cable schedule PDF (${rows.length} cables)`, {
        id: 'export-cable-schedule-pdf',
      });
    } catch (err) {
      notify('error', 'Cable schedule PDF failed', {
        detail: (err as Error).message,
        id: 'export-cable-schedule-pdf',
      });
    }
  };

  const onExportContainmentBOMCSV = () => {
    const rows = generateContainmentBOM(useStore.getState().project);
    if (rows.length === 0) {
      notify('warning', 'No containment runs to bill.');
      return;
    }
    const csv = containmentBOMToCSV(rows);
    downloadText(csv, `${safeProjectName()}_ContainmentBOM.csv`, 'text/csv');
    setStatus(`Exported containment BOM (${rows.length} rows)`);
    notify('success', `Exported containment BOM (${rows.length} rows)`, {
      id: 'export-containment-bom',
    });
  };

  const onExportCompliancePDF = async () => {
    try {
      notify('info', 'Generating compliance report…', {
        id: 'export-compliance-pdf',
        timeoutMs: null,
      });
      const data = generateComplianceReport(useStore.getState().project);
      const blob = await complianceReportToPDF(data);
      downloadBlob(blob, `${safeProjectName()}_Compliance.pdf`);
      setStatus('Exported compliance report');
      notify('success', 'Exported compliance report', { id: 'export-compliance-pdf' });
    } catch (err) {
      notify('error', 'Compliance report failed', {
        detail: (err as Error).message,
        id: 'export-compliance-pdf',
      });
    }
  };

  const onExportCostEstimateCSV = () => {
    try {
      notify('info', 'Exporting cost estimate…', {
        id: 'export-cost-estimate',
        timeoutMs: null,
      });
      const est = generateCostEstimate(useStore.getState().project);
      const csv = costEstimateToCSV(est);
      downloadText(csv, `${safeProjectName()}_CostEstimate.csv`, 'text/csv');
      setStatus(
        `Exported cost estimate (${est.currency} ${est.grandTotal.toFixed(2)})`,
      );
      notify('success', `Exported cost estimate (${est.currency} ${est.grandTotal.toFixed(2)})`, {
        id: 'export-cost-estimate',
      });
    } catch (err) {
      notify('error', 'Cost estimate export failed', {
        detail: (err as Error).message,
        id: 'export-cost-estimate',
      });
    }
  };

  // ---- Import submenu handlers --------------------------------------------

  const onImportDXF = () => dxfInputRef.current?.click();

  const onDXFChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      notify('info', 'Importing DXF…', { id: 'import-dxf', timeoutMs: null });
      const text = await file.text();
      const underlay = parseDXF(text);
      addEntity(underlay);
      setStatus(`Imported DXF underlay (${file.name})`);
      notify('success', `Imported DXF underlay (${file.name})`, { id: 'import-dxf' });
    } catch (err) {
      notify('error', 'DXF import failed', {
        detail: (err as Error).message,
        id: 'import-dxf',
      });
    }
    e.target.value = '';
  };

  const onImportIFC = () => ifcInputRef.current?.click();

  const onIFCChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      notify('info', 'Importing IFC…', { id: 'import-ifc', timeoutMs: null });
      const text = await file.text();
      const result = importIFC(text);
      if (result.entities.length > 0) {
        addEntities(result.entities);
      }
      const warned = result.warnings.length;
      setStatus(
        `Imported IFC (${result.entities.length} entities${warned ? `, ${warned} warnings` : ''})`,
      );
      if (result.entities.length === 0) {
        notify('warning', 'IFC import produced no entities.', {
          detail: warned ? result.warnings.slice(0, 5).join('\n') : undefined,
          id: 'import-ifc',
        });
      } else {
        notify(
          'success',
          `Imported IFC (${result.entities.length} entities${warned ? `, ${warned} warnings` : ''})`,
          { id: 'import-ifc' },
        );
      }
    } catch (err) {
      notify('error', 'IFC import failed', {
        detail: (err as Error).message,
        id: 'import-ifc',
      });
    }
    e.target.value = '';
  };

  const onImportCables = () => cablesInputRef.current?.click();

  const onCablesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      notify('info', 'Importing cables…', { id: 'import-cables', timeoutMs: null });
      const text = await file.text();
      const result = cablesFromCSV(text);
      if (result.cables.length === 0) {
        notify('warning', 'No cables parsed from CSV.', { id: 'import-cables' });
        return;
      }
      // Merge by reference: existing reference => replace; new => append.
      const project = useStore.getState().project;
      const existing = project.cableSchedule ?? { cables: {}, cableOrder: [] };
      const cables = { ...existing.cables };
      const order = [...existing.cableOrder];
      const refToId = new Map<string, string>();
      for (const id of order) {
        const c = cables[id];
        if (c) refToId.set(c.reference, id);
      }
      let merged = 0;
      let added = 0;
      for (const c of result.cables) {
        const exId = refToId.get(c.reference);
        if (exId) {
          cables[exId] = { ...c, id: exId, route: cables[exId].route ?? [] };
          merged++;
        } else {
          cables[c.id] = c;
          order.push(c.id);
          added++;
        }
      }
      setProject({
        ...project,
        cableSchedule: { cables, cableOrder: order },
        modified: Date.now(),
      });
      setStatus(`Imported ${added} new + ${merged} merged cables`);
      notify('success', `Imported ${added} new + ${merged} merged cables`, {
        id: 'import-cables',
      });
      if (result.errors.length) {
        console.warn('[opencad] cable CSV warnings:', result.errors);
      }
    } catch (err) {
      notify('error', 'Cable CSV import failed', {
        detail: (err as Error).message,
        id: 'import-cables',
      });
    }
    e.target.value = '';
  };

  // Keep the command registry pointed at this render's handlers. They now
  // read the live project via getState(), but some still close over props /
  // local state. Runs after every render; registerUiHandlers is a cheap
  // Object.assign.
  useEffect(() => {
    registerUiHandlers({
      newProject: onNew,
      openProject: onOpen,
      saveProject: onSave,
      exportSVG: onExportSVG,
      exportPNG: onExportPNG,
      exportPDF: onExportPDF,
      exportIFC: onExportIFC,
      exportCOBie: onExportCOBie,
      exportCableScheduleCSV: onExportCableScheduleCSV,
      exportCableSchedulePDF: onExportCableSchedulePDF,
      exportContainmentBOMCSV: onExportContainmentBOMCSV,
      exportCompliancePDF: onExportCompliancePDF,
      exportCostEstimateCSV: onExportCostEstimateCSV,
      importDXF: onImportDXF,
      importIFC: onImportIFC,
      importCablesCSV: onImportCables,
      autoNumberWires: onAutoNumber,
      rerunAutoFeatures: onRerunAutoFeatures,
      straightenContainments: onStraightenAndSpaceContainments,
      openViewGenerator: (kind) => setViewGeneratorKind(kind),
    });
  });

  return (
    <div className="menu-bar">
      <div className="menu-brand">
        <span className="logo">⌬</span>
        <span className="brand-name">OpenCAD <span style={{ color: '#3ba3ff' }}>Electrical</span></span>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" onChange={onFileChosen} style={{ display: 'none' }} />
      <input ref={dxfInputRef} type="file" accept=".dxf" onChange={onDXFChosen} style={{ display: 'none' }} />
      <input ref={ifcInputRef} type="file" accept=".ifc" onChange={onIFCChosen} style={{ display: 'none' }} />
      <input ref={cablesInputRef} type="file" accept=".csv" onChange={onCablesChosen} style={{ display: 'none' }} />
      <MenuButton label="File" open={openMenu === 'file'} onClick={click('file')}>
        <MenuOpt label="New" onClick={action(onNew)} hint="" />
        <MenuOpt label="Open…" onClick={action(onOpen)} hint={shortcutHint('file.open')} />
        <MenuOpt label="Save" onClick={action(onSave)} hint={shortcutHint('file.save')} />
        <Divider />
        <MenuOpt label="Export SVG…" onClick={action(onExportSVG)} hint="" />
        <MenuOpt label="Export PNG…" onClick={action(onExportPNG)} hint="" />
        <MenuOpt label="Export PDF…" onClick={action(onExportPDF)} hint={shortcutHint('file.export-pdf')} />
        <Divider />
        <SubMenu
          label="Export"
          isOpen={openSubmenu === 'export'}
          onHover={() => setOpenSubmenu('export')}
        >
          <MenuOpt label="Export IFC (BIM)…" onClick={action(onExportIFC)} hint="" />
          <MenuOpt label="Export DXF Underlay (Coming Soon)" onClick={() => {}} hint="" disabled />
          <MenuOpt label="Export COBie Bundle…" onClick={action(onExportCOBie)} hint="" />
          <Divider />
          <MenuOpt label="Export Cable Schedule (CSV)…" onClick={action(onExportCableScheduleCSV)} hint="" />
          <MenuOpt label="Export Cable Schedule (PDF)…" onClick={action(onExportCableSchedulePDF)} hint="" />
          <MenuOpt label="Export Containment BOM (CSV)…" onClick={action(onExportContainmentBOMCSV)} hint="" />
          <MenuOpt label="Export Compliance Report (PDF)…" onClick={action(onExportCompliancePDF)} hint="" />
          <MenuOpt label="Export Cost Estimate (CSV)…" onClick={action(onExportCostEstimateCSV)} hint="" />
        </SubMenu>
        <SubMenu
          label="Import"
          isOpen={openSubmenu === 'import'}
          onHover={() => setOpenSubmenu('import')}
        >
          <MenuOpt label="Import DWG/DXF as Underlay…" onClick={action(onImportDXF)} hint="" />
          <MenuOpt label="Import IFC Reference…" onClick={action(onImportIFC)} hint="" />
          <MenuOpt label="Import Cables (CSV)…" onClick={action(onImportCables)} hint="" />
        </SubMenu>
        {onShowCollaboration && (
          <>
            <Divider />
            <MenuOpt label="Collaboration…" onClick={action(onShowCollaboration)} hint="" />
          </>
        )}
      </MenuButton>
      <MenuButton label="Edit" open={openMenu === 'edit'} onClick={click('edit')}>
        <MenuOpt label="Undo" onClick={action(undo)} hint={shortcutHint('edit.undo')} />
        <MenuOpt label="Redo" onClick={action(redo)} hint={shortcutHint('edit.redo')} />
        <Divider />
        <MenuOpt label="Select All" onClick={action(() => { const { project, setSelection } = useStore.getState(); const sheet = project.sheets[project.activeSheetId]; setSelection(sheet.entityOrder); })} hint={shortcutHint('edit.select-all')} />
        <MenuOpt label="Deselect" onClick={action(() => useStore.getState().clearSelection())} hint={shortcutHint('edit.cancel')} />
        <Divider />
        <MenuOpt label="Delete Selection" onClick={action(() => { const ids = Array.from(useStore.getState().editor.selection); useStore.getState().removeEntities(ids); })} hint={shortcutHint('edit.delete')} />
        <Divider />
        <MenuOpt label="Align Left" onClick={action(() => useStore.getState().alignEntities('left'))} hint="" disabled={selectionSize < 2} />
        <MenuOpt label="Align Center Horizontal" onClick={action(() => useStore.getState().alignEntities('center-h'))} hint="" disabled={selectionSize < 2} />
        <MenuOpt label="Align Right" onClick={action(() => useStore.getState().alignEntities('right'))} hint="" disabled={selectionSize < 2} />
        <MenuOpt label="Align Top" onClick={action(() => useStore.getState().alignEntities('top'))} hint="" disabled={selectionSize < 2} />
        <MenuOpt label="Align Center Vertical" onClick={action(() => useStore.getState().alignEntities('center-v'))} hint="" disabled={selectionSize < 2} />
        <MenuOpt label="Align Bottom" onClick={action(() => useStore.getState().alignEntities('bottom'))} hint="" disabled={selectionSize < 2} />
        <Divider />
        <MenuOpt label="Distribute Horizontal" onClick={action(() => useStore.getState().distributeEntities('horizontal'))} hint="" disabled={selectionSize < 3} />
        <MenuOpt label="Distribute Vertical" onClick={action(() => useStore.getState().distributeEntities('vertical'))} hint="" disabled={selectionSize < 3} />
        <MenuOpt label="Flip Horizontal" onClick={action(() => useStore.getState().flipEntities('horizontal'))} hint={shortcutHint('edit.flip-horizontal')} disabled={selectionSize < 1} />
        <MenuOpt label="Flip Vertical" onClick={action(() => useStore.getState().flipEntities('vertical'))} hint={shortcutHint('edit.flip-vertical')} disabled={selectionSize < 1} />
      </MenuButton>
      <MenuButton label="View" open={openMenu === 'view'} onClick={click('view')}>
        <MenuOpt label="Zoom Extents" onClick={action(() => runCommand('view.zoom-extents'))} hint="" />
        <MenuOpt label="2D Only" onClick={action(() => useStore.getState().setViewMode('2d'))} hint="" />
        <MenuOpt label="Split View" onClick={action(() => useStore.getState().setViewMode('split'))} hint="" />
        <MenuOpt label="3D Only" onClick={action(() => useStore.getState().setViewMode('3d'))} hint="" />
        <MenuOpt label="Toggle Ortho" onClick={action(() => useStore.getState().setOrtho(!useStore.getState().editor.ortho))} hint={shortcutHint('view.toggle-ortho')} />
        <MenuOpt label="Toggle Snap" onClick={action(() => useStore.getState().setSnap({ enabled: !useStore.getState().editor.snap.enabled }))} hint={shortcutHint('view.toggle-snap')} />
        <MenuOpt label="Toggle Grid" onClick={action(() => useStore.getState().setSnap({ grid: !useStore.getState().editor.snap.grid }))} hint={shortcutHint('view.toggle-grid')} />
      </MenuButton>
      <MenuButton label="Tools" open={openMenu === 'tools'} onClick={click('tools')}>
        <MenuOpt label="Auto-Number Wires" onClick={action(onAutoNumber)} hint="" />
        <MenuOpt label="Re-run Auto-Features on Selection" onClick={action(onRerunAutoFeatures)} hint="" />
        <MenuOpt label="Straighten/Space Selected Containments" onClick={action(onStraightenAndSpaceContainments)} hint="" />
        <MenuOpt label="Schedules &amp; BOM…" onClick={action(onShowBom)} hint="" />
        <Divider />
        {onShowCableSchedule && <MenuOpt label="Cable Schedule…" onClick={action(onShowCableSchedule)} hint="" />}
        {onShowCompliance && <MenuOpt label="Compliance Dashboard…" onClick={action(onShowCompliance)} hint="" />}
        {onShowCatalogue && <MenuOpt label="Catalogue Browser…" onClick={action(onShowCatalogue)} hint="" />}
        {onShowCrossSection && <MenuOpt label="Edit Cross Section…" onClick={action(onShowCrossSection)} hint="" />}
        <Divider />
        {onShowCost && <MenuOpt label="Cost Estimate…" onClick={action(onShowCost)} hint="" />}
        <Divider />
        <MenuOpt
          label="Generate Cross-Section…"
          onClick={action(() => setViewGeneratorKind('cross-section'))}
          hint=""
        />
        <MenuOpt
          label="Generate Elevation View…"
          onClick={action(() => setViewGeneratorKind('elevation'))}
          hint=""
        />
        <MenuOpt
          label="Generate Riser Diagram…"
          onClick={action(() => setViewGeneratorKind('riser'))}
          hint=""
        />
        <MenuOpt
          label="Generate Isometric…"
          onClick={action(() => setViewGeneratorKind('isometric'))}
          hint=""
        />
      </MenuButton>
      <MenuButton label="Settings" open={openMenu === 'settings'} onClick={click('settings')}>
        <div className="settings-pane" onClick={(e) => e.stopPropagation()}>
          <StandardsProfilePicker />
        </div>
      </MenuButton>
      <MenuButton label="Help" open={openMenu === 'help'} onClick={click('help')}>
        <MenuOpt label="Command Palette…" onClick={action(() => runCommand('help.palette'))} hint={shortcutHint('help.palette')} />
        <MenuOpt label="Keyboard Shortcuts" onClick={action(() => runCommand('help.shortcuts'))} hint={shortcutHint('help.shortcuts')} />
        <Divider />
        <MenuOpt label="About OpenCAD Electrical" onClick={action(onShowAbout)} hint="" />
      </MenuButton>
      <div className="menu-spacer" />
      <span className="menu-info">{projectName} · {sheetCount} sheets · {projectStandard}</span>
      {viewGeneratorKind && (
        <ViewGeneratorModal
          kind={viewGeneratorKind}
          onClose={() => setViewGeneratorKind(null)}
        />
      )}
    </div>
  );
}

function MenuButton({
  label, open, onClick, children,
}: {
  label: string; open: boolean; onClick: (e: React.MouseEvent) => void; children: React.ReactNode;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div className="menu-item" onClick={onClick} style={open ? { background: 'var(--bg-3)' } : undefined}>{label}</div>
      {open && (
        <div className="context-menu" style={{ left: 0, top: 24 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuOpt({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`item${disabled ? ' disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
    >
      {label}
      {hint && <span className="key">{hint}</span>}
    </div>
  );
}

function Divider() {
  return <div className="divider" />;
}

// SubMenu: a context-menu row that, on hover or click, expands a flyout
// to the right. We use it for File → Export and File → Import so the
// parent File menu stays compact.
function SubMenu({
  label,
  isOpen,
  onHover,
  children,
}: {
  label: string;
  isOpen: boolean;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`item submenu-anchor${isOpen ? ' is-open' : ''}`}
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation();
        onHover();
      }}
      style={{ position: 'relative' }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <span className="key">▸</span>
      {isOpen && (
        <div className="context-menu submenu" style={{ left: '100%', top: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}
