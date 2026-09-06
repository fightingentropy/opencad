import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../state/store';
import { createContainmentSampleProject } from '../sample-containment';
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
import { AppIcon } from './AppIcon';

export function MenuBar({
  simpleContainment = false,
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
  onShowBom,
  onShowAbout,
  onShowCableSchedule,
  onShowCompliance,
  onShowCatalogue,
  onShowCost,
  onShowCrossSection,
  onShowCollaboration,
}: {
  simpleContainment?: boolean;
  leftVisible: boolean;
  rightVisible: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
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
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const viewMode = useStore((s) => s.editor.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const setStatus = useStore((s) => s.setStatus);
  const addEntity = useStore((s) => s.addEntity);
  const addEntities = useStore((s) => s.addEntities);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hidden import inputs — one per importer so we can configure `accept`
  // and dispatch to the right handler when the user picks a file.
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);
  const cablesInputRef = useRef<HTMLInputElement>(null);

  const newLayoutDialogRef = useRef<HTMLDialogElement>(null);
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

  const onNewContainment = () => {
    newLayoutDialogRef.current?.close();
    setProject(createContainmentSampleProject());
    const state = useStore.getState();
    state.clearSelection();
    state.setViewMode('3d');
    state.setStatus('Containment layout opened');
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
    const regeneration = regenerateAutoFeaturesForContainments(selectedContainmentIds);
    setStatus(`Auto-features regenerated for ${regeneration.containmentCount} containment${regeneration.containmentCount === 1 ? '' : 's'}${regeneration.retainedCount ? ` · ${regeneration.retainedCount} recorded parts retained for review` : ''}`);
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
    const regeneration = regenerateAutoFeaturesForContainments(result.changedIds);
    useStore.getState().setSelection(result.changedIds);
    setStatus(
      `Straightened ${result.changedIds.length} containments at ${result.elevation.toFixed(0)}mm FFL with ${result.clearanceMm}mm side gap${regeneration.retainedCount ? ` · ${regeneration.retainedCount} recorded parts retained for review` : ''}`,
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
    const csv = cablesToCSV(cables, project);
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
    const project = useStore.getState().project;
    const rows = generateContainmentBOM(project);
    if (rows.length === 0) {
      notify('warning', 'No containment runs to bill.');
      return;
    }
    const csv = containmentBOMToCSV(rows, project);
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
      const project = useStore.getState().project;
      const est = generateCostEstimate(project);
      const csv = costEstimateToCSV(est, project);
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
      newContainmentProject: () => newLayoutDialogRef.current?.showModal(),
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
      <input ref={fileInputRef} type="file" accept=".json" onChange={onFileChosen} style={{ display: 'none' }} />
      <input ref={dxfInputRef} type="file" accept=".dxf" onChange={onDXFChosen} style={{ display: 'none' }} />
      <input ref={ifcInputRef} type="file" accept=".ifc" onChange={onIFCChosen} style={{ display: 'none' }} />
      <input ref={cablesInputRef} type="file" accept=".csv" onChange={onCablesChosen} style={{ display: 'none' }} />
      <MenuButton label="OpenCAD" open={openMenu === 'app'} onClick={click('app')}>
        <MenuOpt label="New containment layout" onClick={action(() => newLayoutDialogRef.current?.showModal())} hint="" />
        <MenuOpt label="New blank project" onClick={action(onNew)} hint="" />
        <MenuOpt label="Open project…" onClick={action(onOpen)} hint={shortcutHint('file.open')} />
        <MenuOpt label="Save a copy…" onClick={action(onSave)} hint={shortcutHint('file.save')} />
        <Divider />
        <SubMenu label="Export" isOpen={openSubmenu === 'export'} onHover={() => setOpenSubmenu('export')}>
          <MenuOpt label="SVG…" onClick={action(onExportSVG)} hint="" />
          <MenuOpt label="PNG…" onClick={action(onExportPNG)} hint="" />
          <MenuOpt label="PDF…" onClick={action(onExportPDF)} hint={shortcutHint('file.export-pdf')} />
          <MenuOpt label="IFC…" onClick={action(onExportIFC)} hint="" />
          <MenuOpt label="COBie…" onClick={action(onExportCOBie)} hint="" />
          <Divider />
          <MenuOpt label="Cable schedule · CSV…" onClick={action(onExportCableScheduleCSV)} hint="" />
          <MenuOpt label="Cable schedule · PDF…" onClick={action(onExportCableSchedulePDF)} hint="" />
          <MenuOpt label="Containment BOM…" onClick={action(onExportContainmentBOMCSV)} hint="" />
          <MenuOpt label="Compliance report…" onClick={action(onExportCompliancePDF)} hint="" />
          <MenuOpt label="Cost estimate…" onClick={action(onExportCostEstimateCSV)} hint="" />
        </SubMenu>
        <SubMenu label="Import" isOpen={openSubmenu === 'import'} onHover={() => setOpenSubmenu('import')}>
          <MenuOpt label="DXF underlay…" onClick={action(onImportDXF)} hint="" />
          <MenuOpt label="IFC reference…" onClick={action(onImportIFC)} hint="" />
          <MenuOpt label="Cable schedule…" onClick={action(onImportCables)} hint="" />
        </SubMenu>
        <SubMenu label="Tools" isOpen={openSubmenu === 'tools'} onHover={() => setOpenSubmenu('tools')}>
          <MenuOpt label="Schedules & BOM…" onClick={action(onShowBom)} hint="" />
          {onShowCableSchedule && <MenuOpt label="Cable schedule…" onClick={action(onShowCableSchedule)} hint="" />}
          {onShowCompliance && <MenuOpt label="Compliance…" onClick={action(onShowCompliance)} hint="" />}
          {onShowCatalogue && <MenuOpt label="Catalogue…" onClick={action(onShowCatalogue)} hint="" />}
          {onShowCost && <MenuOpt label="Cost estimate…" onClick={action(onShowCost)} hint="" />}
          {onShowCrossSection && <MenuOpt label="Cross section…" onClick={action(onShowCrossSection)} hint="" />}
          <Divider />
          <MenuOpt label="Auto-number wires" onClick={action(onAutoNumber)} hint="" />
          <MenuOpt label="Regenerate auto-features" onClick={action(onRerunAutoFeatures)} hint="" />
          <MenuOpt label="Space containments" onClick={action(onStraightenAndSpaceContainments)} hint="" />
        </SubMenu>
        <SubMenu label="Standards" isOpen={openSubmenu === 'standards'} onHover={() => setOpenSubmenu('standards')}>
          <div className="settings-pane" onClick={(event) => event.stopPropagation()}><StandardsProfilePicker /></div>
        </SubMenu>
        {onShowCollaboration && <MenuOpt label="Collaboration…" onClick={action(onShowCollaboration)} hint="" />}
        <Divider />
        <MenuOpt label="Search everything…" onClick={action(() => runCommand('help.palette'))} hint={shortcutHint('help.palette')} />
        <MenuOpt label="Keyboard shortcuts" onClick={action(() => runCommand('help.shortcuts'))} hint={shortcutHint('help.shortcuts')} />
        <MenuOpt label="About OpenCAD" onClick={action(onShowAbout)} hint="" />
      </MenuButton>
      <span className="menu-project-name" title={`${projectName} · ${sheetCount} sheets · ${projectStandard}`}>{projectName}</span>
      <div className="menu-spacer" />
      <button type="button" className="menu-command-button" onClick={() => runCommand('help.palette')} aria-label="Search everything" title={`Search everything (${shortcutHint('help.palette')})`}><AppIcon name="search" size={16} /><span>Search anything…</span><kbd>{shortcutHint('help.palette')}</kbd></button>
      <div className="menu-history" role="group" aria-label="Edit history">
        <button type="button" className="header-icon" onClick={undo} disabled={past === 0} title={`Undo (${shortcutHint('edit.undo')})`} aria-label="Undo"><AppIcon name="undo" /></button>
        <button type="button" className="header-icon" onClick={redo} disabled={future === 0} title={`Redo (${shortcutHint('edit.redo')})`} aria-label="Redo"><AppIcon name="redo" /></button>
      </div>
      <div className="header-view-switch" role="group" aria-label="Workspace view">
        <button type="button" aria-label="2D drawing" aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>2D</button>
        <button type="button" className="header-split" aria-label="Split view" title="Split view" aria-pressed={viewMode === 'split'} onClick={() => setViewMode('split')}><AppIcon name="split" size={15} /></button>
        <button type="button" aria-label="3D model" aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>3D</button>
      </div>
      <div className="menu-panels" role="group" aria-label="Side panels">
        <button type="button" className="header-icon" aria-label="Toggle sidebar" title="Toggle sidebar" aria-pressed={leftVisible} onClick={onToggleLeft}><AppIcon name="sidebar" /></button>
        {!simpleContainment && <button type="button" className="header-icon" aria-label="Toggle inspector" title="Toggle inspector" aria-pressed={rightVisible} onClick={onToggleRight}><AppIcon name="inspector" /></button>}
      </div>
      <dialog className="new-layout-dialog" ref={newLayoutDialogRef} aria-labelledby="new-layout-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <h2 id="new-layout-title">Open a new containment layout?</h2>
        <p>This replaces the current project. Save a copy first if you want to keep it.</p>
        <button type="button" className="new-layout-save" onClick={onSave}>Save current project</button>
        <div><button type="button" autoFocus onClick={() => newLayoutDialogRef.current?.close()}>Cancel</button><button type="button" onClick={onNewContainment}>Open layout</button></div>
      </dialog>
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
      <button type="button" className={`menu-item${open ? ' open' : ''}`} onClick={onClick} aria-haspopup="menu" aria-expanded={open}><AppIcon name="app" size={19} /><span>{label}</span><AppIcon name="chevron" size={14} /></button>
      {open && (
        <div className="context-menu app-menu" role="menu" aria-label="Application menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); (event.currentTarget.previousElementSibling as HTMLButtonElement)?.click(); (event.currentTarget.previousElementSibling as HTMLButtonElement)?.focus(); } }} style={{ left: 0, top: 38 }}>
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
    <button type="button" role="menuitem" disabled={disabled}
      className={`item${disabled ? ' disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
    >
      {label}
      {hint && <span className="key">{hint}</span>}
    </button>
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
      role="menuitem"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onHover(); } }}
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
