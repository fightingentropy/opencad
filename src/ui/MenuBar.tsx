import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../state/store';
import { exportProjectJSON, importProjectJSON } from '../io/project';
import { exportSheetSVG } from '../io/svg';
import { exportSheetPNG } from '../io/png';
import { exportSheetPDF } from '../io/pdf';
import { autoNumberWires } from '../io/wire-numbering';

export function MenuBar({ onShowBom, onShowAbout }: { onShowBom: () => void; onShowAbout: () => void }) {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const resetProject = useStore((s) => s.resetProject);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setStatus = useStore((s) => s.setStatus);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpenMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const click = (m: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenu(openMenu === m ? null : m);
  };

  const action = (fn: () => void) => () => { setOpenMenu(null); fn(); };

  const onSave = () => {
    const json = exportProjectJSON(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}.opencad.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Saved ${project.name}`);
  };

  const onOpen = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const p = importProjectJSON(text);
      setProject(p);
      setStatus(`Opened ${p.name}`);
    } catch (err) {
      alert('Failed to open project: ' + (err as Error).message);
    }
    e.target.value = '';
  };

  const onExportSVG = () => {
    const svg = exportSheetSVG(project);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sheet = project.sheets[project.activeSheetId];
    a.download = `${sheet.name.replace(/\s+/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onExportPNG = async () => {
    const blob = await exportSheetPNG(project, 2);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sheet = project.sheets[project.activeSheetId];
    a.download = `${sheet.name.replace(/\s+/g, '_')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onExportPDF = () => {
    exportSheetPDF(project);
  };

  const onAutoNumber = () => {
    autoNumberWires();
    setStatus('Wire numbers regenerated');
  };

  return (
    <div className="menu-bar">
      <div className="menu-brand">
        <span className="logo">⌬</span>
        OpenCAD <span style={{ color: '#3ba3ff' }}>Electrical</span>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" onChange={onFileChosen} style={{ display: 'none' }} />
      <MenuButton label="File" open={openMenu === 'file'} onClick={click('file')}>
        <MenuOpt label="New" onClick={action(() => { if (confirm('Discard current project?')) resetProject(); })} hint="" />
        <MenuOpt label="Open…" onClick={action(onOpen)} hint="⌘O" />
        <MenuOpt label="Save" onClick={action(onSave)} hint="⌘S" />
        <Divider />
        <MenuOpt label="Export SVG…" onClick={action(onExportSVG)} hint="" />
        <MenuOpt label="Export PNG…" onClick={action(onExportPNG)} hint="" />
        <MenuOpt label="Export PDF…" onClick={action(onExportPDF)} hint="⌘⇧P" />
      </MenuButton>
      <MenuButton label="Edit" open={openMenu === 'edit'} onClick={click('edit')}>
        <MenuOpt label="Undo" onClick={action(undo)} hint="⌘Z" />
        <MenuOpt label="Redo" onClick={action(redo)} hint="⌘⇧Z" />
        <Divider />
        <MenuOpt label="Select All" onClick={action(() => { const sheet = project.sheets[project.activeSheetId]; useStore.getState().setSelection(sheet.entityOrder); })} hint="⌘A" />
        <MenuOpt label="Deselect" onClick={action(() => useStore.getState().clearSelection())} hint="Esc" />
        <Divider />
        <MenuOpt label="Delete Selection" onClick={action(() => { const ids = Array.from(useStore.getState().editor.selection); useStore.getState().removeEntities(ids); })} hint="Del" />
      </MenuButton>
      <MenuButton label="View" open={openMenu === 'view'} onClick={click('view')}>
        <MenuOpt label="Zoom Extents" onClick={action(() => zoomExtents())} hint="" />
        <MenuOpt label="2D Only" onClick={action(() => useStore.getState().setViewMode('2d'))} hint="" />
        <MenuOpt label="Split View" onClick={action(() => useStore.getState().setViewMode('split'))} hint="" />
        <MenuOpt label="3D Only" onClick={action(() => useStore.getState().setViewMode('3d'))} hint="" />
        <MenuOpt label="Toggle Ortho" onClick={action(() => useStore.getState().setOrtho(!useStore.getState().editor.ortho))} hint="F8" />
        <MenuOpt label="Toggle Snap" onClick={action(() => useStore.getState().setSnap({ enabled: !useStore.getState().editor.snap.enabled }))} hint="F9" />
        <MenuOpt label="Toggle Grid" onClick={action(() => useStore.getState().setSnap({ grid: !useStore.getState().editor.snap.grid }))} hint="F7" />
      </MenuButton>
      <MenuButton label="Tools" open={openMenu === 'tools'} onClick={click('tools')}>
        <MenuOpt label="Auto-Number Wires" onClick={action(onAutoNumber)} hint="" />
        <MenuOpt label="Bill of Materials…" onClick={action(onShowBom)} hint="" />
      </MenuButton>
      <MenuButton label="Help" open={openMenu === 'help'} onClick={click('help')}>
        <MenuOpt label="About OpenCAD Electrical" onClick={action(onShowAbout)} hint="" />
        <MenuOpt label="Keyboard Shortcuts" onClick={action(onShowAbout)} hint="" />
      </MenuButton>
      <div className="menu-spacer" />
      <span className="menu-info">{project.name} · {project.sheetOrder.length} sheets · {project.standard}</span>
    </div>
  );
}

const zoomExtents = () => {
  const state = useStore.getState();
  const sheet = state.project.sheets[state.project.activeSheetId];
  if (!sheet) return;
  // Best-effort canvas size: fall back to window if we can't query the canvas.
  const canvas = document.querySelector('canvas.canvas-2d') as HTMLCanvasElement | null;
  const w = canvas?.clientWidth ?? window.innerWidth - 500;
  const h = canvas?.clientHeight ?? window.innerHeight - 200;
  // Lazy import to avoid a cycle between MenuBar -> store
  import('../lib/fit').then(({ fitViewportToSheet }) => {
    state.setViewport(fitViewportToSheet(sheet, w, h));
  });
};

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

function MenuOpt({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <div className="item" onClick={onClick}>
      {label}
      {hint && <span className="key">{hint}</span>}
    </div>
  );
}

function Divider() {
  return <div className="divider" />;
}
