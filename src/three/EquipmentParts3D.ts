import * as THREE from 'three';
import type { EquipmentEntity } from '../types';

type Point = [number, number, number];
type Material = THREE.MeshStandardMaterial;
const UP = new THREE.Vector3(0, 1, 0);

/** Per-assembly palette; repeated modules use instancing. There are no global
 * GPU resources that can be invalidated by another scene's disposal. */
export class EquipmentParts {
  readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  readonly cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
  readonly materials: Record<string, Material>;

  constructor(readonly root: THREE.Group, readonly w: number, readonly d: number,
    readonly h: number, bodyColor: number) {
    const mat = (color: number, metalness = 0.5, roughness = 0.4) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });
    this.materials = {
      body: mat(bodyColor, 0.48, 0.39), steel: mat(0xaab5bf, 0.82, 0.3),
      edge: mat(0x59636d, 0.75, 0.32), dark: mat(0x202a34, 0.2, 0.54),
      white: mat(0xe0e2df, 0.08, 0.55), copper: mat(0xb97642, 0.83, 0.28),
      brass: mat(0xb29c63, 0.8, 0.27), rubber: mat(0x20252b, 0.02, 0.85),
      red: mat(0xd8493e, 0.1, 0.43), yellow: mat(0xeab83c, 0.08, 0.48),
      blue: mat(0x4b87bf, 0.12, 0.43), green: mat(0x50aa78, 0.08, 0.4),
      screen: mat(0x163d49, 0.05, 0.23),
    };
  }

  vector(point: Point): THREE.Vector3 {
    return new THREE.Vector3(point[0] * this.w, point[1] * this.d, point[2] * this.h);
  }

  box(name: string, size: Point, at: Point, material = 'body', parent: THREE.Object3D = this.root): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, this.materials[material]);
    mesh.scale.copy(this.vector(size));
    mesh.position.copy(this.vector(at));
    mesh.name = name;
    mesh.userData.equipmentPart = name;
    parent.add(mesh);
    return mesh;
  }

  boxes(name: string, size: Point, at: Point[], material = 'steel', parent: THREE.Object3D = this.root): void {
    if (!at.length) return;
    const mesh = new THREE.InstancedMesh(this.boxGeometry, this.materials[material], at.length);
    const matrix = new THREE.Matrix4();
    const scale = this.vector(size);
    at.forEach((position, index) => {
      matrix.compose(this.vector(position), new THREE.Quaternion(), scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.name = name;
    mesh.userData.equipmentPart = name;
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }

  /** Fractional end points with a true circular section in millimetres. */
  rod(name: string, start: Point, end: Point, radius: number, material = 'steel', parent: THREE.Object3D = this.root): THREE.Mesh {
    const a = this.vector(start);
    const b = this.vector(end);
    const delta = b.clone().sub(a);
    const mesh = new THREE.Mesh(this.cylinderGeometry, this.materials[material]);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, delta.length(), radius);
    mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
    mesh.name = name;
    mesh.userData.equipmentPart = name;
    parent.add(mesh);
    return mesh;
  }

  cable(name: string, points: Point[], material: string, radius: number): void {
    const path = new THREE.CatmullRomCurve3(points.map(point => this.vector(point)), false, 'centripetal');
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 20, radius, 6, false), this.materials[material]);
    mesh.name = name;
    mesh.userData.equipmentPart = name;
    this.root.add(mesh);
  }

  ring(name: string, at: Point, radius: number, tube: number, material = 'steel', parent: THREE.Object3D = this.root): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 32), this.materials[material]);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(this.vector(at));
    mesh.name = name;
    mesh.userData.equipmentPart = name;
    parent.add(mesh);
    return mesh;
  }

  plate(text: string, at: Point, width: number, height: number, parent: THREE.Object3D = this.root, warning = false): void {
    const mesh = this.box(warning ? 'electrical-warning' : 'identification-plate', [width, 0.003, height], at,
      warning ? 'yellow' : 'dark', parent);
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = warning ? 256 : 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = warning ? '#eab83c' : '#17212b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = warning ? '#16202b' : '#e7eef3';
    ctx.font = warning ? 'bold 76px sans-serif' : '600 50px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, canvas.height / 2, 460);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(this.w * width, this.h * height),
      new THREE.MeshStandardMaterial({ map: texture, metalness: 0.1, roughness: 0.6 }));
    face.rotation.x = Math.PI / 2;
    face.position.copy(mesh.position);
    face.position.y -= this.d * 0.0016;
    face.name = mesh.name;
    face.userData.equipmentPart = mesh.name;
    parent.add(face);
  }
}

