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

export function App() {
  const setProject = useStore((s) => s.setProject);
  const show3D = useStore((s) => s.editor.show3D);
  const [bomOpen, setBomOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

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

  return (
    <div className="app">
      <MenuBar onShowBom={() => setBomOpen(true)} onShowAbout={() => setAboutOpen(true)} />
      <Ribbon />
      <LeftPanel />
      <div className="main">
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <CadCanvas />
          {show3D && <Panel3DContainer />}
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
