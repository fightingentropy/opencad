// SiteSceneViewer — multi-floor / multi-building 3D viewer.
//
// Drives `buildBuildingScene(project)` and renders its returned Group
// inside a fresh Three.js renderer. Independent of Panel3D — Panel3D
// continues to render the legacy panel/single-floor scenes; this viewer
// shows the whole site (all buildings + all floors stacked at ffl).
//
// SceneControls are wired to a docked viewport toolbar:
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
import {
  containmentMeasurement,
  findContainment,
  floorForContainment,
  formatMm,
  horizontalClearanceMm,
  verticalClearanceMm,
  type MeasurementRow,
} from './measurements';
import { useStore } from '../state/store';
import { subscribeTo3DViewCommands } from '../lib/commands';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { entitySceneRoots, sceneEntities, type InstallationAppearance, type InstallationFilter } from './InstallationAppearance';
import { installationEntityLabel } from '../models/installation';
import { createHoverIntent, type HoverPoint } from './HoverIntent';
import {
  cancelComponentPlacement, commitComponentPlacement, componentPlacementPreview,
  setComponentPlacementPosition, useComponentPlacement,
} from '../state/component-placement';
import { renderContainment3D } from './ContainmentRender3D';
import { defaultElevation } from './elevations';
import {
  componentPreviewOffset, intersectComponentWorkplane, isPlacementClick,
  trackPlacementPointer, type ComponentWorkplane, type PlacementPointer,
} from './ComponentPlacement';
import './site-workspace.css';

interface Props {
  project: Project;
  width: number;
  height: number;
  containmentOnly?: boolean;
}

type WalkDirection = 'forward' | 'back' | 'left' | 'right';
type CameraView = 'iso' | 'top';

interface HoverInfo {
  x: number;
  y: number;
  title: string;
  rows: MeasurementRow[];
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  center: ScreenPoint;
}

interface VisibleContainmentBox {
  id: string;
  label: string;
  box: THREE.Box3;
  bounds: ScreenBounds;
  distanceToCamera: number;
}

type ViewScope = 'site' | 'floor';

const LINE_PICK_THRESHOLD_MM = 18;
const MAX_SITE_MEASUREMENT_DISTANCE_MM = 22000;
const MAX_FLOOR_MEASUREMENT_DISTANCE_MM = 28000;
const DIRECT_HOVER_MIN_MINOR_PX = 22;
const DIRECT_HOVER_MIN_AREA_PX = 9000;
const CLEARANCE_HOVER_MIN_MINOR_PX = 18;
const CLEARANCE_HOVER_MIN_AREA_PX = 7000;
const CLEARANCE_MIN_GAP_MM = 25;
const CLEARANCE_MAX_GAP_MM = 2500;
const CLEARANCE_MAX_BOX_DISTANCE_PX = 52;
const CLEARANCE_MAX_SEGMENT_DISTANCE_PX = 56;
const CLICK_PICK_MAX_BOX_DISTANCE_PX = 28;
const CLICK_PICK_MIN_MINOR_PX = 8;
const CLICK_PICK_MIN_AREA_PX = 500;

const WALK_KEYS: Record<string, WalkDirection> = {
  ArrowUp: 'forward',
  w: 'forward',
  W: 'forward',
  ArrowDown: 'back',
  s: 'back',
  S: 'back',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
};

// Compute the bounding sphere of a Three.js object for camera framing.
const objectBoundingSphere = (obj: THREE.Object3D): THREE.Sphere => {
  const box = visibleBoundingBox(obj);
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
  view: CameraView = 'iso',
): void => {
  const sphere = objectBoundingSphere(obj);
  const fovRad = (camera.fov * Math.PI) / 180;
  const limitingFov = 2 * Math.atan(Math.tan(fovRad / 2) * Math.min(1, camera.aspect));
  const fitDist = (sphere.radius / Math.sin(limitingFov / 2)) * 1.12;
  const dir = view === 'top'
    ? new THREE.Vector3(0, -0.001, 1).normalize()
    : obj.name.startsWith('equipment:')
    ? new THREE.Vector3(0.6, -1, 0.4).normalize()
    : new THREE.Vector3(-0.65, -0.8, 1.15).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, fitDist);
  camera.near = Math.max(1, Math.min(100, fitDist / 50));
  camera.far = fitDist + sphere.radius * 3;
  camera.updateProjectionMatrix();
  controls.update();
};

const placeWalkCamera = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  obj: THREE.Object3D,
): void => {
  const box = visibleBoundingBox(obj);
  if (box.isEmpty()) {
    frameObject(camera, controls, obj);
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const eyeHeight = 1650;
  const targetHeight = Math.min(box.max.z - 100, box.min.z + 2300);
  const eye = new THREE.Vector3(
    THREE.MathUtils.lerp(box.min.x, box.max.x, 0.22),
    THREE.MathUtils.lerp(box.min.y, box.max.y, 0.44),
    box.min.z + eyeHeight,
  );
  const target = new THREE.Vector3(center.x, center.y, targetHeight);
  if (target.distanceTo(eye) < 1000) {
    target.x = Math.min(box.max.x, eye.x + 3000);
  }

  camera.position.copy(eye);
  controls.target.copy(target);
  camera.near = 20;
  camera.far = Math.max(50000, Math.max(size.x, size.y, size.z) * 8);
  camera.updateProjectionMatrix();
  controls.update();
};

const walkStep = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  direction: WalkDirection,
  multiplier = 1,
  bounds?: THREE.Box3 | null,
): void => {
  const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
  forward.z = 0;
  if (forward.lengthSq() < 1e-6) {
    camera.getWorldDirection(forward);
    forward.z = 0;
  }
  if (forward.lengthSq() < 1e-6) return;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const distance = camera.position.distanceTo(controls.target);
  const step = Math.max(250, Math.min(2500, distance * 0.06)) * multiplier;
  const delta = new THREE.Vector3();

  switch (direction) {
    case 'forward':
      delta.copy(forward).multiplyScalar(step);
      break;
    case 'back':
      delta.copy(forward).multiplyScalar(-step);
      break;
    case 'left':
      delta.copy(right).multiplyScalar(-step);
      break;
    case 'right':
      delta.copy(right).multiplyScalar(step);
      break;
  }

  const nextCamera = camera.position.clone().add(delta);
  const nextTarget = controls.target.clone().add(delta);
  if (bounds && !bounds.isEmpty()) {
    const margin = 600;
    const minX = bounds.min.x + margin;
    const maxX = bounds.max.x - margin;
    const minY = bounds.min.y + margin;
    const maxY = bounds.max.y - margin;
    if (maxX > minX && maxY > minY) {
      const clampedX = THREE.MathUtils.clamp(nextCamera.x, minX, maxX);
      const clampedY = THREE.MathUtils.clamp(nextCamera.y, minY, maxY);
      const correction = new THREE.Vector3(
        clampedX - nextCamera.x,
        clampedY - nextCamera.y,
        0,
      );
      nextCamera.add(correction);
      nextTarget.add(correction);
    }
  }

  camera.position.copy(nextCamera);
  controls.target.copy(nextTarget);
  controls.update();
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
};