function feet(p: EquipmentParts): void {
  p.boxes('mounting-feet', [0.16, 0.20, 0.025], [
    [-0.34, -0.3, 0.0125], [0.34, -0.3, 0.0125], [-0.34, 0.3, 0.0125], [0.34, 0.3, 0.0125],
  ], 'edge');
}

function screen(p: EquipmentParts, x: number, z: number, width: number,
  parent: THREE.Object3D = p.root, front = -0.469): void {
  p.box('meter-bezel', [width, 0.015, 0.062], [x, front, z], 'dark', parent);
  p.box('meter-display', [width * 0.77, 0.004, 0.037], [x, front - 0.009, z + 0.004], 'screen', parent);
  p.boxes('meter-digits', [width * 0.09, 0.002, 0.014], [-1, 0, 1].map(n =>
    [x + n * width * 0.2, front - 0.012, z + 0.004] as Point), 'green', parent);
}

function door(p: EquipmentParts, eq: EquipmentEntity, x: number, z: number,
  width: number, height: number, isMain: boolean): void {
  const hinge = new THREE.Group();
  hinge.name = 'hinged-door';
  hinge.userData.equipmentPart = 'hinged-door';
  hinge.userData.equipmentDoor = true;
  hinge.userData.openAngle = -Math.PI * 0.59;
  hinge.position.copy(p.vector([x - width / 2, -0.45, z]));
  p.root.add(hinge);
  p.box('door-gasket', [width, 0.023, height], [width / 2, 0, 0], 'rubber', hinge);
  p.box('door-panel', [width * 0.99, 0.024, height * 0.986], [width / 2, -0.012, 0], 'body', hinge);
  p.box('door-fold', [width * 0.94, 0.01, height * 0.93], [width / 2, 0.016, 0], 'edge', hinge);
  p.box('door-handle', [Math.min(width * 0.045, 0.018), 0.015, height * 0.12],
    [width * 0.90, -0.031, 0], 'dark', hinge);
  p.boxes('door-hinges', [0.012, 0.022, height * 0.07], [
    [0, -0.004, -height * 0.32], [0, -0.004, height * 0.32],
  ], 'steel', hinge);
  p.plate(isMain ? eq.tag : 'CIRCUIT', [width * 0.44, -0.028, height * 0.34], width * 0.54, height * 0.052, hinge);
  if (isMain) {
    screen(p, width * 0.42, height * 0.17, width * 0.28, hinge, -0.032);
    p.plate('⚡', [width * 0.44, -0.029, -height * 0.24], width * 0.17, height * 0.075, hinge, true);
  } else {
    p.box('rotary-isolator-base', [width * 0.15, 0.02, height * 0.13], [width * 0.43, -0.031, 0], 'yellow', hinge);
    p.box('rotary-isolator-handle', [width * 0.025, 0.014, height * 0.085], [width * 0.43, -0.038, 0], 'red', hinge);
  }
}

