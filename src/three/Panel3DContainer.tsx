import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Panel3D, type DoorMode, type ViewPreset } from './Panel3D';
import { useStore } from '../state/store';

// Lazy-import the whole-site viewer so projects that only use the panel
// viewer don't pay the BuildingScene bundle cost up-front.
const SiteSceneViewer = lazy(() =>
  import('./SiteSceneViewer').then((m) => ({ default: m.SiteSceneViewer })),
);

interface Props {
  width?: number;
  fillParent?: boolean;
}

const PRESETS: { key: ViewPreset; label: string; title: string }[] = [
  { key: 'iso', label: '3/4', title: '3/4 view (default)' },
  { key: 'front', label: 'Front', title: 'Look straight at the panel face' },
  { key: 'top', label: 'Top', title: 'Look down from above' },
  { key: 'left', label: 'Left', title: 'Look from the left side' },
];

const DOOR_MODES: DoorMode[] = ['open', 'closed', 'hidden'];

// Decide which 3D viewer to mount. The site viewer takes over when:
//   - the active sheet is explicitly tagged sceneStyle = 'site', OR
//   - the project has a populated site/building/floor hierarchy and the
//     active sheet is a floor-plan style sheet (has floorId).
const shouldUseSiteViewer = (
  project: ReturnType<typeof useStore.getState>['project'],
): boolean => {
  const active = project.sheets[project.activeSheetId];
  if (active?.sceneStyle === 'site') return true;
  const hasSiteHierarchy =
    !!project.sites && Object.keys(project.sites).length > 0;
  if (hasSiteHierarchy && active?.floorId) return true;
  return false;
};

export function Panel3DContainer({ width = 320, fillParent = false }: Props) {
  // Deliberately a whole-project subscription: both child viewers take the
  // full project as a prop, and SiteSceneViewer keys its scene rebuild off
  // `project.modified` (bumped by every mutation). Narrowing here would skip
  // rebuilds the viewers rely on.
  const project = useStore((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: width, h: 600 });
  const [doorMode, setDoorMode] = useState<DoorMode>('open');
  const [view, setView] = useState<{ preset: ViewPreset; key: number }>({
    preset: 'iso',
    key: 0,
  });

  const useSite = useMemo(() => shouldUseSiteViewer(project), [project]);

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

  const containerStyle: React.CSSProperties = fillParent
    ? { flex: 1, minWidth: 0 }
    : { width, flexShrink: 0 };

  const applyPreset = (preset: ViewPreset) => {
    setView((v) => ({ preset, key: v.key + 1 }));
  };
  const cycleDoor = () => {
    const i = DOOR_MODES.indexOf(doorMode);
    setDoorMode(DOOR_MODES[(i + 1) % DOOR_MODES.length]);
  };

  return (
    <div ref={ref} className="canvas-3d" style={containerStyle}>
      {useSite ? (
        <Suspense
          fallback={
            <div className="canvas-3d-overlay" style={{ padding: 12 }}>
              Loading whole-site viewer…
            </div>
          }
        >
          <SiteSceneViewer
            project={project}
            width={size.w}
            height={size.h}
          />
        </Suspense>
      ) : (
        <>
          <Panel3D
            project={project}
            width={size.w}
            height={size.h}
            doorMode={doorMode}
            viewKey={view.key}
            viewPreset={view.preset}
          />
          <div className="canvas-3d-overlay">
            3D Panel View • drag to orbit • scroll to zoom
          </div>
          <div className="canvas-3d-controls">
            <div className="group" role="group" aria-label="View presets">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={view.preset === p.key ? 'active' : ''}
                  onClick={() => applyPreset(p.key)}
                  title={p.title}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyPreset(view.preset)}
                title="Reframe to current preset"
              >
                Fit
              </button>
            </div>
            <div className="group" role="group" aria-label="Door">
              <button
                type="button"
                onClick={cycleDoor}
                title="Cycle door: open → closed → hidden"
              >
                Door: {doorMode}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
