// Physical cable jackets follow the route with tangent bends and cross-section
// packing. These are actual scheduled cables, never an invented fill texture.
import * as THREE from 'three';
import type { ContainmentEntity } from '../types';
import type { Cable, CableCircuitType } from '../models/cable';
import { defaultElevation } from './elevations';
import type { Floor } from '../models/site';
import { finiteDimension, roundedRoute } from './ContainmentGeometry';

export interface CableInTrayOpts {
  /** Maximum visible cables (bounded to 256). Overflow is reported in userData. */
  maxCables?: number;
  flipY?: number;
  floor?: Floor;
  forceElevation?: number;
  /** Banded cable retention, instanced per run to keep draw calls bounded. */
  showCleats?: boolean;
  detail?: 'overview' | 'detailed';
  /** Group circuits with a visual gap. This is not a segregation calculation. */
  segregateCircuits?: boolean;
}

const CIRCUIT_COLORS: Record<CableCircuitType, number> = {
  power: 0x39414b,
  control: 0x8664ab,
  data: 0x387dc1,
  'fire-alarm': 0xd94c38,
  emergency: 0xe6b53c,
  instrumentation: 0x36a799,
  comms: 0x458c61,
  av: 0x8e44ad,
  earthing: 0x76a646,
};

interface PackedCable { y: number; z: number; r: number; cable: Cable }

function packCables(cables: Cable[], width: number, height: number, floorDepth: number, segregate: boolean, circular: boolean): PackedCable[] {
  const packed: PackedCable[] = [];
  const margin = circular ? 2.5 : Math.min(5, width * 0.05);
  const left = -width / 2 + margin;
  const right = width / 2 - margin;
  const floor = -height / 2 + floorDepth;
  const ceiling = height / 2 - margin;
  const sorted = [...cables];
  if (segregate) sorted.sort((a, b) => a.circuitType.localeCompare(b.circuitType));
  let cursorY = left;
  let cursorZ = floor;
  let rowHeight = 0;
  let previousType: CableCircuitType | undefined;
  for (const cable of sorted) {
    if (!Number.isFinite(cable.outerDiameter) || cable.outerDiameter <= 0) continue;
    const r = Math.max(0.75, cable.outerDiameter / 2);
    if (r * 2 > right - left || cursorZ + r * 2 > ceiling) continue;
    if (segregate && previousType != null && previousType !== cable.circuitType && cursorY > left) cursorY += 12;
    if (cursorY + r * 2 > right) {
      cursorZ += rowHeight + 2;
      cursorY = left;
      rowHeight = 0;
    }
    if (circular) {
      // Scan small rows within the inner circular wall rather than packing
      // the bounding square, which would push corner cables through conduit.
      const innerRadius = width / 2 - margin;
      const step = Math.max(1.5, r * 0.5);
      while (cursorZ + r * 2 <= ceiling) {
        if (cursorY + r * 2 > right) {
          cursorY = left;
          cursorZ += rowHeight > 0 ? rowHeight + 1 : step;
          rowHeight = 0;
        }
        if (Math.hypot(cursorY + r, cursorZ + r) + r <= innerRadius + 0.001) break;
        cursorY += step;
      }
    }
    if (cursorZ + r * 2 > ceiling) continue;
    packed.push({ y: cursorY + r, z: cursorZ + r, r, cable });
    cursorY += r * 2 + 2;
    rowHeight = Math.max(rowHeight, r * 2);
    previousType = cable.circuitType;
  }
  return packed;
}

function packCompartments(cables: Cable[], width: number, height: number, floorDepth: number, segregate: boolean, count: number): PackedCable[] {
  const packed: PackedCable[] = [];
  let remaining = cables;
  for (let i = 0; i < count && remaining.length; i++) {
    const compartment = packCables(remaining, width / count, height, floorDepth, segregate, false);
    const offset = -width / 2 + (i + 0.5) * width / count;
    packed.push(...compartment.map((pack) => ({ ...pack, y: pack.y + offset })));
    const fitted = new Set(compartment.map((pack) => pack.cable.id));
    remaining = remaining.filter((cable) => !fitted.has(cable.id));
  }
  return packed;
}