function electricalInternals(p: EquipmentParts, eq: EquipmentEntity): void {
  const kind = eq.equipmentKind;
  const rows = kind === 'enclosure' || kind === 'meter' || kind === 'busbar-tap-off' ? 1 : 3;
  const columns = kind === 'switchboard' || kind === 'mcc' ? 12 : 8;
  const railZ = Array.from({ length: rows }, (_, i) => 0.3 + i * 0.18);
  p.box('backplate', [0.86, 0.021, 0.79], [0, 0.394, 0.53], 'steel');
  p.boxes('DIN-rail', [0.72, 0.045, 0.018], railZ.map(z => [0, 0.215, z]), 'steel');
  p.boxes('DIN-rail-lip', [0.72, 0.014, 0.008], railZ.flatMap(z => [[0, 0.189, z - 0.013], [0, 0.189, z + 0.013]] as Point[]), 'edge');
  const modules: Point[] = [];
  railZ.forEach(z => {
    for (let i = 0; i < columns; i++) modules.push([-0.30 + i * 0.6 / (columns - 1), 0.1, z]);
  });
  const moduleWidth = 0.56 / columns;
  p.boxes('circuit-breaker', [moduleWidth, 0.21, 0.105], modules, 'white');
  p.boxes('breaker-toggle', [moduleWidth * 0.64, 0.025, 0.026], modules.map(([x, , z]) => [x, -0.018, z + 0.004]), 'dark');
  p.boxes('breaker-circuit-label', [moduleWidth * 0.75, 0.004, 0.014], modules.map(([x, , z]) => [x, -0.008, z - 0.033]), 'blue');
  p.boxes('breaker-terminal', [moduleWidth * 0.42, 0.022, 0.012], modules.flatMap(([x, , z]) => [[x, 0.044, z + 0.045], [x, 0.044, z - 0.045]] as Point[]), 'brass');
  p.boxes('wiring-duct', [0.065, 0.06, 0.7], [[-0.405, 0.235, 0.52], [0.405, 0.235, 0.52]], 'white');
  p.boxes('duct-slots', [0.068, 0.006, 0.006], Array.from({ length: 26 }, (_, i) =>
    [-0.405, 0.202, 0.19 + i * 0.026] as Point).flatMap(point => [point, [0.405, point[1], point[2]] as Point]), 'dark');
  for (let phase = 0; phase < 3; phase++) {
    const z = 0.8 + phase * 0.033;
    p.box('copper-busbar', [0.68, 0.02, 0.016], [0, 0.16, z], 'copper');
    p.boxes('busbar-insulator', [0.028, 0.05, 0.024], [[-0.3, 0.19, z], [0.3, 0.19, z]], ['red', 'yellow', 'blue'][phase]);
    p.cable('phase-conductor', [[-0.24 + phase * 0.22, 0.15, z], [-0.24 + phase * 0.22, 0.10, 0.74],
      [0.35, 0.06 + phase * 0.024, 0.71], [0.35, 0.06 + phase * 0.024, 0.29]],
    ['red', 'yellow', 'blue'][phase], Math.min(p.w, p.d) * 0.008);
  }
  p.box('earth-bar', [0.62, 0.035, 0.023], [0, 0.26, 0.14], 'brass');
  p.boxes('earth-terminals', [0.018, 0.025, 0.014], Array.from({ length: 10 }, (_, i) => [-0.27 + i * 0.06, 0.24, 0.154]), 'steel');
  const radius = Math.min(p.w / 38, p.d * 0.045, p.h * 0.02);
  for (let i = 0; i < 6; i++) {
    const x = -0.30 + i * 0.12;
    p.rod('cable-gland', [x, -0.14, 0.93], [x, -0.14, 0.98], radius, 'brass');
    p.rod('gland-seal', [x, -0.14, 0.978], [x, -0.14, 0.998], radius * 0.72, 'rubber');
  }
}