const visibleBoundingBox = (obj: THREE.Object3D): THREE.Box3 => {
  const box = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  const visit = (node: THREE.Object3D, ancestorsVisible: boolean): void => {
    const visible = ancestorsVisible && node.visible;
    if (!visible) return;
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Sprite) {
      box.expandByObject(node);
    }
    for (const child of node.children) visit(child, visible);
  };
  visit(obj, true);
  return box;
};

const entityIdFromObject = (obj: THREE.Object3D): string | null => {
  let cursor: THREE.Object3D | null = obj;
  while (cursor) {
    if (typeof cursor.userData.entityId === 'string') return cursor.userData.entityId;
    if (cursor.name.startsWith('containment:')) return cursor.name.slice('containment:'.length);
    cursor = cursor.parent;
  }
  return null;
};

const containmentRootFromObject = (
  obj: THREE.Object3D,
  root: THREE.Object3D,
  entityId: string,
): THREE.Object3D | null => {
  let cursor: THREE.Object3D | null = obj;
  while (cursor) {
    if (cursor.name === `containment:${entityId}`) return cursor;
    if (cursor === root) break;
    cursor = cursor.parent;
  }
  return null;
};

const isVisibleWithin = (obj: THREE.Object3D, root: THREE.Object3D): boolean => {
  let cursor: THREE.Object3D | null = obj;
  while (cursor) {
    if (!cursor.visible) return false;
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
};

const projectPointToScreen = (
  point: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
): ScreenPoint => {
  const p = point.clone().project(camera);
  return {
    x: rect.left + ((p.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - p.y) / 2) * rect.height,
  };
};

const projectBoxToScreen = (
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
): ScreenBounds => {
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ].map((corner) => projectPointToScreen(corner, camera, rect));

  const minX = Math.min(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxX = Math.max(...corners.map((p) => p.x));
  const maxY = Math.max(...corners.map((p) => p.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
};

const distanceToScreenBounds = (point: ScreenPoint, bounds: ScreenBounds): number => {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  return Math.hypot(dx, dy);
};

const distanceToScreenSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(point.x - x, point.y - y);
};

const screenBoundsMetrics = (bounds: ScreenBounds): {
  width: number;
  height: number;
  minor: number;
  area: number;
  finite: boolean;
} => {
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  return {
    width,
    height,
    minor: Math.min(width, height),
    area: width * height,
    finite: Number.isFinite(width) &&
      Number.isFinite(height) &&
      Number.isFinite(bounds.center.x) &&
      Number.isFinite(bounds.center.y),
  };
};

const hasReadableScreenScale = (
  bounds: ScreenBounds,
  minMinorPx: number,
  minAreaPx: number,
): boolean => {
  const metrics = screenBoundsMetrics(bounds);
  return metrics.finite && metrics.minor >= minMinorPx && metrics.area >= minAreaPx;
};

const maxMeasurementDistance = (scope: ViewScope): number => (
  scope === 'floor' ? MAX_FLOOR_MEASUREMENT_DISTANCE_MM : MAX_SITE_MEASUREMENT_DISTANCE_MM
);

const sheetIdForEntity = (project: Project, entityId: string): string | null => {
  for (const sheetId of project.sheetOrder) {
    if (project.sheets[sheetId]?.entities[entityId]) return sheetId;
  }
  return null;
};

const disposeSelectionHelper = (helper: THREE.BoxHelper): void => {
  helper.geometry.dispose();
  if (Array.isArray(helper.material)) {
    for (const material of helper.material) material.dispose();
  } else {
    helper.material.dispose();
  }
};

export function SiteSceneViewer({ project, width, height, containmentOnly = false }: Props) {
  const selection = useStore((s) => s.editor.selection);
  const placement = useComponentPlacement((state) => state.pending);
  const mountRef = useRef<HTMLDivElement>(null);
  const displayMenuRef = useRef<HTMLDetailsElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const sceneControlsRef = useRef<SceneControls | null>(null);
  const selectionHelpersRef = useRef<Map<string, THREE.BoxHelper>>(new Map());
  const selectedIdsRef = useRef<Set<string>>(new Set(selection));
  const animationRef = useRef<number | null>(null);
  const cancelHoverRef = useRef<(() => void) | null>(null);
  const walkHoldRef = useRef<number | null>(null);
  const walkBoundsRef = useRef<THREE.Box3 | null>(null);
  const framedOnceRef = useRef(false);
  const lastProjectIdRef = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Toolbar state (visible to the React UI). The actual scene is mutated
  // imperatively via SceneControls — these refs/state are just the latest
  // user-driven settings so a rebuild can re-apply them.
  const [viewScope, setViewScope] = useState<ViewScope>('floor');
  const [cameraView, setCameraView] = useState<CameraView>('iso');
  const singleFloor = viewScope === 'floor';
  const [floorId, setFloorId] = useState<FloorId | ''>(project.activeFloorId ?? '');
  const [systemId, setSystemId] = useState<SystemId | ''>('');
  const [wallOpacity, setWallOpacity] = useState(0.22);
  const [appearance, setAppearance] = useState<InstallationAppearance>('progress');
  const [installationFilter, setInstallationFilter] = useState<InstallationFilter>('all');
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [coversOpen, setCoversOpen] = useState(false);
  const [showCables, setShowCables] = useState(true);
  const [showSupports, setShowSupports] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showFirestops, setShowFirestops] = useState(true);
  const [floorSeparation, setFloorSeparation] = useState(0);
  const [isolatedId, setIsolatedId] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const projectRef = useRef(project);
  const floorIdRef = useRef<FloorId | ''>(floorId);
  const viewScopeRef = useRef<ViewScope>(viewScope);
  // Bumped to force a scene rebuild from the live project. We rebuild
  // when the underlying site / building / floor / sheets change.
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      const menu = displayMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = displayMenuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    window.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    floorIdRef.current = floorId;
  }, [floorId]);

  useEffect(() => {
    viewScopeRef.current = viewScope;
  }, [viewScope]);

  // Signature triggering a scene rebuild. We don't deep-compare the whole
  // project; instead we hash the parts that actually drive geometry.
  const projectSig = useMemo(() => JSON.stringify({
    id: project.id, sites: project.sites, buildings: project.buildings,
    floors: project.floors, systems: project.systems, cableSchedule: project.cableSchedule, penetrationSeals: project.penetrationSeals,
    sheets: project.sheetOrder.map((id) => {
      const sheet = project.sheets[id];
      if (!sheet) return null;
      return { ...sheet, entities: Object.fromEntries(Object.entries(sheet.entities).map(([id, entity]) => {
        const { installation: _installation, ...geometry } = entity;
        return [id, geometry];
      })) };
    }),
  }), [project]);

  useEffect(() => {
    cancelHoverRef.current?.();
  }, [project, width, height, viewScope, floorId, systemId, wallOpacity,
    appearance, installationFilter, panelsOpen, coversOpen, showCables,
    showSupports, showLabels, showFirestops, floorSeparation, isolatedId, resetTick, containmentOnly, cameraView]);

  const entityObject = (entityId: string): THREE.Object3D | null => {
    const root = sceneGroupRef.current;
    return root ? entitySceneRoots(root).find((obj) => obj.userData.entityId === entityId && !obj.userData.excludedFrom3D) ?? null : null;
  };

  const activeSceneObject = (): THREE.Object3D | null => {
    const group = sceneGroupRef.current;
    if (!group) return null;
    if (isolatedId) return entityObject(isolatedId) ?? group;
    if (singleFloor && floorId) {
      return group.getObjectByName(`floor:${floorId}`) ?? group;
    }
    return group;
  };

  const refreshWalkBounds = (): void => {
    const obj = activeSceneObject();
    walkBoundsRef.current = obj ? visibleBoundingBox(obj) : null;
  };

  const clearSelectionHelpers = (): void => {
    const scene = sceneRef.current;
    for (const helper of selectionHelpersRef.current.values()) {
      if (scene) scene.remove(helper);
      disposeSelectionHelper(helper);
    }
    selectionHelpersRef.current.clear();
  };

  const syncSelectionHelpers = (): void => {
    const scene = sceneRef.current;
    const group = sceneGroupRef.current;
    if (!scene || !group) {
      clearSelectionHelpers();
      return;
    }

    const keep = new Set<string>();
    for (const entityId of selectedIdsRef.current) {
      const target = entityObject(entityId);
      if (!target || !isVisibleWithin(target, group)) continue;
      keep.add(entityId);

      let helper = selectionHelpersRef.current.get(entityId);
      if (!helper) {
        helper = new THREE.BoxHelper(target, 0x2fa8ff);
        helper.name = `selection:${entityId}`;
        helper.userData.selectionHelper = true;
        selectionHelpersRef.current.set(entityId, helper);
        scene.add(helper);
      } else {
        helper.setFromObject(target);
      }
    }

    for (const [entityId, helper] of selectionHelpersRef.current) {
      if (keep.has(entityId)) continue;
      scene.remove(helper);
      disposeSelectionHelper(helper);
      selectionHelpersRef.current.delete(entityId);
    }
  };

  useEffect(() => {
    selectedIdsRef.current = new Set(selection);
    syncSelectionHelpers();
  });

  // ---------- One-time renderer / camera / lights setup -------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const initialW = mount.clientWidth || width || 800;
    const initialH = mount.clientHeight || height || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe3e5e7);
    scene.fog = new THREE.Fog(0xe3e5e7, 90000, 240000);
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

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      setRenderError(null);
    } catch {
      setRenderError('3D rendering is unavailable because WebGL could not start in this browser.');
      sceneRef.current = null;
      cameraRef.current = null;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(initialW, initialH, false);
    // Millimetre-thin sheet metal and wire mesh are much finer than a site
    // shadow texel. Direct/environment lighting avoids moving shadow acne.
    renderer.shadowMap.enabled = !containmentOnly;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const environment = environmentGenerator.fromScene(roomEnvironment, 0.04);
    scene.environment = environment.texture;
    roomEnvironment.dispose();
    environmentGenerator.dispose();
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = LINE_PICK_THRESHOLD_MM;

    const activePickRoot = (): THREE.Object3D | null => {
      const group = sceneGroupRef.current;
      if (!group) return null;
      const currentFloorId = floorIdRef.current;
      if (viewScopeRef.current === 'floor' && currentFloorId) {
        return group.getObjectByName(`floor:${currentFloorId}`) ?? group;
      }
      return group;
    };

    const visibleContainmentBoxes = (
      root: THREE.Object3D,
      rect: DOMRect,
    ): VisibleContainmentBox[] => {
      const out: VisibleContainmentBox[] = [];
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        if (!isVisibleWithin(obj, root) || !obj.name.startsWith('containment:')) return;
        const id = obj.name.slice('containment:'.length);
        const containment = findContainment(projectRef.current, id);
        if (!containment) return;
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return;
        const center = new THREE.Vector3();
        box.getCenter(center);
        const bounds = projectBoxToScreen(box, camera, rect);
        if (!screenBoundsMetrics(bounds).finite) return;
        out.push({
          id,
          label: containment.label || id,
          box,
          bounds,
          distanceToCamera: camera.position.distanceTo(center),
        });
      });
      return out;
    };

    const tooltipPosition = (event: HoverPoint): Pick<HoverInfo, 'x' | 'y'> => ({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 380)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 240)),
    });

    const pickContainment = (
      event: PointerEvent,
    ): { entityId: string; containmentRoot: THREE.Object3D } | null => {
      const root = activePickRoot();
      if (!root) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(root.children, true);

      for (const hit of hits) {
        if (!isVisibleWithin(hit.object, root)) continue;
        const entityId = entityIdFromObject(hit.object);
        if (!entityId || !findContainment(projectRef.current, entityId)) continue;
        const containmentRoot = containmentRootFromObject(hit.object, root, entityId);
        if (containmentRoot) return { entityId, containmentRoot };
      }

      const pointer = { x: event.clientX, y: event.clientY };
      const nearest = visibleContainmentBoxes(root, rect)
        .filter((box) => hasReadableScreenScale(
          box.bounds,
          CLICK_PICK_MIN_MINOR_PX,
          CLICK_PICK_MIN_AREA_PX,
        ))
        .map((box) => ({
          box,
          screenDistance: distanceToScreenBounds(pointer, box.bounds),
        }))
        .filter((item) => item.screenDistance <= CLICK_PICK_MAX_BOX_DISTANCE_PX)
        .sort((a, b) => (
          a.screenDistance - b.screenDistance ||
          a.box.distanceToCamera - b.box.distanceToCamera
        ))[0];

      if (nearest) {
        const containmentRoot = root.getObjectByName(`containment:${nearest.box.id}`);
        if (containmentRoot) return { entityId: nearest.box.id, containmentRoot };
      }
      return null;
    };

    const clearanceHover = (
      event: HoverPoint,
      root: THREE.Object3D,
      rect: DOMRect,
    ): HoverInfo | null => {
      const maxDistance = maxMeasurementDistance(viewScopeRef.current);
      const boxes = visibleContainmentBoxes(root, rect).filter((box) => (
        box.distanceToCamera <= maxDistance &&
        hasReadableScreenScale(box.bounds, CLEARANCE_HOVER_MIN_MINOR_PX, CLEARANCE_HOVER_MIN_AREA_PX)
      ));
      if (boxes.length < 2) return null;
      const pointer = { x: event.clientX, y: event.clientY };
      const nearest = boxes
        .map((box) => ({ box, screenDistance: distanceToScreenBounds(pointer, box.bounds) }))
        .filter((item) => item.screenDistance <= CLEARANCE_MAX_BOX_DISTANCE_PX)
        .sort((a, b) => a.screenDistance - b.screenDistance)
        .slice(0, 6);

      let best:
        | {
            a: VisibleContainmentBox;
            b: VisibleContainmentBox;
            faceClearance: number;
            verticalClearance: number;
            score: number;
          }
        | null = null;

      for (let i = 0; i < nearest.length; i++) {
        for (let j = i + 1; j < nearest.length; j++) {
          const a = nearest[i].box;
          const b = nearest[j].box;
          const faceClearance = horizontalClearanceMm(a.box, b.box);
          const verticalClearance = verticalClearanceMm(a.box, b.box);
          if (faceClearance < CLEARANCE_MIN_GAP_MM && verticalClearance < CLEARANCE_MIN_GAP_MM) {
            continue;
          }
          if (faceClearance > CLEARANCE_MAX_GAP_MM) continue;
          const segmentDistance = distanceToScreenSegment(pointer, a.bounds.center, b.bounds.center);
          if (segmentDistance > CLEARANCE_MAX_SEGMENT_DISTANCE_PX) continue;
          const screenDistance = nearest[i].screenDistance + nearest[j].screenDistance;
          const score = segmentDistance + screenDistance * 0.75 + faceClearance / 90;
          if (!best || score < best.score) {
            best = {
              a,
              b,
              faceClearance,
              verticalClearance,
              score,
            };
          }
        }
      }

      if (!best || best.score > 95) return null;
      return {
        ...tooltipPosition(event),
        title: 'Clearance between containments',
        rows: [
          { label: 'Face-to-face', value: formatMm(best.faceClearance) },
          { label: 'Vertical gap', value: formatMm(best.verticalClearance) },
          { label: 'A', value: best.a.label },
          { label: 'B', value: best.b.label },
        ],
      };
    };

    const resolveHover = (event: HoverPoint): HoverInfo | null => {
      const root = activePickRoot();
      if (!root) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(root.children, true);

      for (const hit of hits) {
        if (!isVisibleWithin(hit.object, root)) continue;
        const entityId = entityIdFromObject(hit.object);
        if (!entityId) continue;
        const containment = findContainment(projectRef.current, entityId);
        if (!containment) continue;
        const containmentRoot = containmentRootFromObject(hit.object, root, entityId);
        if (!containmentRoot) continue;
        const containmentBox = new THREE.Box3().setFromObject(containmentRoot);
        if (containmentBox.isEmpty()) continue;
        const containmentBounds = projectBoxToScreen(containmentBox, camera, rect);
        const containmentCenter = new THREE.Vector3();
        containmentBox.getCenter(containmentCenter);
        if (
          camera.position.distanceTo(containmentCenter) > maxMeasurementDistance(viewScopeRef.current) ||
          !hasReadableScreenScale(containmentBounds, DIRECT_HOVER_MIN_MINOR_PX, DIRECT_HOVER_MIN_AREA_PX)
        ) {
          continue;
        }
        const floor = floorForContainment(
          projectRef.current,
          containment.id,
          floorIdRef.current || undefined,
        );
        const measurement = containmentMeasurement(projectRef.current, containment, floor);
        return {
          ...tooltipPosition(event),
          title: measurement.title,
          rows: measurement.rows,
        };
      }

      return clearanceHover(event, root, rect);
    };

    const hoverIntent = createHoverIntent({
      resolve: resolveHover,
      show: setHoverInfo,
      hide: () => setHoverInfo(null),
    });
    const cancelHover = hoverIntent.cancel;
    cancelHoverRef.current = cancelHover;

    const handlePointerMove = (event: PointerEvent): void => {
      if (useComponentPlacement.getState().pending || event.buttons !== 0 || event.pointerType === 'touch') {
        cancelHover();
        return;
      }
      hoverIntent.move(event);
    };

    let pointerDown:
      | {
          x: number;
          y: number;
        }
      | null = null;

    const pickInstallation = (event: PointerEvent): { entityId: string } | null => {
      const root = activePickRoot();
      if (!root) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const entities = sceneEntities(projectRef.current);
      for (const hit of raycaster.intersectObjects(root.children, true)) {
        if (!isVisibleWithin(hit.object, root)) continue;
        const id = entityIdFromObject(hit.object);
        const entity = id ? entities.get(id) : null;
        if (id && entity && ['equipment', 'containment', 'fitting', 'support', 'riser', 'penetration', 'fire-barrier'].includes(entity.kind)) return { entityId: id };
      }
      return pickContainment(event);
    };

    const handlePointerDown = (event: PointerEvent): void => {
      cancelHover();
      if (event.button !== 0) return;
      pointerDown = { x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event: PointerEvent): void => {
      cancelHover();
      if (event.button !== 0 || !pointerDown) return;
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (dx * dx + dy * dy > 25) return;

      const picked = pickInstallation(event);
      const state = useStore.getState();
      if (!picked) {
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
          state.clearSelection();
          selectedIdsRef.current = new Set();
          syncSelectionHelpers();
        }
        return;
      }

      const currentProject = projectRef.current;
      const sheetId = sheetIdForEntity(currentProject, picked.entityId);
      if (sheetId && currentProject.activeSheetId !== sheetId) {
        state.setActiveSheet(sheetId);
      }

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        state.toggleInSelection(picked.entityId);
      } else {
        state.setSelection([picked.entityId]);
      }
      const entity = sceneEntities(currentProject).get(picked.entityId);
      state.setStatus(`Selected ${entity ? installationEntityLabel(entity) : picked.entityId} in 3D`);
      selectedIdsRef.current = new Set(useStore.getState().editor.selection);
      syncSelectionHelpers();
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerLeave = (): void => {
      cancelHover();
      pointerDown = null;
    };
    const handleHoverKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelHover();
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('pointercancel', handlePointerLeave);
    renderer.domElement.addEventListener('lostpointercapture', cancelHover);
    renderer.domElement.addEventListener('wheel', cancelHover, { passive: true });
    window.addEventListener('blur', handlePointerLeave);
    window.addEventListener('keydown', handleHoverKeyDown);
    document.addEventListener('visibilitychange', handlePointerLeave);

    // Lights — a daylight-interior look matching Panel3D's building mode.
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x808080, 0.5);
    hemi.position.set(0, 0, 2000);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
    sun.name = 'site-key-light';
    sun.position.set(15000, 20000, 25000);
    sun.castShadow = !containmentOnly;
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
    controls.minDistance = 100;
    controls.maxDistance = 200000;
    controls.maxPolarAngle = Math.PI * 0.51; // allow a level walkthrough view
    controls.addEventListener('start', cancelHover);
    // Includes damping, WASD, fit/focus and other camera changes. The render
    // loop itself stays independent of hover intent when the camera is still.
    controls.addEventListener('change', cancelHover);
    const updateClippingPlanes = (): void => {
      const box = walkBoundsRef.current;
      if (!box || box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      camera.near = Math.max(1, Math.min(100, camera.position.distanceTo(controls.target) / 50));
      camera.far = Math.max(camera.near + 1000, camera.position.distanceTo(sphere.center) + sphere.radius * 3);
      camera.updateProjectionMatrix();
    };
    controls.addEventListener('change', updateClippingPlanes);
    orbitRef.current = controls;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      cancelHover();
      const w = mount.clientWidth || initialW;
      const h = mount.clientHeight || initialH;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(mount);

    return () => {
      cancelHover();
      cancelHoverRef.current = null;
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (walkHoldRef.current !== null) {
        window.clearInterval(walkHoldRef.current);
        walkHoldRef.current = null;
      }
      ro.disconnect();
      clearSelectionHelpers();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('pointercancel', handlePointerLeave);
      renderer.domElement.removeEventListener('lostpointercapture', cancelHover);
      renderer.domElement.removeEventListener('wheel', cancelHover);
      window.removeEventListener('blur', handlePointerLeave);
      window.removeEventListener('keydown', handleHoverKeyDown);
      document.removeEventListener('visibilitychange', handlePointerLeave);
      controls.removeEventListener('start', cancelHover);
      controls.removeEventListener('change', cancelHover);
      controls.removeEventListener('change', updateClippingPlanes);
      controls.dispose();
      orbitRef.current = null;
      // Dispose the active scene group via SceneControls
      sceneControlsRef.current?.dispose();
      sceneControlsRef.current = null;
      if (sceneGroupRef.current) {
        scene.remove(sceneGroupRef.current);
        sceneGroupRef.current = null;
      }
      environment.dispose();
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

  useEffect(() => {
    framedOnceRef.current = false;
    if (rendererRef.current) rendererRef.current.shadowMap.enabled = !containmentOnly;
    const sun = sceneRef.current?.getObjectByName('site-key-light');
    if (sun instanceof THREE.DirectionalLight) sun.castShadow = !containmentOnly;
  }, [containmentOnly]);

  useEffect(() => {
    if (placement?.surface !== '3d') return;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const canvas = rendererRef.current?.domElement;
    const orbit = orbitRef.current;
    if (!scene || !camera || !canvas || !orbit) return;
    const sheet = placement.project.sheets[placement.sheetId];
    const floor = sheet?.floorId ? placement.project.floors?.[sheet.floorId] : undefined;
    const buildingId = floor?.buildingId ?? sheet?.buildingId;
    const building = buildingId ? placement.project.buildings?.[buildingId] : undefined;
    const entity = componentPlacementPreview({ x: 0, y: 0 });
    if (entity?.kind !== 'containment') return;
    const workplane: ComponentWorkplane = {
      originX: building?.gridOriginX ?? 0,
      originY: building?.gridOriginY ?? 0,
      floorElevation: floor?.ffl ?? 0,
      componentElevation: defaultElevation(entity, floor),
    };
    // The preview is built once around its local origin. Pointer motion only
    // translates it, so it cannot rebuild the installation or its materials.
    const ghost = renderContainment3D(entity, { floor, showCovers: false });
    ghost.name = 'component-placement-preview';
    ghost.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.color.setHex(0x629deb);
        material.metalness = 0;
        material.roughness = 0.8;
        material.transparent = true;
        material.opacity = 0.6;
        material.depthWrite = false;
      }
    });
    scene.add(ghost);
    cancelHoverRef.current?.();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    const raycaster = new THREE.Raycaster();
    let pointer: PlacementPointer | null = null;
    const initialRect = canvas.getBoundingClientRect();
    let lastPointer = { clientX: initialRect.left + initialRect.width / 2, clientY: initialRect.top + initialRect.height / 2 };
    const previewAtPointer = (): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      const inside = lastPointer.clientX >= rect.left && lastPointer.clientX <= rect.right
        && lastPointer.clientY >= rect.top && lastPointer.clientY <= rect.bottom;
      if (!inside || rect.width === 0 || rect.height === 0) {
        ghost.visible = false;
        setComponentPlacementPosition(null);
        return null;
      }
      raycaster.setFromCamera(new THREE.Vector2(
        (lastPointer.clientX - rect.left) / rect.width * 2 - 1,
        -(lastPointer.clientY - rect.top) / rect.height * 2 + 1,
      ), camera);
      const position = intersectComponentWorkplane(raycaster.ray, workplane);
      if (position) {
        const snap = useStore.getState().editor.snap;
        if (snap.enabled && snap.grid && snap.gridSize > 0) {
          position.x = Math.round(position.x / snap.gridSize) * snap.gridSize;
          position.y = Math.round(position.y / snap.gridSize) * snap.gridSize;
        }
        ghost.position.copy(componentPreviewOffset(position, workplane));
      }
      ghost.visible = position != null;
      setComponentPlacementPosition(position);
      return position;
    };
    const onMove = (event: PointerEvent): void => {
      lastPointer = event;
      previewAtPointer();
      if (pointer) {
        trackPlacementPointer(pointer, event.clientX, event.clientY);
        event.stopImmediatePropagation();
      }
    };
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      pointer = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragged: false };
      lastPointer = event;
      previewAtPointer();
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      // Capture precedes both OrbitControls and normal entity selection.
      event.stopImmediatePropagation();
    };
    const onUp = (event: PointerEvent): void => {
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      const click = isPlacementClick(pointer, event.clientX, event.clientY, event.pointerId);
      pointer = null;
      lastPointer = event;
      const position = previewAtPointer();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (click && position) commitComponentPlacement(position);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onLeave = (): void => {
      ghost.visible = false;
      setComponentPlacementPosition(null);
    };
    const onCancel = (): void => { pointer = null; onLeave(); };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, true);
    canvas.addEventListener('pointerup', onUp, true);
    canvas.addEventListener('pointercancel', onCancel, true);
    canvas.addEventListener('pointerleave', onLeave);
    orbit.addEventListener('change', previewAtPointer);
    previewAtPointer();
    return () => {
      if (pointer && canvas.hasPointerCapture(pointer.pointerId)) canvas.releasePointerCapture(pointer.pointerId);
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onCancel, true);
      canvas.removeEventListener('pointerleave', onLeave);
      orbit.removeEventListener('change', previewAtPointer);
      canvas.style.cursor = previousCursor;
      scene.remove(ghost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      ghost.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    };
  }, [placement]);

  const moveWalk = (direction: WalkDirection, multiplier = 1): void => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) return;
    walkStep(camera, orbit, direction, multiplier, walkBoundsRef.current);
  };

  const startWalkHold = (direction: WalkDirection): void => {
    moveWalk(direction);
    if (walkHoldRef.current !== null) window.clearInterval(walkHoldRef.current);
    walkHoldRef.current = window.setInterval(() => moveWalk(direction, 0.65), 55);
  };

  const stopWalkHold = (): void => {
    if (walkHoldRef.current === null) return;
    window.clearInterval(walkHoldRef.current);
    walkHoldRef.current = null;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const direction = WALK_KEYS[e.key];
      if (!direction) return;
      e.preventDefault();
      moveWalk(direction, e.shiftKey ? 2 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setIsolatedId(null);
    setSystemId('');
    setInstallationFilter('all');
    setFloorId(project.activeFloorId ?? Object.keys(project.floors ?? {})[0] ?? '');
    setViewScope('floor');
    setCameraView('iso');
    // Saved camera filters belong to the previous model, not a newly opened project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // ---------- Rebuild scene group when project changes --------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!scene || !camera || !orbit) return;

    if (lastProjectIdRef.current !== project.id) {
      framedOnceRef.current = false;
      lastProjectIdRef.current = project.id;
    }

    // Tear down previous build.
    if (sceneControlsRef.current) {
      sceneControlsRef.current.dispose();
      sceneControlsRef.current = null;
    }
    if (sceneGroupRef.current) {
      scene.remove(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }

    const { group, controls } = buildBuildingScene(project, { containmentOnly });
    scene.add(group);
    sceneGroupRef.current = group;
    sceneControlsRef.current = controls;

    // Re-apply user toolbar state to the freshly built scene.
    if (singleFloor && floorId) controls.isolateFloor(floorId);
    else controls.isolateFloor(null);
    if (systemId) controls.filterSystem(systemId);
    else controls.filterSystem(null);
    controls.setTransparency('walls', wallOpacity);
    controls.setInstallation(project, containmentOnly ? 'materials' : appearance, containmentOnly ? 'all' : installationFilter);
    controls.setPanelsOpen(panelsOpen);
    controls.setCoversOpen(containmentOnly || coversOpen);
    controls.setLayerVisible('cables', showCables);
    controls.setLayerVisible('supports', showSupports);
    controls.setLayerVisible('labels', showLabels);
    controls.setLayerVisible('firestops', showFirestops);
    controls.setExploded(singleFloor ? 0 : floorSeparation);
    controls.isolateEntity(isolatedId);

    // Frame on first build / explicit reset only — preserves user pose
    // when sheets get edited but the project structure stays the same.
    if (!framedOnceRef.current) {
      const frameTarget = activeSceneObject() ?? group;
      frameObject(camera, orbit, frameTarget, cameraView);
      framedOnceRef.current = true;
    }
    refreshWalkBounds();
    syncSelectionHelpers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSig, resetTick, containmentOnly]);

  // ---------- Imperatively apply control changes when toolbar shifts ------
  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    if (singleFloor && floorId) c.isolateFloor(floorId);
    else c.isolateFloor(null);
    refreshWalkBounds();
    syncSelectionHelpers();
    const obj = activeSceneObject();
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (obj && camera && orbit) {
      frameObject(camera, orbit, obj, cameraView);
    }
  }, [singleFloor, floorId, cameraView]);

  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    c.filterSystem(systemId || null);
    refreshWalkBounds();
    syncSelectionHelpers();
  }, [systemId]);

  useEffect(() => {
    const c = sceneControlsRef.current;
    if (!c) return;
    c.setTransparency('walls', wallOpacity);
  }, [wallOpacity]);

  useEffect(() => {
    const controls = sceneControlsRef.current;
    if (!controls) return;
    controls.setInstallation(project, containmentOnly ? 'materials' : appearance, containmentOnly ? 'all' : installationFilter);
    controls.setPanelsOpen(panelsOpen);
    controls.setCoversOpen(containmentOnly || coversOpen);
    controls.setLayerVisible('cables', showCables);
    controls.setLayerVisible('supports', showSupports);
    controls.setLayerVisible('labels', showLabels);
    controls.setLayerVisible('firestops', showFirestops);
    controls.setExploded(singleFloor ? 0 : floorSeparation);
    controls.isolateEntity(isolatedId);
    syncSelectionHelpers();
  }, [project, appearance, installationFilter, panelsOpen, coversOpen, showCables, showSupports, showLabels, showFirestops, floorSeparation, singleFloor, isolatedId, containmentOnly]);

  useEffect(() => {
    const onFocus = (event: Event) => {
      const { entityId, isolate, onFocused } = (event as CustomEvent<{entityId: string; isolate: boolean; onFocused?: () => void}>).detail;
      const obj = entityObject(entityId);
      const camera = cameraRef.current;
      const orbit = orbitRef.current;
      if (!obj || !camera || !orbit) {
        useStore.getState().setStatus('This component has no physical geometry in the current 3D scene.');
        return;
      }
      const focusedEntity = sceneEntities(projectRef.current).get(entityId);
      if (focusedEntity?.kind === 'support') { setShowSupports(true); sceneControlsRef.current?.setLayerVisible('supports', true); }
      if (focusedEntity?.kind === 'penetration') { setShowFirestops(true); sceneControlsRef.current?.setLayerVisible('firestops', true); }
      const sid = sheetIdForEntity(projectRef.current, entityId);
      const fid = sid ? projectRef.current.sheets[sid]?.floorId : undefined;
      if (fid) { setFloorId(fid); floorIdRef.current = fid; }
      setInstallationFilter('all');
      setSystemId('');
      sceneControlsRef.current?.filterSystem(null);
      sceneControlsRef.current?.setInstallation(projectRef.current, containmentOnly ? 'materials' : appearance, 'all');
      if (singleFloor && fid) sceneControlsRef.current?.isolateFloor(fid);
      setIsolatedId(isolate ? entityId : null);
      sceneControlsRef.current?.isolateEntity(isolate ? entityId : null);
      // Let the floor scope effect finish before applying the close inspection pose.
      requestAnimationFrame(() => {
        frameObject(camera, orbit, obj, cameraView);
        refreshWalkBounds();
        syncSelectionHelpers();
        onFocused?.();
      });
    };
    window.addEventListener('opencad:focus-entity', onFocus);
    return () => window.removeEventListener('opencad:focus-entity', onFocus);
  }, [appearance, singleFloor, containmentOnly, cameraView]);

  useEffect(() => subscribeTo3DViewCommands((command) => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) return;
    const offset = camera.position.clone().sub(orbit.target);
    let distance = offset.length();
    if (offset.lengthSq() === 0) camera.getWorldDirection(offset).negate();
    if (command.type === 'fit') {
      const object = activeSceneObject();
      if (!object) return;
      cancelComponentPlacement();
      const sphere = objectBoundingSphere(object);
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
      orbit.target.copy(sphere.center);
      refreshWalkBounds();
    } else {
      distance /= command.factor;
    }
    // Recenter along the existing heading, including a manually orbited pose.
    distance = THREE.MathUtils.clamp(distance, orbit.minDistance, orbit.maxDistance);
    camera.position.copy(orbit.target).add(offset.setLength(distance));
    orbit.update();
    // The active scene scope is captured by activeSceneObject/refreshWalkBounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [singleFloor, floorId, isolatedId]);

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
    if (floorId && floors.some((f) => f.id === floorId)) return;
    if (project.activeFloorId && floors.some((f) => f.id === project.activeFloorId)) {
      setFloorId(project.activeFloorId);
      return;
    }
    if (floors.length > 0) setFloorId(floors[0].id);
  }, [floors, floorId, project.activeFloorId]);

  const handleResetView = () => {
    cancelComponentPlacement();
    const obj = activeSceneObject();
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (obj && camera && orbit) {
      frameObject(camera, orbit, obj, cameraView);
      refreshWalkBounds();
    } else {
      framedOnceRef.current = false;
      setResetTick((t) => t + 1);
    }
  };

  return (
    <div className={`site-workspace${containmentOnly ? ' site-workspace-containment' : ''}${width < 850 ? ' site-workspace-compact' : ''}${width < 620 ? ' site-workspace-narrow' : ''}`}>
      <div className="site-view-header" role="toolbar" aria-label="3D model controls">
        {!renderError && <>
          {containmentOnly && <div className="site-view-mode" role="group" aria-label="View angle">
            <button type="button" className={cameraView === 'iso' ? 'active' : ''}
              aria-pressed={cameraView === 'iso'} onClick={() => { cancelComponentPlacement(); setCameraView('iso'); }} title="View from above at an angle">Iso</button>
            <button type="button" className={cameraView === 'top' ? 'active' : ''}
              aria-pressed={cameraView === 'top'} onClick={() => { cancelComponentPlacement(); setCameraView('top'); }} title="Look straight down into the open sections">Top</button>
          </div>}
          {!containmentOnly && <>
          <div className="site-scope-control" role="group" aria-label="3D scope">
            <button type="button" className={viewScope === 'site' ? 'active' : ''}
              aria-pressed={viewScope === 'site'} onClick={() => setViewScope('site')} title="Frame the full project">Project</button>
            <button type="button" className={viewScope === 'floor' ? 'active' : ''}
              aria-pressed={viewScope === 'floor'} onClick={() => setViewScope('floor')} title="Inspect one floor">Floor</button>
          </div>
          {singleFloor && floors.length > 0 && (
            <div className="site-floor-control" role="group" aria-label="Floor">
              <select aria-label="3D floor" value={floorId} onChange={(event) => setFloorId(event.target.value)}>
                {floors.map((floor) => <option key={floor.id} value={floor.id}>L{floor.level} · {floor.name}</option>)}
              </select>
            </div>
          )}
          {width < 620 ? (
            <select className="site-appearance-select" aria-label="Model appearance" value={appearance}
              onChange={(event) => setAppearance(event.target.value as InstallationAppearance)}>
              <option value="progress">Progress</option>
              <option value="materials">Materials</option>
              <option value="systems">Systems</option>
            </select>
          ) : <div className="site-view-mode" role="group" aria-label="Model appearance">
            {(['progress', 'materials', 'systems'] as const).map((mode) => (
              <button type="button" key={mode} className={appearance === mode ? 'active' : ''}
                aria-pressed={appearance === mode} onClick={() => setAppearance(mode)}>
                {mode === 'progress' ? 'Progress' : mode === 'materials' ? 'Materials' : 'Systems'}
              </button>
            ))}
          </div>}
          </>}
          <div className="site-view-actions">
            <div role="group" aria-label="Reset view">
              <button type="button" className={`site-toolbar-button${containmentOnly ? ' site-fit-button' : ''}`} onClick={handleResetView} title="Fit view" aria-label="Fit view">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M1.5 5V1.5H5 M11 1.5h3.5V5 M14.5 11v3.5H11 M5 14.5H1.5V11 M5 5h6v6H5V5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                {!containmentOnly && 'Fit View'}
              </button>
            </div>
            {!containmentOnly && <details className="site-controls-detail" ref={displayMenuRef}>
              <summary title="Layers & inspection">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 4h12 M2 8h12 M2 12h12" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M5 2.5v3 M11 6.5v3 M6 10.5v3" stroke="currentColor" strokeWidth="2.4" />
                </svg>
                Display
                <svg className="site-menu-chevron" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="m2 3.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </summary>
              <div className="site-display-panel">
                <div className="site-display-section">
                  <div className="site-control-label">Layers & inspection</div>
                  <div className="site-layer-controls">
                    <label><input type="checkbox" checked={showCables} onChange={(event) => setShowCables(event.target.checked)} />Routed cables</label>
                    <label><input type="checkbox" checked={showSupports} onChange={(event) => setShowSupports(event.target.checked)} />Supports & fixings</label>
                    <label><input type="checkbox" checked={showFirestops} onChange={(event) => setShowFirestops(event.target.checked)} />Fire-stop sleeves</label>
                    <label><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />Equipment labels</label>
                  </div>
                  <div className="site-inspection-controls">
                    <button type="button" onClick={() => setPanelsOpen((open) => !open)} className={panelsOpen ? 'active' : ''}
                      aria-pressed={panelsOpen}>{panelsOpen ? 'Close board doors' : 'Open board doors'}</button>
                    <button type="button" onClick={() => setCoversOpen((open) => !open)} className={coversOpen ? 'active' : ''}
                      aria-pressed={coversOpen}>{coversOpen ? 'Replace covers' : 'Remove covers'}</button>
                  </div>
                </div>
                <div className="site-display-section">
                  <div className="site-control-label">Visibility</div>
                  {systems.length > 0 && (
                    <label className="site-setting-row">
                      <span>System</span>
                      <select value={systemId} onChange={(event) => setSystemId(event.target.value)}
                        title="Filter installation by system" aria-label="3D system filter">
                        <option value="">All systems</option>
                        {systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="site-setting-row">
                    <span>Progress</span>
                    <select aria-label="3D progress filter" value={installationFilter}
                      onChange={(event) => setInstallationFilter(event.target.value as InstallationFilter)}>
                      <option value="all">All installation states</option>
                      <option value="completed">Completed only</option>
                      <option value="in-progress">In progress only</option>
                      <option value="planned">Planned only</option>
                    </select>
                  </label>
                  <div className="site-setting-row" role="group" aria-label="Wall opacity">
                    <label htmlFor="site-wall-opacity" title="Wall transparency">Walls</label>
                    <div className="site-range-control">
                      <input id="site-wall-opacity" type="range" aria-label="Wall opacity" min={0} max={1} step={0.05}
                        value={wallOpacity} onChange={(event) => setWallOpacity(parseFloat(event.target.value))} />
                      <output htmlFor="site-wall-opacity">{Math.round(wallOpacity * 100)}%</output>
                    </div>
                  </div>
                  {!singleFloor && (
                    <div className="site-setting-row">
                      <label htmlFor="site-floor-separation">Floor spacing</label>
                      <div className="site-range-control">
                        <input id="site-floor-separation" type="range" aria-label="Separate floors" min={0} max={6000} step={500}
                          value={floorSeparation} onChange={(event) => setFloorSeparation(Number(event.target.value))} />
                        <output htmlFor="site-floor-separation">{floorSeparation / 1000} m</output>
                      </div>
                    </div>
                  )}
                </div>
                <div className="site-display-section site-walk-setting">
                  <button type="button" onClick={() => {
                    const object = activeSceneObject();
                    if (object && cameraRef.current && orbitRef.current) placeWalkCamera(cameraRef.current, orbitRef.current, object);
                    if (displayMenuRef.current) displayMenuRef.current.open = false;
                  }}>Walk at eye level</button>
                  <span>WASD or arrow keys</span>
                </div>
              </div>
            </details>}
          </div>
        </>}
      </div>
      <div className="site-viewport">
        <div ref={mountRef} className="site-render-surface" />
        {renderError && <div className="canvas-3d-fallback">{renderError}</div>}
        {placement?.surface === '3d' && <div className="site-placement-hint" role="status">
          <span>{placement.hint}</span>
          <button type="button" onClick={() => cancelComponentPlacement()} title="Cancel placement (Esc)" aria-label="Cancel placement">×</button>
        </div>}
        {isolatedId && (
          <div className="site-selection-banner">
            <span>Isolated component</span>
            <button type="button" onClick={() => { setIsolatedId(null); sceneControlsRef.current?.isolateEntity(null); handleResetView(); }}>Show context</button>
          </div>
        )}
        {!renderError && hoverInfo && (
          <div className="canvas-3d-tooltip" role="tooltip" style={{ left: hoverInfo.x, top: hoverInfo.y }}>
            <div className="title">{hoverInfo.title}</div>
            {hoverInfo.rows.map((row) => (
              <div className="row" key={`${row.label}:${row.value}`}><span>{row.label}</span><strong>{row.value}</strong></div>
            ))}
          </div>
        )}
      </div>
      {!renderError && !containmentOnly && (
        <div className="site-statusbar">
          <span className="site-navigation-hint">Drag to orbit · scroll to zoom {!containmentOnly && <span>· WASD to walk</span>}</span>
          <span className="site-selection-status">{selection.size > 0 ? `${selection.size} selected` : 'Click a part to inspect'}</span>
          {!containmentOnly && (appearance === 'progress' ? (
            <div className="site-status-legend" aria-label="Installation status legend">
              <span><i className="site-status-mark completed" />Completed</span>
              <span><i className="site-status-mark in-progress" />In progress</span>
              <span><i className="site-status-mark planned" />Planned</span>
            </div>
          ) : <span className="site-appearance-status">{appearance === 'materials' ? 'Material finishes' : 'System colours'}</span>)}
        </div>
      )}
    </div>
  );
}
