// SiteSceneViewer — multi-floor / multi-building 3D viewer.
//
// Drives `buildBuildingScene(project)` and renders its returned Group
// inside a fresh Three.js renderer. Independent of Panel3D — Panel3D
// continues to render the legacy panel/single-floor scenes; this viewer
// shows the whole site (all buildings + all floors stacked at ffl).
//
// SceneControls are wired to a small floating toolbar:
//   - Single Floor / Whole Site toggle
//   - Floor isolation drop-down
//   - System filter drop-down
//   - Wall transparency slider
//   - Reset View button
//
// The viewer is intentionally lazy-imported by Panel3DContainer so
// projects that only use the panel viewer don't pay the BuildingScene
// bundle cost up-front.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Project } from '../types';
import type { FloorId, SystemId } from '../models/site';
import {
  buildBuildingScene,
  type SceneControls,
} from './BuildingScene';

interface Props {
  project: Project;
  width: number;
  height: number;
}

// Compute the bounding sphere of a Three.js object for camera framing.
const objectBoundingSphere = (obj: THREE.Object3D): THREE.Sphere => {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = new THREE.Sphere();
  if (box.isEmpty()) {
    sphere.set(new THREE.Vector3(), 5000);
    return sphere;
  }
  box.getBoundingSphere(sphere);
  if (!Number.isFinite(sphere.radius) || sphere.radius < 1) sphere.radius = 5000;
  return sphere;
};

// Frame the given object inside the camera view at a comfortable distance.
const frameObject = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  obj: THREE.Object3D,
): void => {
  const sphere = objectBoundingSphere(obj);
  const fovRad = (camera.fov * Math.PI) / 180;
  const fitDist = (sphere.radius / Math.sin(fovRad / 2)) * 0.85;
  const dir = new THREE.Vector3(-0.6, -0.6, 0.55).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, fitDist);
  camera.near = Math.max(1, fitDist / 1000);
  camera.far = fitDist * 10 + sphere.radius * 4;
  camera.updateProjectionMatrix();
  controls.update();
};