function rackInternals(p: EquipmentParts): void {
  p.boxes('rack-upright', [0.034, 0.032, 0.84], [[-0.41, -0.28, 0.53], [0.41, -0.28, 0.53]], 'steel');
  const rows = Array.from({ length: 8 }, (_, i) => 0.19 + i * 0.09);
  p.boxes('rack-unit', [0.76, 0.67, 0.07], rows.map(z => [0, 0.06, z]), 'dark');
  p.boxes('rack-unit-face', [0.79, 0.024, 0.066], rows.map(z => [0, -0.286, z]), 'edge');
  p.boxes('network-port', [0.031, 0.016, 0.018], rows.flatMap(z =>
    Array.from({ length: 12 }, (_, i) => [-0.29 + i * 0.052, -0.303, z] as Point)), 'rubber');
  p.boxes('network-activity-light', [0.009, 0.003, 0.004], rows.flatMap(z =>
    Array.from({ length: 12 }, (_, i) => [-0.29 + i * 0.052, -0.313, z + 0.014] as Point)), 'green');
  for (let i = 0; i < 4; i++) {
    const x = -0.26 + i * 0.055;
    p.cable('patch-cable', [[x, -0.322, 0.73], [x, -0.37, 0.70],
      [x + 0.12, -0.37, 0.67], [x + 0.12, -0.322, 0.64]], 'blue', Math.min(p.w, p.d) * 0.004);
  }
}

export function buildCabinet(p: EquipmentParts, eq: EquipmentEntity): void {
  // A hollow five-sided shell exposes real internals when the door opens.
  p.box('enclosure-back', [1, 0.03, 0.94], [0, 0.465, 0.53]);
  p.boxes('enclosure-side', [0.025, 0.96, 0.94], [[-0.4875, 0, 0.53], [0.4875, 0, 0.53]], 'body');
  p.box('enclosure-roof', [1, 0.96, 0.024], [0, 0, 0.988]);
  p.box('enclosure-base', [1, 0.96, 0.024], [0, 0, 0.078]);
  p.box('plinth', [0.93, 0.86, 0.06], [0, 0.025, 0.03], 'dark');
  feet(p);
  if (eq.equipmentKind === 'comms-rack') rackInternals(p);
  else electricalInternals(p, eq);
  const columns = eq.equipmentKind === 'switchboard' ? 4 : eq.equipmentKind === 'mcc' ? 3 : 1;
  const rows = eq.equipmentKind === 'mcc' ? 3 : 1;
  for (let col = 0; col < columns; col++) {
    if (columns > 1) p.box('compartment-divider', [0.012, 0.83, 0.86], [-0.46 + (col + 1) * 0.92 / columns, 0.02, 0.53], 'steel');
    for (let row = 0; row < rows; row++) {
      const width = 0.93 / columns;
      const height = 0.88 / rows;
      door(p, eq, -0.465 + width * (col + 0.5), 0.09 + height * (row + 0.5), width - 0.012, height - 0.012, row === rows - 1);
      if (rows > 1 && row < rows - 1) p.box('compartment-shelf', [width, 0.82, 0.01],
        [-0.465 + width * (col + 0.5), 0.01, 0.09 + (row + 1) * height], 'steel');
    }
  }
  p.boxes('vent-louvres', [0.006, 0.31, 0.006], Array.from({ length: 11 }, (_, i) =>
    [0.497, 0.025, 0.18 + i * 0.014] as Point), 'dark');
}

