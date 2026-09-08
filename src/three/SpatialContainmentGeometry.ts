import * as THREE from 'three';
import type { ContainmentEntity } from '../types';
import { routePath } from '../lib/route-path';
import { roundedRoute } from './ContainmentGeometry';

interface Frame { point: THREE.Vector3; tangent: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; }

/** Transport through vertical legs; smoothly restore an upright section on horizontal legs. */
export function spatialRouteFrames(curve: THREE.Curve<THREE.Vector3>, steps: number): Frame[] {
  const frames: Frame[] = [];
  const first = curve.getTangentAt(0).normalize();
  let side = new THREE.Vector3(-first.y, first.x, 0);
  if (side.lengthSq() < 0.001) side.set(0, 1, 0);
  side.normalize();
  let previous = first;
  for (let i = 0; i <= steps; i++) {
    const tangent = curve.getTangentAt(i / steps).normalize();
    side.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previous, tangent));
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    const orientedSide = side.clone();
    const horizontal = Math.hypot(tangent.x, tangent.y);
    if (horizontal > 1e-6) {
      const uprightSide = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const angle = Math.atan2(tangent.dot(new THREE.Vector3().crossVectors(side, uprightSide)), side.dot(uprightSide));
      const weight = horizontal * horizontal * (3 - 2 * horizontal);
      orientedSide.applyAxisAngle(tangent, angle * weight);
    }
    const up = new THREE.Vector3().crossVectors(tangent, orientedSide).normalize();
    frames.push({ point: curve.getPointAt(i / steps), tangent, side: orientedSide, up });
    previous = tangent;
  }
  return frames;
}

const inFrame = (frame: Frame, side: number, up: number): THREE.Vector3 =>
  frame.point.clone().addScaledVector(frame.side, side).addScaledVector(frame.up, up);

function sweptProfile(frames: Frame[], profile: number[][]): THREE.BufferGeometry {
  const section = profile.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(section)) section.reverse();
  const rings = frames.map(frame => section.map(p => inFrame(frame, p.x, p.y)));
  const positions: number[] = [];
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (let i = 1; i < rings.length; i++) for (let j = 0; j < section.length; j++) {
    const next = (j + 1) % section.length;
    triangle(rings[i - 1][j], rings[i - 1][next], rings[i][next]);
    triangle(rings[i - 1][j], rings[i][next], rings[i][j]);
  }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(section, [])) {
    triangle(rings[0][c], rings[0][b], rings[0][a]);
    triangle(rings.at(-1)![a], rings.at(-1)![b], rings.at(-1)![c]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function spatialContainmentCurve(route: ContainmentEntity, baseElevation: number, flipY?: number): THREE.Curve<THREE.Vector3> | null {
  const width = Math.max(8, route.width ?? 100);
  const height = route.containmentType === 'conduit' ? width : Math.max(8, route.height ?? 50);
  const path = routePath(route).map(p => ({ ...p, z: p.z + baseElevation - (route.elevation ?? baseElevation) + height / 2 }));
  return roundedRoute(path, 0, route.containmentType === 'conduit' ? width * 3 : width * 1.5, flipY);
}

export function offsetSpatialCurve(curve: THREE.Curve<THREE.Vector3>, sideOffset: number, upOffset: number): THREE.Curve<THREE.Vector3> {
  const steps = Math.max(80, Math.min(1200, Math.ceil(curve.getLength() / 40)));
  const frames = spatialRouteFrames(curve, steps);
  return new class extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      const location = Math.max(0, Math.min(1, t)) * steps;
      const i = Math.min(steps - 1, Math.floor(location));
      const f = location - i;
      const side = frames[i].side.clone().lerp(frames[i + 1].side, f).normalize();
      const up = frames[i].up.clone().lerp(frames[i + 1].up, f).normalize();
      return target.copy(curve.getPointAt(t)).addScaledVector(side, sideOffset).addScaledVector(up, upOffset);
    }
  }();
}

