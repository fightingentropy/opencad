import * as THREE from 'three';
import type { Entity, PenetrationEntity, Project, Vec2, WallEntity } from '../types';
import type { Floor } from '../models/site';
import { defaultElevation } from './elevations';
import { detailBoxes, type DetailBox } from './ContainmentGeometry';

const finitePoint = (point: Vec2): boolean =>
  Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.abs(point.x) < 1e9 && Math.abs(point.y) < 1e9;

const dimension = (value: number | undefined, fallback: number): number | null =>
  value == null ? fallback : Number.isFinite(value) && value >= 4 && value <= 50000 ? value : null;

/** The closest valid segment supplies the route/wall direction at a crossing. */
function crossingDirection(points: Vec2[], point: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const distance = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    if (distance < bestDistance) {
      bestDistance = distance;
      const length = Math.sqrt(lengthSquared);
      best = { x: dx / length, y: dy / length };
    }
  }
  return best;
}

/**
 * Illustrative seal geometry from the declared crossing and opening. It does
 * not determine fire resistance or certify a product's installation details.
 * Coordinates are local to the floor, matching other BuildingScene renderers.
 */
export function renderPenetration3D(
  entity: PenetrationEntity,
  project: Project,
  floor: Floor,
  flipY?: number,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `penetration:${entity.id}`;
  root.userData.entityId = entity.id;
  if (!finitePoint(entity.position) || (flipY !== undefined && !Number.isFinite(flipY))) return root;

  // Prefer this exact sheet representation, then other sheets on the same
  // floor. Imported sheets are allowed to reuse local entity identifiers.
  const sheets = Object.values(project.sheets);
  const ownSheet = sheets.find((sheet) => sheet.entities[entity.id] === entity)
    ?? floor.sheetIds.map((id) => project.sheets[id]).find((sheet) => sheet?.entities[entity.id]);
  const find = (id: string): Entity | undefined => ownSheet?.entities[id]
    ?? floor.sheetIds.map((sheetId) => project.sheets[sheetId]?.entities[id]).find(Boolean);
  const parent = find(entity.penetrationOf);
  if (!parent || parent.kind !== 'containment' || !Array.isArray(parent.points)) return root;
  const direction = crossingDirection(parent.points, entity.position);
  if (!direction) return root;
  const barrier = find(entity.barrierEntityId);
  const wall: WallEntity | undefined = barrier?.kind === 'wall' ? barrier
    : barrier?.kind === 'fire-barrier' && barrier.wallEntityId && find(barrier.wallEntityId)?.kind === 'wall'
      ? find(barrier.wallEntityId) as WallEntity : undefined;
  const seal = project.penetrationSeals?.[entity.sealId];
  if (!barrier && !seal) return root;
  const width = dimension(parent.width, 100);
  const circular = parent.containmentType === 'conduit';
  const height = circular ? width : dimension(parent.height, 50);
  if (width == null || height == null) return root;
  const openingWidth = dimension(seal?.openingWidth, width + (circular ? 40 : 80));
  const openingHeight = dimension(seal?.openingHeight, height + (circular ? 40 : 80));
  if (openingWidth == null || openingHeight == null) return root;
  const bottom = defaultElevation(parent, floor);
  if (!Number.isFinite(bottom) || Math.abs(bottom) >= 1e9) return root;
  const wallThickness = dimension(wall?.thickness, 100);
  if (wallThickness == null) return root;
  let depth = wallThickness;
  if (wall) {
    const wallDirection = crossingDirection(wall.points, entity.position);
    if (!wallDirection) return root;
    const crossingCosine = Math.abs(direction.x * -wallDirection.y + direction.y * wallDirection.x);
    // Parallel routes do not define a meaningful through-wall sleeve.
    if (crossingCosine < 0.05) return root;
    depth /= crossingCosine;
  }
  if (depth > 50000) return root;

  root.position.set(entity.position.x, flipY == null ? entity.position.y : flipY - entity.position.y, bottom + height / 2);
  root.rotation.z = Math.atan2(flipY == null ? direction.y : -direction.y, direction.x);
  root.userData.systemId = entity.systemId ?? parent.systemId;
  root.userData.parentContainmentId = parent.id;
  root.userData.sealId = entity.sealId;
  root.userData.sealReference = seal?.reference;
  root.userData.sealStatus = seal?.status;
  root.userData.sealType = seal?.sealType;
  root.userData.requiredRating = seal?.requiredRating;
  root.userData.representation = 'illustrative-record-geometry';
  root.userData.opening = { width: openingWidth, height: openingHeight, depth };
  root.userData.openingUndersized = openingWidth < width || openingHeight < height;

  const steel = new THREE.MeshStandardMaterial({ color: 0xa7b2ba, metalness: 0.78, roughness: 0.34 });
  const sealant = new THREE.MeshStandardMaterial({ color: 0xb94238, metalness: 0, roughness: 0.91, side: THREE.DoubleSide });
  const addBoxes = (parts: DetailBox[], material: THREE.Material, name: string): void => {
    const mesh = detailBoxes(parts, material, name);
    if (mesh) root.add(mesh);
  };
  if (circular && Math.abs(openingWidth - openingHeight) < 0.1) {
    const outer = openingWidth / 2;
    const inner = Math.min(outer - 1, width / 2 + 2);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(outer + 3, outer + 3, depth, 24, 1, true), steel);
    sleeve.name = 'galvanised-collar';
    sleeve.rotation.z = Math.PI / 2;
    root.add(sleeve);
    for (const sign of [-1, 1]) {
      const infill = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, inner), outer, 24), sealant);
      infill.name = 'intumescent-collar-face';
      infill.rotation.y = Math.PI / 2;
      infill.position.x = sign * (depth / 2 + 1);
      root.add(infill);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(outer + 3, 2.5, 6, 24), steel);
      rim.name = 'collar-retaining-rim';
      rim.rotation.y = Math.PI / 2;
      rim.position.x = sign * (depth / 2 + 3);
      root.add(rim);
    }
  } else {
    const frame = Math.max(3, Math.min(8, Math.min(openingWidth, openingHeight) * 0.04));
    const sleeve: DetailBox[] = [];
    for (const sign of [-1, 1]) {
      sleeve.push({ x: 0, y: sign * (openingWidth + frame) / 2, z: 0, length: depth, width: frame, height: openingHeight + 2 * frame });
      sleeve.push({ x: 0, y: 0, z: sign * (openingHeight + frame) / 2, length: depth, width: openingWidth, height: frame });
    }
    addBoxes(sleeve, steel, 'galvanised-penetration-frame');
    const innerWidth = Math.min(openingWidth - 2, width + 8);
    const innerHeight = Math.min(openingHeight - 2, height + 8);
    const sideWidth = (openingWidth - innerWidth) / 2;
    const topHeight = (openingHeight - innerHeight) / 2;
    const infill: DetailBox[] = [];
    for (const side of [-1, 1]) {
      for (const sign of [-1, 1]) {
        const x = side * (depth / 2 + 5);
        infill.push({ x, y: sign * (innerWidth + sideWidth) / 2, z: 0, length: 10, width: sideWidth, height: openingHeight });
        infill.push({ x, y: 0, z: sign * (innerHeight + topHeight) / 2, length: 10, width: innerWidth, height: topHeight });
      }
    }
    addBoxes(infill, sealant, 'firestop-infill');
  }
  root.traverse((object) => {
    object.userData.entityId = entity.id;
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  root.updateMatrixWorld(true);
  return root;
}
