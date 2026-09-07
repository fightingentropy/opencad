import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  cancelComponentPlacement, commitComponentPlacement, componentPlacementPreview, resolvePlacementPosition,
  setComponentPlacementPosition, useComponentPlacement, type ComponentPlacement,
} from '../state/component-placement';
import { isPhysicalEntity, physicalAnchor, physicalElevation } from '../lib/scene-edit';
import { renderContainment3D } from './ContainmentRender3D';
import { renderEquipment3D } from './EquipmentRender3D';
import { renderSupport3D } from './SupportRender3D';
import { componentPreviewOffset, intersectComponentWorkplane, isPlacementClick, trackPlacementPointer, type ComponentWorkplane, type PlacementPointer } from './ComponentPlacement';
import type { PhysicalEntity } from '../lib/scene-edit';
import type { Floor } from '../models/site';

export interface ScenePointer { clientX: number; clientY: number; shiftKey?: boolean; }

export function disposePreview(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(part => {
    if (!(part instanceof THREE.Mesh || part instanceof THREE.Line || part instanceof THREE.Sprite)) return;
    if ('geometry' in part) geometries.add(part.geometry);
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

export function renderScenePlacementPreview(entity: PhysicalEntity, floor?: Floor): THREE.Object3D {
  const object = entity.kind === 'containment' ? renderContainment3D(entity, { floor, showCovers: false })
    : entity.kind === 'equipment' ? renderEquipment3D(entity, { showLabel: false })
      : renderSupport3D(entity, { containmentBottomZ: entity.elevation ?? 0 });
  if (entity.kind === 'support') object.position.set(entity.position.x, entity.position.y, 0);
  // Pointer translation belongs to a separate root. Equipment keeps its
  // own elevation on its child transform, just as it does after insertion.
  const preview = new THREE.Group();
  preview.name = 'component-placement-preview';
  preview.add(object);
  object.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = false;
    part.receiveShadow = false;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.color.setHex(0x4587c2);
      material.metalness = 0;
      material.roughness = 0.8;
      material.transparent = true;
      material.opacity = 0.65;
      material.depthWrite = false;
    }
  });
  return preview;
}