/** Uses the same section dimensions throughout the bend, including its vertical portion. */
export function renderSpatialContainment(route: ContainmentEntity, material: THREE.MeshStandardMaterial, options: {
  baseElevation: number; flipY?: number; detailed?: boolean; showCovers?: boolean;
}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'spatial-containment-section';
  const width = Math.max(8, route.width ?? 100);
  const height = route.containmentType === 'conduit' ? width : Math.max(8, route.height ?? 50);
  const curve = spatialContainmentCurve(route, options.baseElevation, options.flipY);
  if (!curve) return root;
  const length = curve.getLength();
  const steps = Math.max(24, Math.min(options.detailed ? 800 : 320, Math.ceil(length / (options.detailed ? 70 : 140)) + route.points.length * 8));
  const frames = spatialRouteFrames(curve, steps);
  const add = (geometry: THREE.BufferGeometry, name: string, mat: THREE.Material = material) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh); return mesh;
  };
  if (route.containmentType === 'conduit') {
    const radius = width / 2, innerRadius = Math.max(width * 0.325, radius - 2);
    add(new THREE.TubeGeometry(curve, steps, radius, options.detailed ? 16 : 8, false), 'conduit-outer-wall');
    const innerMaterial = material.clone(); innerMaterial.side = THREE.BackSide;
    add(new THREE.TubeGeometry(curve, steps, innerRadius, options.detailed ? 16 : 8, false), 'conduit-inner-wall', innerMaterial);
    for (const t of [0, 1]) {
      const rim = add(new THREE.RingGeometry(innerRadius, radius, 16), 'conduit-rim');
      rim.position.copy(curve.getPointAt(t));
      rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(t));
    }
    return root;
  }
  const rectangle = (x: number, y: number, w: number, h: number, name: string) =>
    add(sweptProfile(frames, [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]]), name);
  const repeatedBoxes = (pitch: number, boxLength: number, boxWidth: number, boxHeight: number, z: number, name: string) => {
    const count = Math.max(2, Math.min(300, Math.ceil(length / pitch)));
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(boxLength, boxWidth, boxHeight), material, count);
    mesh.name = name; mesh.castShadow = true;
    for (let i = 0; i < count; i++) {
      const frame = frames[Math.round((i + 0.5) / count * steps)];
      const matrix = new THREE.Matrix4().makeBasis(frame.tangent, frame.side, frame.up);
      matrix.setPosition(inFrame(frame, 0, z)); mesh.setMatrixAt(i, matrix);
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh);
  };
  const thickness = 2;
  const bottom = -height / 2 + thickness / 2;
  if (route.containmentType === 'basket') {
    const wireRadius = 2.5;
    const wire = (side: number, up: number) => {
      const circle = Array.from({ length: 8 }, (_, i) => [side + Math.cos(i * Math.PI / 4) * wireRadius, up + Math.sin(i * Math.PI / 4) * wireRadius]);
      add(sweptProfile(frames, circle), 'basket-longitudinal-wire');
    };
    const columns = Math.max(2, Math.ceil(width / 50));
    for (let i = 0; i <= columns; i++) wire(-width / 2 + i * width / columns, -height / 2 + wireRadius);
    for (const side of [-1, 1]) for (let level = 1; level <= 2; level++) wire(side * width / 2, -height / 2 + level * height / 2);
    const count = Math.max(2, Math.min(250, Math.ceil(length / (options.detailed ? 100 : 160))));
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(wireRadius, wireRadius, 1, 6), material, count * 3);
    mesh.name = 'basket-cross-wires'; mesh.castShadow = true;
    for (let i = 0; i < count; i++) {
      const frame = frames[Math.round((i + 0.5) / count * steps)];
      const pairs = [[inFrame(frame, -width / 2, -height / 2), inFrame(frame, width / 2, -height / 2)],
        [inFrame(frame, -width / 2, -height / 2), inFrame(frame, -width / 2, height / 2)],
        [inFrame(frame, width / 2, -height / 2), inFrame(frame, width / 2, height / 2)]];
      pairs.forEach(([a, b], j) => {
        const delta = b.clone().sub(a);
        mesh.setMatrixAt(i * 3 + j, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()), new THREE.Vector3(1, delta.length(), 1)));
      });
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh); return root;
  }
  for (const side of [-1, 1]) {
    rectangle(side * (width / 2 - thickness / 2), 0, thickness, height, 'section-side');
    rectangle(side * (width / 2 - 4), height / 2 - thickness / 2, 8, thickness, 'section-return');
  }
  if (route.containmentType === 'ladder') repeatedBoxes(300, 30, width - thickness * 2, 12, -height / 2 + 8, 'ladder-rungs');
  else if (route.containmentType === 'tray' && route.subType !== 'solid-bottom') {
    const band = Math.max(10, width * 0.08);
    for (const side of [-1, 0, 1]) rectangle(side * (width / 2 - band / 2), bottom, band, thickness, 'perforated-floor-band');
    repeatedBoxes(options.detailed ? 80 : 150, 22, width - thickness * 2, thickness, bottom, 'perforated-floor-bridges');
  } else rectangle(0, bottom, width, thickness, 'section-floor');
  if (route.containmentType === 'duct' || route.containmentType === 'busbar') rectangle(0, height / 2 - thickness / 2, width, thickness, 'section-top');
  else if (route.containmentType === 'trunking') {
    const lid = rectangle(0, height / 2 + 1, width + 4, 2, 'containment-cover');
    lid.userData.containmentCover = true; lid.visible = options.showCovers !== false;
  }
  return root;
}
