import React, { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { CadCanvas } from './canvas/CadCanvas';
import { MenuBar } from './ui/MenuBar';
import { Ribbon } from './ui/Ribbon';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { StatusBar } from './ui/StatusBar';
import { SheetTabs } from './ui/SheetTabs';
import { BomModal } from './ui/BomModal';
import { AboutModal } from './ui/AboutModal';
import { Panel3DContainer } from './three/Panel3DContainer';
import { createSampleProject } from './sample';

const STORED_3D_WIDTH_KEY = 'opencad.panel3dWidth';
const MOBILE_BREAKPOINT = 900;

export function App() {
  const setProject = useStore((s) => s.setProject);
  const viewMode = useStore((s) => s.editor.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const [bomOpen, setBomOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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

  // Load sample project on first mount so the app demos immediately
  useEffect(() => {
    if (!bootstrapped) {
      setProject(createSampleProject());
      setBootstrapped(true);
    }
  }, [bootstrapped, setProject]);

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
    import('./lib/fit').then(({ fitViewportToSheet }) => {
      state.setViewport(fitViewportToSheet(sheet, w, h));
    });
  };

  return (
    <div className="app" style={resizing ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <MenuBar onShowBom={() => setBomOpen(true)} onShowAbout={() => setAboutOpen(true)} />
      <Ribbon />
      <LeftPanel open={leftOpen} />
      <div className="main">
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {viewMode !== '3d' && <CadCanvas />}
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
        <SheetTabs />
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
    </div>
  );
}