/** Keep the installed scene unchanged during motion. Commit only on release/click. */
export function attachScenePlacement({
  scene, camera, canvas, orbit, root, placement, pointerPosition,
}: {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement;
  orbit: OrbitControls; root: THREE.Group | null; placement: ComponentPlacement;
  pointerPosition: { current: ScenePointer | null };
}): () => void {
  const sheet = placement.project.sheets[placement.sheetId];
  const floor = sheet?.floorId ? placement.project.floors?.[sheet.floorId] : undefined;
  const buildingId = floor?.buildingId ?? sheet?.buildingId;
  const building = buildingId ? placement.project.buildings?.[buildingId] : undefined;
  const prototype = placement.prototype;
  if (!isPhysicalEntity(prototype)) return () => {};
  const floorObject = root?.getObjectByName('floor:' + floor?.id);
  const origin = floorObject?.getWorldPosition(new THREE.Vector3());
  const workplane: ComponentWorkplane = {
    originX: origin?.x ?? building?.gridOriginX ?? 0,
    originY: origin?.y ?? building?.gridOriginY ?? 0,
    floorElevation: origin?.z ?? floor?.ffl ?? 0,
    componentElevation: placement.elevation ?? physicalElevation(prototype, placement.project),
  };
  const shaping = placement.operation === 'endpoint' || placement.operation === 'extend';
  let ghost: THREE.Object3D | null = null;
  const replaceGhost = (entity: PhysicalEntity, offset: THREE.Vector3) => {
    if (ghost) { scene.remove(ghost); disposePreview(ghost); }
    ghost = renderScenePlacementPreview(entity, floor);
    ghost.position.add(offset);
    scene.add(ghost);
  };
  if (!shaping) {
    const preview = componentPlacementPreview({ x: 0, y: 0 });
    if (isPhysicalEntity(preview ?? undefined)) replaceGhost(preview as PhysicalEntity, new THREE.Vector3());
  }

  // Hide only the part being moved/reshaped and its generated accessories.
  const hidden: { object: THREE.Object3D; visible: boolean }[] = [];
  if (placement.source && placement.operation !== 'duplicate' && root) {
    const id = placement.source.id;
    const ids = new Set([id, ...Object.values(sheet.entities).filter(entity =>
      entity.kind === 'fitting' && entity.autoGenerated && entity.containmentId === id
      || entity.kind === 'support' && entity.autoGenerated && entity.supportingContainmentIds.includes(id)).map(entity => entity.id)]);
    root.traverse(object => {
      if (ids.has(object.userData.entityId) && !ids.has(object.parent?.userData.entityId)) {
        hidden.push({ object, visible: object.visible }); object.visible = false;
      }
    });
  }
  const previousCursor = canvas.style.cursor;
  const previousOrbitEnabled = orbit.enabled;
  canvas.style.cursor = placement.operation === 'move' ? 'grabbing' : 'crosshair';
  if (placement.drag) orbit.enabled = false;
  const raycaster = new THREE.Raycaster();
  const rect = canvas.getBoundingClientRect();
  let lastPointer: ScenePointer = placement.drag ?? pointerPosition.current
    ?? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  let pointer: PlacementPointer | null = placement.drag ? {
    pointerId: placement.drag.pointerId, x: placement.drag.clientX, y: placement.drag.clientY, dragged: false,
  } : null;
  const rayPoint = (point: ScenePointer) => {
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((point.clientX - bounds.left) / bounds.width * 2 - 1,
      -(point.clientY - bounds.top) / bounds.height * 2 + 1), camera);
    return intersectComponentWorkplane(raycaster.ray, workplane);
  };
  const dragStart = placement.drag ? rayPoint(placement.drag) : null;
  const dragAnchor = placement.source?.kind === 'containment' && shaping
    ? placement.source.points[placement.endpointIndex ?? 0] : physicalAnchor(prototype);
  let frame = 0;
  let lastGeometry = '';
  const previewAtPointer = (): { x: number; y: number } | null => {
    if (useComponentPlacement.getState().pending !== placement) return null;
    const bounds = canvas.getBoundingClientRect();
    const inside = lastPointer.clientX >= bounds.left && lastPointer.clientX <= bounds.right
      && lastPointer.clientY >= bounds.top && lastPointer.clientY <= bounds.bottom;
    if (!inside || bounds.width === 0 || bounds.height === 0) {
      if (ghost) ghost.visible = false;
      setComponentPlacementPosition(null); return null;
    }
    let position = rayPoint(lastPointer);
    if (!position) { if (ghost) ghost.visible = false; setComponentPlacementPosition(null); return null; }
    if (dragStart && placement.drag) position = { x: dragAnchor.x + position.x - dragStart.x, y: dragAnchor.y + position.y - dragStart.y };
    const distance = camera.position.distanceTo(new THREE.Vector3(position.x + workplane.originX, position.y + workplane.originY,
      workplane.floorElevation + workplane.componentElevation));
    const tolerance = Math.max(2, 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance / bounds.height * 12);
    const resolved = resolvePlacementPosition(position, tolerance, !!lastPointer.shiftKey);
    position = resolved.position;
    if (shaping) {
      const key = position.x.toFixed(2) + ',' + position.y.toFixed(2);
      if (key !== lastGeometry) {
        const preview = componentPlacementPreview(position);
        if (preview && isPhysicalEntity(preview)) replaceGhost(preview, componentPreviewOffset({ x: 0, y: 0 }, workplane));
        lastGeometry = key;
      }
    } else if (ghost) ghost.position.copy(componentPreviewOffset(position, workplane));
    if (ghost) ghost.visible = true;
    setComponentPlacementPosition(position, resolved.connection);
    return position;
  };
  const queuePreview = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; previewAtPointer(); });
  };
  const onMove = (event: PointerEvent) => {
    lastPointer = event; pointerPosition.current = event;
    queuePreview();
    if (pointer) { trackPlacementPointer(pointer, event.clientX, event.clientY); event.stopImmediatePropagation(); }
  };
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragged: false };
    lastPointer = event; pointerPosition.current = event;
    previewAtPointer();
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const onUp = (event: PointerEvent) => {
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const apply = !!placement.drag || isPlacementClick(pointer, event.clientX, event.clientY, event.pointerId);
    pointer = null;
    lastPointer = event; pointerPosition.current = event;
    const position = previewAtPointer();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (apply && position) commitComponentPlacement(position);
    else if (placement.drag) cancelComponentPlacement();
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const onLeave = () => {
    if (pointer) return;
    if (ghost) ghost.visible = false;
    setComponentPlacementPosition(null);
  };
  const onCancel = () => { pointer = null; cancelComponentPlacement(); };
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onCancel, true);
  canvas.addEventListener('pointerleave', onLeave);
  orbit.addEventListener('change', queuePreview);
  previewAtPointer();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    if (pointer && canvas.hasPointerCapture(pointer.pointerId)) canvas.releasePointerCapture(pointer.pointerId);
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove, true);
    canvas.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointercancel', onCancel, true);
    canvas.removeEventListener('pointerleave', onLeave);
    orbit.removeEventListener('change', queuePreview);
    orbit.enabled = previousOrbitEnabled;
    canvas.style.cursor = previousCursor;
    for (const item of hidden) item.object.visible = item.visible;
    if (ghost) { scene.remove(ghost); disposePreview(ghost); }
  };
}
