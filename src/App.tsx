import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { CadCanvas } from './canvas/CadCanvas';
import { MenuBar } from './ui/MenuBar';
import { Ribbon } from './ui/Ribbon';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { StatusBar } from './ui/StatusBar';
import { SiteNavigator } from './ui/SiteNavigator';
import { BomModal } from './ui/BomModal';
import { AboutModal } from './ui/AboutModal';
import { CableScheduleModal } from './ui/CableScheduleModal';
import { ComplianceDashboard } from './ui/ComplianceDashboard';
import { CatalogueBrowser } from './ui/CatalogueBrowser';
import { CostEstimationModal } from './ui/CostEstimationModal';
import { CrossSectionEditor } from './ui/CrossSectionEditor';
import { CollaborationModal } from './ui/CollaborationModal';
import { PresenceLayer } from './ui/PresenceLayer';
import { onActiveChange as onCollabActiveChange } from './collab/runtime';
import { Panel3DContainer } from './three/Panel3DContainer';
import { createSampleProject } from './sample';
import { createWholeSiteSampleProject } from './sample-whole-site';
import { loadStoredProject, saveStoredProject } from './io/persist';
import { fitViewportToSheet } from './lib/fit';

const STORED_3D_WIDTH_KEY = 'opencad.panel3dWidth';
const MOBILE_BREAKPOINT = 900;

