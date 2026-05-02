import React, { useEffect, useRef, useState } from 'react';
import { Panel3D } from './Panel3D';
import { useStore } from '../state/store';

export function Panel3DContainer() {
  const project = useStore((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 600 });

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(ref.current);
    setSize({ w: ref.current.clientWidth, h: ref.current.clientHeight });
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="canvas-3d">
      <Panel3D project={project} width={size.w} height={size.h} />
      <div className="canvas-3d-overlay">
        3D Panel View • drag to orbit • scroll to zoom
      </div>
    </div>
  );
}