function transformer(p: EquipmentParts, eq: EquipmentEntity): void {
  feet(p);
  p.box('transformer-tank', [0.65, 0.58, 0.62], [0, 0, 0.43]);
  p.box('tank-lid', [0.71, 0.64, 0.035], [0, 0, 0.76], 'edge');
  p.box('tank-skid', [0.86, 0.7, 0.075], [0, 0, 0.085], 'edge');
  const fins: Point[] = [];
  for (let i = 0; i < 12; i++) {
    const x = -0.39 + i * 0.78 / 11;
    fins.push([x, -0.385, 0.43], [x, 0.385, 0.43]);
  }
  p.boxes('radiator-fin', [0.014, 0.21, 0.51], fins, 'body');
  const bushingRadius = Math.min(p.w * 0.038, p.d * 0.04, p.h * 0.04);
  for (let i = 0; i < 3; i++) {
    const x = -0.22 + i * 0.22;
    p.rod('HV-bushing', [x, 0, 0.77], [x, 0, 0.965], bushingRadius, 'white');
    for (let ring = 0; ring < 4; ring++) {
      p.rod('bushing-shed', [x, 0, 0.795 + ring * 0.039], [x, 0, 0.808 + ring * 0.039], bushingRadius * 1.6, 'white');
    }
    p.rod('HV-terminal', [x, 0, 0.958], [x, 0, 0.996], bushingRadius * 0.58, 'copper');
  }
  p.box('cable-termination-box', [0.20, 0.44, 0.26], [0.385, 0, 0.54], 'body');
  p.plate(eq.tag, [0, -0.298, 0.64], 0.32, 0.045);
  p.plate('⚡', [0, -0.498, 0.42], 0.12, 0.07, p.root, true);
}

function motor(p: EquipmentParts, pump = false): void {
  feet(p);
  const radius = Math.min(p.d * 0.33, p.h * 0.32);
  p.rod('motor-housing', [-0.34, 0, 0.46], [pump ? 0.06 : 0.28, 0, 0.46], radius, 'body');
  const fins: Point[] = Array.from({ length: 12 }, (_, i) => [-0.31 + i * (pump ? 0.031 : 0.05), 0, 0.46]);
  for (const [x, y, z] of fins) p.rod('motor-cooling-fin', [x - 0.007, y, z], [x + 0.007, y, z], radius * 1.09, 'body');
  p.rod('motor-fan-cover', [-0.45, 0, 0.46], [-0.35, 0, 0.46], radius * 1.05, 'edge');
  p.rod('motor-shaft', [0.26, 0, 0.46], [0.47, 0, 0.46], radius * 0.22, 'steel');
  p.box('terminal-box', [0.25, 0.32, 0.20], [-0.12, 0, 0.82]);
  p.box('terminal-box-lid', [0.27, 0.34, 0.028], [-0.12, 0, 0.934], 'edge');
  p.boxes('motor-base', [0.6, 0.09, 0.07], [[-0.04, -0.31, 0.07], [-0.04, 0.31, 0.07]], 'body');
  if (pump) {
    p.rod('pump-volute', [0.11, 0, 0.43], [0.36, 0, 0.43], radius * 1.15, 'body');
    p.rod('pump-discharge', [0.235, 0, 0.6], [0.235, 0, 0.96], radius * 0.26, 'body');
    p.rod('discharge-flange', [0.235, 0, 0.93], [0.235, 0, 0.99], radius * 0.45, 'steel');
    p.rod('suction-flange', [0.43, 0, 0.43], [0.49, 0, 0.43], radius * 0.48, 'steel');
  }
}

function fan(p: EquipmentParts): void {
  feet(p);
  const radius = Math.min(p.w * 0.40, p.h * 0.40);
  p.box('fan-base', [0.89, 0.84, 0.07], [0, 0, 0.06], 'edge');
  p.boxes('fan-cradle', [0.075, 0.6, 0.28], [[-0.3, 0, 0.22], [0.3, 0, 0.22]], 'body');
  const rimThickness = Math.min(radius * 0.055, p.d * 0.07);
  p.ring('fan-inlet-ring', [0, -0.34, 0.54], radius, rimThickness, 'steel');
  p.ring('fan-outlet-ring', [0, 0.28, 0.54], radius, rimThickness, 'steel');
  p.rod('fan-hub', [0, -0.16, 0.54], [0, 0.21, 0.54], radius * 0.18, 'dark');
  for (let i = 0; i < 8; i++) {
    const theta = i * Math.PI / 4;
    const start: Point = [Math.cos(theta) * radius * 0.2 / p.w, -0.11, 0.54 + Math.sin(theta) * radius * 0.2 / p.h];
    const end: Point = [Math.cos(theta) * radius * 0.99 / p.w, -0.11, 0.54 + Math.sin(theta) * radius * 0.99 / p.h];
    const blade = p.rod('fan-blade', start, end, Math.min(radius * 0.11, p.d * 0.18), 'body');
    blade.scale.x *= 0.2;
    p.rod('fan-guard-spoke', [0, -0.358, 0.54], [end[0], -0.358, end[2]], Math.min(p.w, p.h, p.d) * 0.004, 'steel');
  }
  for (const r of [0.36, 0.62, 0.83]) p.ring('fan-guard-ring', [0, -0.358, 0.54], radius * r, Math.min(radius * 0.011, p.d * 0.025), 'steel');
}