export function App() {
  const setProject = useStore((s) => s.setProject);
  const viewMode = useStore((s) => s.editor.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const [bomOpen, setBomOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [cableScheduleOpen, setCableScheduleOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [crossSectionEntityId, setCrossSectionEntityId] = useState<string | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabActive, setCollabActiveLocal] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [panel3DWidth, setPanel3DWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(STORED_3D_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 200 ? stored : 320;
  });
  const [resizing, setResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  // Track viewport size for mobile breakpoint
  useEffect(() => {
    const onResize = () => {
      const m = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(m);
      if (!m) {
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Default to 2D-only on mobile (split is too cramped on phones)
  useEffect(() => {
    if (isMobile && viewMode === 'split') setViewMode('2d');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Bootstrap: prefer the autosaved project from localStorage; fall back to
  // the whole-site demo so a first-time visitor sees a fully-populated
  // project. The simple sample remains as a safety net should the
  // whole-site factory ever throw during construction.
  useEffect(() => {
    if (!bootstrapped) {
      const stored = loadStoredProject();
      let project = stored;
      if (!project) {
        try {
          project = createWholeSiteSampleProject();
        } catch (err) {
          console.error('[opencad] whole-site sample failed, falling back', err);
          project = createSampleProject();
        }
      }
      setProject(project);
      setBootstrapped(true);
    }
  }, [bootstrapped, setProject]);

  // Autosave: persist the project to localStorage with a short debounce so
  // every keystroke doesn't hit storage. Skip the very first render before
  // the bootstrap project is installed. If the browser refuses (quota), we
  // surface a status message so the user knows autosave is paused.
  useEffect(() => {
    if (!bootstrapped) return;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        const result = saveStoredProject(useStore.getState().project);
        if (!result.ok && result.reason === 'quota') {
          useStore.getState().setStatus('Autosave paused: browser storage full. Use File → Save to download a copy.');
        }
      }, 400);
    });
    return () => {
      unsub();
      window.clearTimeout(saveTimerRef.current);
    };
  }, [bootstrapped]);

  // View-history recording: any settled viewport change (i.e. one that
  // hasn't been followed by another change in 350ms) gets pushed onto the
  // viewport history stack. Navigation via viewBack/viewForward sets the
  // viewport to a value already on the stack, so recordView no-ops in that
  // case (it deduplicates against the current stack entry).
  useEffect(() => {
    if (!bootstrapped) return;
    let timer: number | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.editor.viewport === prev.editor.viewport) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => useStore.getState().recordView(), 350);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [bootstrapped]);

  // Track collab active state for the PresenceLayer toggle. The
  // runtime exposes a tiny pub/sub bridge so we can mount/unmount the
  // overlay without re-importing the Yjs chunk on every render.
  useEffect(() => {
    return onCollabActiveChange(setCollabActiveLocal);
  }, []);

  // If the page was opened with a #collab=ROOM hash, auto-open the
  // collaboration modal so the user can join with one click. The
  // hash only triggers the modal — the user still has to confirm.
  useEffect(() => {
    if (!bootstrapped) return;
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash.startsWith('#collab=')) setCollabOpen(true);
  }, [bootstrapped]);

  // Global F-key shortcuts that don't fit in the canvas
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'F7') { e.preventDefault(); useStore.getState().setSnap({ grid: !useStore.getState().editor.snap.grid }); }
      if (e.key === 'F9') { e.preventDefault(); useStore.getState().setSnap({ enabled: !useStore.getState().editor.snap.enabled }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Splitter drag handlers
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = window.innerWidth - e.clientX - 280; // 280 = right panel width
      const clamped = Math.max(220, Math.min(900, next));
      setPanel3DWidth(clamped);
    };
    const onUp = () => {
      setResizing(false);
      localStorage.setItem(STORED_3D_WIDTH_KEY, String(panel3DWidth));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, panel3DWidth]);

  const zoomBy = (factor: number) => {
    const v = useStore.getState().editor.viewport;
    useStore.getState().setViewport({
      ...v,
      zoom: Math.max(0.05, Math.min(200, v.zoom * factor)),
    });
  };
  const fitToPage = () => {
    const state = useStore.getState();
    const sheet = state.project.sheets[state.project.activeSheetId];
    if (!sheet) return;
    const canvas = document.querySelector('canvas.canvas-2d') as HTMLCanvasElement | null;
    const w = canvas?.clientWidth ?? window.innerWidth - 500;
    const h = canvas?.clientHeight ?? window.innerHeight - 200;
    state.setViewport(fitViewportToSheet(sheet, w, h));
  };

  return (
    <div className="app" style={resizing ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <MenuBar
        onShowBom={() => setBomOpen(true)}
        onShowAbout={() => setAboutOpen(true)}
        onShowCableSchedule={() => setCableScheduleOpen(true)}
        onShowCompliance={() => setComplianceOpen(true)}
        onShowCatalogue={() => setCatalogueOpen(true)}
        onShowCost={() => setCostOpen(true)}
        onShowCrossSection={() => {
          const editor = useStore.getState().editor;
          const sel = Array.from(editor.selection);
          const project = useStore.getState().project;
          const sheet = project.sheets[project.activeSheetId];
          const cont = sel.find((id) => sheet?.entities[id]?.kind === 'containment');
          if (cont) setCrossSectionEntityId(cont);
          else alert('Select a containment entity first.');
        }}
        onShowCollaboration={() => setCollabOpen(true)}
      />
      <Ribbon />
      <LeftPanel open={leftOpen} />
      <div className="main">
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {viewMode !== '3d' && <CadCanvas />}
          {/* Remote-cursor + selection overlay. Positioned absolutely
              over the canvas; pointer-events: none so it never steals
              clicks. Only renders when a session is active. */}
          {collabActive && viewMode !== '3d' && <PresenceLayer />}
          {viewMode === 'split' && !isMobile && (
            <div
              className="splitter"
              onMouseDown={() => setResizing(true)}
              title="Drag to resize 3D panel"
            />
          )}
          {viewMode === 'split' && !isMobile && <Panel3DContainer width={panel3DWidth} />}
          {viewMode === '3d' && <Panel3DContainer fillParent />}
        </div>
        <SiteNavigator />
      </div>
      <RightPanel open={rightOpen} />
      <StatusBar />

      {/* Mobile-only floating buttons */}
      {isMobile && (leftOpen || rightOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => { setLeftOpen(false); setRightOpen(false); }}
        />
      )}
      {isMobile && (
        <>
          <button
            className="mobile-fab fab-left"
            onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false); }}
            title="Symbols & Layers"
          >☰</button>
          <button
            className="mobile-fab fab-right"
            onClick={() => { setRightOpen(!rightOpen); setLeftOpen(false); }}
            title="Properties"
          >ⓘ</button>
          <button className="mobile-fab fab-zoomin" onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
          <button className="mobile-fab fab-zoomout" onClick={() => zoomBy(0.8)} title="Zoom out">−</button>
          <button className="mobile-fab fab-fit" onClick={fitToPage} title="Fit page" style={{ fontSize: 16 }}>⊡</button>
        </>
      )}

      {bomOpen && <BomModal onClose={() => setBomOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {cableScheduleOpen && <CableScheduleModal onClose={() => setCableScheduleOpen(false)} />}
      {complianceOpen && <ComplianceDashboard onClose={() => setComplianceOpen(false)} />}
      {catalogueOpen && <CatalogueBrowser onClose={() => setCatalogueOpen(false)} />}
      {costOpen && <CostEstimationModal onClose={() => setCostOpen(false)} />}
      {crossSectionEntityId && (
        <CrossSectionEditor
          entityId={crossSectionEntityId}
          onClose={() => setCrossSectionEntityId(null)}
        />
      )}
    </div>
  );
}
