import * as THREE from 'three';

/** Repeated construction detail uses one draw call and owns its geometry. */
export interface DetailBox {
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  height: number;
}

export function detailBoxes(
  parts: DetailBox[],
  material: THREE.Material,
  name: string,
): THREE.InstancedMesh | null {
  const valid = parts.filter((p) => Object.values(p).every(Number.isFinite)
    && p.length > 0 && p.width > 0 && p.height > 0);
  if (!valid.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, valid.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  valid.forEach((p, i) => {
    matrix.compose(position.set(p.x, p.y, p.z), rotation, scale.set(p.length, p.width, p.height));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

export function solidBox(
  length: number, width: number, height: number,
  x: number, y: number, z: number,
  material: THREE.Material, name?: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, width, height), material);
  mesh.position.set(x, y, z);
  mesh.name = name ?? '';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function finiteDimension(value: number | undefined, fallback: number, min = 1): number {
  return value != null && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

/**
 * Offset in the route's local cross-section, including at the first/last
 * vertices. Vector bisectors avoid angle-wrap discontinuities on westbound
 * runs. Tangent quadratic bends stay inside each corner's control polygon;
 * unlike a Catmull-Rom spline they never overshoot the ends of the route.
 */
export function roundedRoute(
  points: { x: number; y: number }[],
  z: number,
  radius: number,
  flipY?: number,
  offset = 0,
): THREE.CurvePath<THREE.Vector3> | null {
  if (!Number.isFinite(z)) return null;
  const clean: THREE.Vector3[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const point = new THREE.Vector3(p.x, flipY != null ? flipY - p.y : p.y, z);
    if (!clean.length || clean[clean.length - 1].distanceToSquared(point) > 0.01) clean.push(point);
  }
  if (clean.length < 2) return null;
  const vertices = clean.map((point, i) => {
    const incoming = i > 0 ? point.clone().sub(clean[i - 1]).normalize() : clean[1].clone().sub(point).normalize();
    const outgoing = i < clean.length - 1 ? clean[i + 1].clone().sub(point).normalize() : incoming.clone();
    const normalIn = new THREE.Vector3(-incoming.y, incoming.x, 0);
    const normalOut = new THREE.Vector3(-outgoing.y, outgoing.x, 0);
    const bisector = normalIn.clone().add(normalOut);
    if (bisector.lengthSq() < 0.0001) return point.clone().addScaledVector(normalIn, offset);
    bisector.normalize();
    const miter = offset / Math.max(0.5, bisector.dot(normalIn));
    return point.clone().addScaledVector(bisector, miter);
  });
  const curve = new THREE.CurvePath<THREE.Vector3>();
  let cursor = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const corner = vertices[i];
    const before = vertices[i - 1];
    const after = vertices[i + 1];
    const incoming = corner.clone().sub(before).normalize();
    const outgoing = after.clone().sub(corner).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1));
    // Nearly straight and reversing paths have no meaningful fillet.
    const tangent = angle < 0.01 || angle > Math.PI - 0.01 ? 0
      : Math.min(Math.max(0, radius) * Math.tan(angle / 2), before.distanceTo(corner) * 0.45, corner.distanceTo(after) * 0.45);
    const entry = corner.clone().addScaledVector(incoming, -tangent);
    const exit = corner.clone().addScaledVector(outgoing, tangent);
    if (cursor.distanceToSquared(entry) > 0.001) curve.add(new THREE.LineCurve3(cursor, entry));
    if (tangent > 0.001) curve.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    cursor = exit;
  }
  const last = vertices[vertices.length - 1];
  if (cursor.distanceToSquared(last) > 0.001) curve.add(new THREE.LineCurve3(cursor, last));
  return curve.curves.length ? curve : null;
}