/** Geometry belongs exclusively to the returned group; callers dispose it. */
export function renderCablesInContainment(containment: ContainmentEntity, cables: Cable[], opts: CableInTrayOpts = {}): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `cables-in:${containment.id}`;
  root.userData.entityId = containment.id;
  root.userData.requestedCableCount = cables.length;
  root.userData.renderedCableCount = 0;
  root.userData.omittedCableCount = cables.length;
  if (!cables.length || !containment.points || containment.points.length < 2) return root;
  const max = Math.max(0, Math.min(256, Math.floor(finiteDimension(opts.maxCables, 32, 0))));
  const width = finiteDimension(containment.width, 100, 8);
  const circular = containment.containmentType === 'conduit';
  const height = circular ? width : finiteDimension(containment.height, 50, 8);
  const bottom = Number.isFinite(opts.forceElevation) ? opts.forceElevation! : defaultElevation(containment, opts.floor);
  if (!Number.isFinite(bottom)) return root;
  const centerZ = bottom + height / 2;
  const floorDepth = containment.containmentType === 'ladder' ? Math.min(20, height * 0.45) + 1
    : containment.containmentType === 'basket' ? Math.min(5, height * 0.2) + 1 : 3;
  const compartmentCount = containment.containmentType === 'trunking'
    ? Math.min(8, Math.floor(finiteDimension(containment.compartments, 1))) : 1;
  const packs = compartmentCount > 1
    ? packCompartments(cables.slice(0, max), width, height, floorDepth, opts.segregateCircuits !== false, compartmentCount)
    : packCables(cables.slice(0, max), width, height, floorDepth, opts.segregateCircuits !== false, circular);
  const detailed = opts.detail !== 'overview';
  const radial = detailed ? 10 : 6;
  const ties: THREE.Matrix4[] = [];
  const axis = new THREE.Vector3(0, 0, 1);
  const rotation = new THREE.Quaternion();
  const materialByCircuit = new Map<CableCircuitType, THREE.MeshStandardMaterial>();
  let endMaterial: THREE.MeshStandardMaterial | undefined;
  for (const pack of packs) {
    const bendRadius = Math.max(width * 0.5, pack.r * 8);
    const curve = roundedRoute(containment.points, centerZ + pack.z, bendRadius, opts.flipY, pack.y);
    if (!curve) continue;
    const length = curve.getLength();
    const steps = Math.max(12, Math.min(detailed ? 384 : 160, Math.ceil(length / (detailed ? 90 : 200)) + containment.points.length * 8));
    let material = materialByCircuit.get(pack.cable.circuitType);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: colourForCircuit(pack.cable.circuitType), metalness: 0.02, roughness: 0.64 });
      materialByCircuit.set(pack.cable.circuitType, material);
    }
    const cableGroup = new THREE.Group();
    cableGroup.name = `cable:${pack.cable.reference}`;
    cableGroup.userData.cableId = pack.cable.id;
    cableGroup.userData.cableReference = pack.cable.reference;
    const jacket = new THREE.Mesh(new THREE.TubeGeometry(curve, steps, pack.r, radial, false), material);
    jacket.name = 'cable-jacket';
    jacket.castShadow = true;
    jacket.receiveShadow = true;
    cableGroup.add(jacket);
    // End faces close the jackets and make cutaway routes read as cable,
    // while retaining the actual schedule OD and core count metadata.
    endMaterial ??= new THREE.MeshStandardMaterial({ color: 0xc5baa4, roughness: 0.82 });
    for (const t of [0, 1]) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(pack.r * 0.9, radial), endMaterial);
      face.name = 'cable-cut-end';
      face.position.copy(curve.getPointAt(t));
      face.quaternion.setFromUnitVectors(axis, curve.getTangentAt(t).multiplyScalar(t === 0 ? -1 : 1));
      cableGroup.add(face);
    }
    if (opts.showCleats !== false && detailed) {
      const count = Math.min(20, Math.floor(length / 900));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        rotation.setFromUnitVectors(axis, curve.getTangentAt(t));
        ties.push(new THREE.Matrix4().compose(curve.getPointAt(t), rotation, new THREE.Vector3(pack.r + 0.65, pack.r + 0.65, 1.5)));
      }
    }
    cableGroup.traverse((object) => {
      object.userData.entityId = containment.id;
      object.userData.cableId = pack.cable.id;
      object.userData.cableReference = pack.cable.reference;
    });
    root.add(cableGroup);
  }
  root.userData.renderedCableCount = root.children.length;
  root.userData.omittedCableCount = cables.length - root.children.length;
  root.userData.crossSectionOverflow = packs.length < Math.min(cables.length, max);
  if (ties.length) {
    const tieMaterial = new THREE.MeshStandardMaterial({ color: 0x20292e, roughness: 0.75 });
    const bands = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.065, 4, 10), tieMaterial, ties.length);
    bands.name = 'cable-retaining-bands';
    bands.userData.entityId = containment.id;
    ties.forEach((matrix, index) => bands.setMatrixAt(index, matrix));
    bands.castShadow = true;
    bands.computeBoundingSphere();
    bands.computeBoundingBox();
    root.add(bands);
  }
  return root;
}

export function colourForCircuit(t: CableCircuitType): number {
  return CIRCUIT_COLORS[t] ?? 0x666666;
}
