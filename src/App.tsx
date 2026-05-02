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

export function App() {
  const setProject = useStore((s) => s.setProject);
  const show3D = useStore((s) => s.editor.show3D);
  const [bomOpen, setBomOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [panel3DWidth, setPanel3DWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(STORED_3D_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 200 ? stored : 320;
  });
  const [resizing, setResizing] = useState(false);

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

  return (
    <div className="app" style={resizing ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <MenuBar onShowBom={() => setBomOpen(true)} onShowAbout={() => setAboutOpen(true)} />
      <Ribbon />
      <LeftPanel />
      <div className="main">
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <CadCanvas />
          {show3D && (
            <>
              <div
                className="splitter"
                onMouseDown={() => setResizing(true)}
                title="Drag to resize 3D panel"
              />
              <Panel3DContainer width={panel3DWidth} />
            </>
          )}
        </div>
        <SheetTabs />
      </div>
      <RightPanel />
      <StatusBar />
      {bomOpen && <BomModal onClose={() => setBomOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