function packagedUnit(p: EquipmentParts, eq: EquipmentEntity): void {
  const generator = eq.equipmentKind === 'generator';
  feet(p);
  p.box('base-skid', [0.97, 0.89, 0.085], [0, 0, 0.075], 'dark');
  p.box(generator ? 'acoustic-canopy' : 'AHU-casing', [0.95, 0.90, generator ? 0.71 : 0.85],
    [0, 0, generator ? 0.465 : 0.55]);
  p.box('roof-fold', [0.97, 0.92, 0.022], [0, 0, generator ? 0.83 : 0.986], 'edge');
  const divisions = generator ? 3 : 4;
  p.boxes('service-panel', [0.90 / divisions - 0.018, 0.015, generator ? 0.60 : 0.70],
    Array.from({ length: divisions }, (_, i) => [-0.45 + (i + 0.5) * 0.9 / divisions, -0.46, 0.51]), 'body');
  p.boxes('panel-seams', [0.006, 0.014, generator ? 0.66 : 0.77],
    Array.from({ length: divisions - 1 }, (_, i) => [-0.45 + (i + 1) * 0.9 / divisions, -0.469, 0.51]), 'dark');
  p.boxes('service-handles', [0.012, 0.016, 0.057],
    Array.from({ length: divisions }, (_, i) => [-0.37 + (i + 0.5) * 0.9 / divisions, -0.477, 0.5]), 'dark');
  p.boxes('intake-louvres', [0.006, 0.69, 0.016],
    Array.from({ length: 17 }, (_, i) => [0.478, 0, 0.23 + i * 0.031]), 'dark');
  p.boxes('front-vent-louvres', [0.19, 0.006, 0.008],
    Array.from({ length: 10 }, (_, i) => [-0.31, -0.472, 0.31 + i * 0.035]), 'edge');
  screen(p, 0.02, 0.65, 0.13, p.root, -0.48);
  p.plate(eq.tag, [0.02, -0.48, 0.76], 0.22, 0.04);
  if (generator) {
    const r = Math.min(p.w, p.d) * 0.036;
    p.rod('exhaust-stack', [0.18, 0.16, 0.835], [0.18, 0.16, 0.973], r, 'steel');
    p.rod('exhaust-rain-cap', [0.18, 0.16, 0.971], [0.18, 0.16, 0.984], r * 1.4, 'dark');
    p.box('emergency-stop-base', [0.035, 0.01, 0.035], [0.19, -0.48, 0.59], 'yellow');
    p.box('emergency-stop', [0.02, 0.01, 0.022], [0.19, -0.49, 0.59], 'red');
  }
}

/** Returns false for equipment that uses the hollow electrical cabinet model. */
export function buildMechanicalEquipment(p: EquipmentParts, eq: EquipmentEntity): boolean {
  switch (eq.equipmentKind) {
    case 'transformer': transformer(p, eq); return true;
    case 'motor': motor(p); return true;
    case 'pump': motor(p, true); return true;
    case 'fan': fan(p); return true;
    case 'generator':
    case 'air-handling-unit': packagedUnit(p, eq); return true;
    default: return false;
  }
}