export function SiteSceneViewer({ project, width, height }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const sceneControlsRef = useRef<SceneControls | null>(null);
  const animationRef = useRef<number | null>(null);

  // Toolbar state (visible to the React UI). The actual scene is mutated
  // imperatively via SceneControls — these refs/state are just the latest
  // user-driven settings so a rebuild can re-apply them.
  const [singleFloor, setSingleFloor] = useState(false);
  const [floorId, setFloorId] = useState<FloorId | ''>('');
  const [systemId, setSystemId] = useState<SystemId | ''>('');
  const [wallOpacity, setWallOpacity] = useState(1);
  // Bumped to force a scene rebuild from the live project. We rebuild
  // when the underlying site / building / floor / sheets change.
  const [resetTick, setResetTick] = useState(0);

  // Signature triggering a scene rebuild. We don't deep-compare the whole
  // project; instead we hash the parts that actually drive geometry.
  const projectSig = useMemo(() => {
    const sites = project.sites ? Object.keys(project.sites).join(',') : '';
    const buildings = project.buildings ? Object.keys(project.buildings).join(',') : '';
    const floors = project.floors
      ? Object.values(project.floors).map((f) => `${f.id}:${f.ffl}:${f.sheetIds.join(',')}`).join('|')
      : '';
    let sheetEntities = 0;
    for (const sid of project.sheetOrder) {
      const s = project.sheets[sid];
      if (!s) continue;
      sheetEntities += s.entityOrder.length;
    }
    return `${sites}#${buildings}#${floors}#${sheetEntities}`;
  }, [project]);

  // ---------- One-time renderer / camera / lights setup -------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const initialW = mount.clientWidth || width || 800;
    const initialH = mount.clientHeight || height || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc4cdd4);
    scene.fog = new THREE.Fog(0xc4cdd4, 30000, 200000);
    sceneRef.current = scene;

    // Camera with z-up so vertical riser lengths read correctly.
    const camera = new THREE.PerspectiveCamera(
      45,
      initialW / Math.max(1, initialH),
      10,
      400000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(20000, 20000, 18000);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(initialW, initialH, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    // Lights — a daylight-interior look matching Panel3D's building mode.
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x808080, 0.5);
    hemi.position.set(0, 0, 2000);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
    sun.position.set(15000, 20000, 25000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 80000;
    sun.shadow.camera.left = -25000;
    sun.shadow.camera.right = 25000;
    sun.shadow.camera.top = 25000;
    sun.shadow.camera.bottom = -25000;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa6c4ff, 0.4);
    fill.position.set(-12000, -8000, 8000);
    scene.add(fill);

    // OrbitControls from the canonical three example modules.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 500;
    controls.maxDistance = 200000;
    controls.maxPolarAngle = Math.PI * 0.495; // keep camera above the slabs
    orbitRef.current = controls;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || initialW;
      const h = mount.clientHeight || initialH;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(mount);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      ro.disconnect();
      controls.dispose();
      orbitRef.current = null;
      // Dispose the active scene group via SceneControls
      sceneControlsRef.current?.dispose();
      sceneControlsRef.current = null;
      if (sceneGroupRef.current) {
        scene.remove(sceneGroupRef.current);
        sceneGroupRef.current = null;
      }
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Rebuild scene group when project changes --------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!scene || !camera || !orbit) return;

    // Tear down previous build.
    if (sceneControlsRef.current) {
      sceneControlsRef.current.dispose();
      sceneControlsRef.current = null;
    }
    if (sceneGroupRef.current) {
      scene.remove(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }

    const { group, controls } = buildBuildingScene(project);
    scene.add(group);
    sceneGroupRef.current = group;
    sceneControlsRef.current = controls;

    // Re-apply user toolbar state to the freshly built scene.
    if (singleFloor && floorId) controls.isolateFloor(floorId);
    else controls.isolateFloor(null);
    if (systemId) controls.filterSystem(systemId);
    else controls.filterSystem(null);
    if (wallOpacity < 1) controls.setTransparency('walls', wallOpacity);

    // Frame on first build / explicit reset only — preserves user pose
    // when sheets get edited but the project structure stays the same.
    if (resetTick > 0 || !group.userData.framedOnce) {
      frameObject(camera, orbit, group);
      group.userData.framedOnce = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSig, resetTick]);

  // ---------- Imperatively apply control changes when toolbar shifts ------
  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    if (singleFloor && floorId) c.isolateFloor(floorId);
    else c.isolateFloor(null);
  }, [singleFloor, floorId]);

  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    c.filterSystem(systemId || null);
  }, [systemId]);

  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    c.setTransparency('walls', wallOpacity);
  }, [wallOpacity]);

  // ---------- Floor / system option lists for the toolbar ------------------
  const floors = useMemo(() => {
    const list: { id: string; name: string; level: number }[] = [];
    if (!project.floors) return list;
    for (const f of Object.values(project.floors)) {
      list.push({ id: f.id, name: f.name, level: f.level });
    }
    list.sort((a, b) => a.level - b.level);
    return list;
  }, [project.floors]);

  const systems = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    if (!project.systems) return list;
    for (const s of Object.values(project.systems)) {
      list.push({ id: s.id, name: s.name });
    }
    return list;
  }, [project.systems]);

  // Keep a sane default floor selection — first floor in the list, if any.
  useEffect(() => {
    if (!floorId && floors.length > 0) setFloorId(floors[0].id);
  }, [floors, floorId]);

  const handleResetView = () => {
    setResetTick((t) => t + 1);
  };

  return (
    <>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div className="canvas-3d-overlay">
        Whole-Site View · drag to orbit · scroll to zoom
      </div>
      <div className="canvas-3d-controls" style={{ minWidth: 200 }}>
        <div className="group" role="group" aria-label="Floor mode">
          <button
            type="button"
            className={singleFloor ? '' : 'active'}
            onClick={() => setSingleFloor(false)}
            title="Show all floors stacked"
          >
            Whole Site
          </button>
          <button
            type="button"
            className={singleFloor ? 'active' : ''}
            onClick={() => setSingleFloor(true)}
            title="Isolate a single floor"
          >
            Single Floor
          </button>
        </div>
        {singleFloor && floors.length > 0 && (
          <div className="group" role="group" aria-label="Floor">
            <select
              value={floorId}
              onChange={(e) => setFloorId(e.target.value)}
              style={selectStyle}
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  L{f.level} · {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {systems.length > 0 && (
          <div className="group" role="group" aria-label="System filter">
            <select
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              style={selectStyle}
              title="Filter containment by system"
            >
              <option value="">All systems</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="group" role="group" aria-label="Wall opacity">
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              fontSize: 10,
              color: '#e6e8ec',
              fontFamily: 'var(--font-mono)',
            }}
            title="Wall transparency"
          >
            Walls
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={wallOpacity}
              onChange={(e) => setWallOpacity(parseFloat(e.target.value))}
              style={{ width: 90 }}
            />
          </label>
        </div>
        <div className="group" role="group" aria-label="Reset view">
          <button type="button" onClick={handleResetView} title="Frame the whole site">
            Reset View
          </button>
        </div>
      </div>
    </>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#e6e8ec',
  border: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  padding: '4px 8px',
  width: '100%',
  outline: 'none',
};
