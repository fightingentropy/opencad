// Panel3D — realistic 3D rendering of an electrical control panel
// Uses Three.js (already in package.json). Receives the active project
// and renders the active sheet's symbol entities as 3D components on a
// DIN-rail enclosure.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type {
  Project,
  Sheet,
  SymbolEntity,
  WireEntity,
  Entity,
  SymbolCategory,
  ContainmentEntity,
  WallEntity,
  RoomEntity,
  Vec2,
} from '../types';

// We want to look up the symbol category by id. The library file may not
// exist yet, so we attempt a soft import and fall back gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _getSymbolImpl: ((id: string) => any) | null = null;
try {
  // Using a dynamic-ish require pattern via top-level import is not allowed
  // for optional modules under Vite, so we use a synchronous-looking import
  // wrapped in try/catch. Vite bundles this if the file exists.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  // Note: actual lookup is done at runtime via a registry approach if missing.
} catch {
  _getSymbolImpl = null;
}

// Asynchronously try to load the symbols library so we can read categories.
// This is fire-and-forget; the component re-uses heuristics from symbolId
// names if the library is unavailable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _symbolRegistry: Record<string, any> | null = null;
async function ensureSymbolLibrary() {
  if (_symbolRegistry !== null || _getSymbolImpl) return;
  try {
    const mod = (await import(/* @vite-ignore */ '../symbols/library')) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSymbol?: (id: string) => any;
    };
    if (mod && typeof mod.getSymbol === 'function') {
      _getSymbolImpl = mod.getSymbol;
    }
  } catch {
    // library not available — we'll rely on heuristics
    _symbolRegistry = {};
  }
}

// Heuristic category mapping from symbolId substrings.
function inferCategoryFromId(symbolId: string): SymbolCategory {
  const id = symbolId.toLowerCase();
  if (id.includes('contactor') || id.includes('relay') || id.startsWith('k')) {
    return 'contactor-relay';
  }
  if (id.includes('breaker') || id.includes('fuse')) return 'fuse-breaker';
  if (id.includes('terminal') || id.includes('tb')) return 'terminal';
  if (id.includes('plc') || id.includes('io-')) return 'plc-io';
  if (id.includes('motor')) return 'motor';
  if (id.includes('xfmr') || id.includes('transformer')) return 'transformer';
  if (id.includes('indicator') || id.includes('lamp') || id.includes('led')) {
    return 'indicator';
  }
  if (id.includes('estop') || id.includes('button') || id.includes('pb-')) {
    return 'pushbutton';
  }
  if (id.includes('switch')) return 'switch';
  return 'panel-component';
}

function categoryFor(entity: SymbolEntity): SymbolCategory {
  if (_getSymbolImpl) {
    try {
      const sym = _getSymbolImpl(entity.symbolId);
      if (sym && sym.category) return sym.category as SymbolCategory;
    } catch {
      // ignore
    }
  }
  return inferCategoryFromId(entity.symbolId);
}

// ---------- Material cache ---------------------------------------------------
// Keep a single set of materials per scene rebuild so we can dispose them.
interface MaterialBag {
  steel: THREE.MeshStandardMaterial;
  steelPainted: THREE.MeshStandardMaterial;
  dinRail: THREE.MeshStandardMaterial;
  duct: THREE.MeshStandardMaterial;
  ductSlot: THREE.MeshStandardMaterial;
  blackPlastic: THREE.MeshStandardMaterial;
  whitePlastic: THREE.MeshStandardMaterial;
  grayPlastic: THREE.MeshStandardMaterial;
  clearPlastic: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  redLED: THREE.MeshStandardMaterial;
  greenLED: THREE.MeshStandardMaterial;
  amberLED: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  wireframe: THREE.MeshBasicMaterial;
  label: THREE.MeshStandardMaterial;
  dispose: () => void;
}

function buildMaterials(): MaterialBag {
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb8bcc2,
    metalness: 0.85,
    roughness: 0.35,
  });
  const steelPainted = new THREE.MeshStandardMaterial({
    color: 0xd1d4d8,
    metalness: 0.4,
    roughness: 0.55,
  });
  const dinRail = new THREE.MeshStandardMaterial({
    color: 0xc9ccd1,
    metalness: 0.95,
    roughness: 0.2,
  });
  const duct = new THREE.MeshStandardMaterial({
    color: 0x6c7480,
    metalness: 0.05,
    roughness: 0.85,
  });
  const ductSlot = new THREE.MeshStandardMaterial({
    color: 0x2a2e34,
    metalness: 0.0,
    roughness: 0.95,
  });
  const blackPlastic = new THREE.MeshStandardMaterial({
    color: 0x141518,
    metalness: 0.05,
    roughness: 0.55,
  });
  const whitePlastic = new THREE.MeshStandardMaterial({
    color: 0xeeeeec,
    metalness: 0.05,
    roughness: 0.5,
  });
  const grayPlastic = new THREE.MeshStandardMaterial({
    color: 0x9ea3ab,
    metalness: 0.05,
    roughness: 0.6,
  });
  const clearPlastic = new THREE.MeshPhysicalMaterial({
    color: 0xd8e2eb,
    metalness: 0.0,
    roughness: 0.05,
    transmission: 0.7,
    thickness: 1.0,
    transparent: true,
    opacity: 0.55,
    ior: 1.45,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc8a44a,
    metalness: 1.0,
    roughness: 0.25,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xe8eaed,
    metalness: 1.0,
    roughness: 0.12,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: 0xb87333,
    metalness: 1.0,
    roughness: 0.3,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xf2f5f7,
    metalness: 0.0,
    roughness: 0.02,
    transmission: 0.92,
    thickness: 0.5,
    transparent: true,
    opacity: 0.55,
    ior: 1.5,
  });
  const redLED = new THREE.MeshStandardMaterial({
    color: 0xff2222,
    emissive: 0xff1010,
    emissiveIntensity: 1.4,
    metalness: 0.0,
    roughness: 0.25,
  });
  const greenLED = new THREE.MeshStandardMaterial({
    color: 0x22ff44,
    emissive: 0x10ff20,
    emissiveIntensity: 1.4,
    metalness: 0.0,
    roughness: 0.25,
  });
  const amberLED = new THREE.MeshStandardMaterial({
    color: 0xffaa22,
    emissive: 0xffa510,
    emissiveIntensity: 1.4,
    metalness: 0.0,
    roughness: 0.25,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0xc11a1a,
    metalness: 0.05,
    roughness: 0.45,
  });
  const green = new THREE.MeshStandardMaterial({
    color: 0x1f8a3a,
    metalness: 0.05,
    roughness: 0.45,
  });
  const blue = new THREE.MeshStandardMaterial({
    color: 0x1f4ea1,
    metalness: 0.05,
    roughness: 0.45,
  });
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xe2c41a,
    metalness: 0.05,
    roughness: 0.45,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: 0x1f2126,
    metalness: 0.0,
    roughness: 0.95,
  });
  const wireframe = new THREE.MeshBasicMaterial({
    color: 0x66aaff,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
  });
  const label = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    metalness: 0.0,
    roughness: 0.6,
  });

  const all: THREE.Material[] = [
    steel,
    steelPainted,
    dinRail,
    duct,
    ductSlot,
    blackPlastic,
    whitePlastic,
    grayPlastic,
    clearPlastic,
    brass,
    chrome,
    copper,
    glass,
    redLED,
    greenLED,
    amberLED,
    red,
    green,
    blue,
    yellow,
    floor,
    wireframe,
    label,
  ];

  return {
    steel,
    steelPainted,
    dinRail,
    duct,
    ductSlot,
    blackPlastic,
    whitePlastic,
    grayPlastic,
    clearPlastic,
    brass,
    chrome,
    copper,
    glass,
    redLED,
    greenLED,
    amberLED,
    red,
    green,
    blue,
    yellow,
    floor,
    wireframe,
    label,
    dispose: () => {
      for (const m of all) m.dispose();
    },
  };
}

// ---------- Component builders ----------------------------------------------
// Each function returns a THREE.Group at origin (component center on the
// back panel surface). Depth (z) goes from 0 outward.

function buildContactor(mats: MaterialBag, tag?: string): THREE.Group {
  const g = new THREE.Group();
  const w = 45;
  const h = 45;
  const d = 70;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d, 1, 1, 1),
    mats.blackPlastic
  );
  body.position.z = d / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Front face indent (slightly lighter)
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.85, h * 0.85, 1),
    new THREE.MeshStandardMaterial({
      color: 0x222428,
      metalness: 0.05,
      roughness: 0.6,
    })
  );
  front.position.z = d + 0.5;
  front.castShadow = false;
  front.receiveShadow = true;
  g.add(front);

  // Top terminal screws (3 power + 3 power on bottom typically)
  const screwGeom = new THREE.CylinderGeometry(2.5, 2.5, 2, 12);
  const screwHole = new THREE.CylinderGeometry(3.5, 3.5, 1.2, 16);
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 8 + i * ((w - 16) / 2);
    // top
    const holeT = new THREE.Mesh(screwHole, mats.blackPlastic);
    holeT.rotation.x = Math.PI / 2;
    holeT.position.set(x, h / 2 - 4, d - 4);
    g.add(holeT);
    const sT = new THREE.Mesh(screwGeom, mats.brass);
    sT.rotation.x = Math.PI / 2;
    sT.position.set(x, h / 2 - 4, d - 3);
    sT.castShadow = true;
    g.add(sT);
    // bottom
    const holeB = new THREE.Mesh(screwHole, mats.blackPlastic);
    holeB.rotation.x = Math.PI / 2;
    holeB.position.set(x, -h / 2 + 4, d - 4);
    g.add(holeB);
    const sB = new THREE.Mesh(screwGeom, mats.brass);
    sB.rotation.x = Math.PI / 2;
    sB.position.set(x, -h / 2 + 4, d - 3);
    sB.castShadow = true;
    g.add(sB);
  }

  // Coil screws (left/right on aux side)
  for (let i = 0; i < 2; i++) {
    const y = -h / 2 + 8 + i * (h - 16);
    const s = new THREE.Mesh(screwGeom, mats.chrome);
    s.rotation.z = Math.PI / 2;
    s.position.set(-w / 2 + 1, y, d * 0.6);
    s.castShadow = true;
    g.add(s);
  }

  // Tag label rectangle on front
  const lblGeom = new THREE.PlaneGeometry(w * 0.6, 6);
  const lbl = new THREE.Mesh(lblGeom, mats.label);
  lbl.position.set(0, 0, d + 1.05);
  g.add(lbl);

  if (tag) g.userData.tag = tag;
  return g;
}

function buildRelay(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const w = 28;
  const h = 28;
  const d = 50;

  // Base (black plastic)
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 18),
    mats.blackPlastic
  );
  base.position.z = 9;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // Clear plastic cover
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.9, h * 0.9, d - 18),
    mats.clearPlastic
  );
  cover.position.z = 18 + (d - 18) / 2;
  cover.castShadow = true;
  cover.receiveShadow = true;
  g.add(cover);

  // Internal coil (visible through clear plastic) — copper cylinder
  const coil = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, (d - 18) * 0.7, 24),
    mats.copper
  );
  coil.rotation.x = Math.PI / 2;
  coil.position.z = 18 + (d - 18) / 2;
  coil.castShadow = true;
  g.add(coil);

  // Bottom pins
  const pinGeom = new THREE.CylinderGeometry(0.8, 0.8, 4, 8);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const pin = new THREE.Mesh(pinGeom, mats.chrome);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(
        -w / 2 + 4 + i * ((w - 8) / 3),
        -h / 2 + 4 + j * (h - 8),
        2
      );
      pin.castShadow = true;
      g.add(pin);
    }
  }

  return g;
}

function buildBreaker(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const w = 18; // 1-pole 18mm wide standard
  const h = 80;
  const d = 70;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mats.whitePlastic
  );
  body.position.z = d / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Toggle switch
  const togglePivot = new THREE.Group();
  const toggle = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.5, 12, 4),
    new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      metalness: 0.1,
      roughness: 0.5,
    })
  );
  toggle.position.z = 2;
  togglePivot.add(toggle);
  togglePivot.position.set(0, 0, d - 0.5);
  togglePivot.rotation.x = -0.25;
  g.add(togglePivot);

  // Top/bottom terminal screws
  const screwGeom = new THREE.CylinderGeometry(2.2, 2.2, 1.5, 12);
  const sT = new THREE.Mesh(screwGeom, mats.brass);
  sT.rotation.x = Math.PI / 2;
  sT.position.set(0, h / 2 - 5, d - 3);
  sT.castShadow = true;
  g.add(sT);
  const sB = new THREE.Mesh(screwGeom, mats.brass);
  sB.rotation.x = Math.PI / 2;
  sB.position.set(0, -h / 2 + 5, d - 3);
  sB.castShadow = true;
  g.add(sB);

  // Front amperage strip
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.7, 4),
    new THREE.MeshStandardMaterial({
      color: 0xfacd2a,
      metalness: 0.2,
      roughness: 0.4,
    })
  );
  strip.position.set(0, h / 2 - 16, d + 0.05);
  g.add(strip);

  return g;
}

function buildTerminal(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const w = 6.2; // single terminal 6.2mm
  const h = 50;
  const d = 45;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0xd1d4cc,
      metalness: 0.05,
      roughness: 0.5,
    })
  );
  body.position.z = d / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Two screws (top & bottom)
  const screwGeom = new THREE.CylinderGeometry(1.5, 1.5, 1.5, 10);
  const sT = new THREE.Mesh(screwGeom, mats.brass);
  sT.rotation.x = Math.PI / 2;
  sT.position.set(0, h / 2 - 5, d - 2);
  sT.castShadow = true;
  g.add(sT);
  const sB = new THREE.Mesh(screwGeom, mats.brass);
  sB.rotation.x = Math.PI / 2;
  sB.position.set(0, -h / 2 + 5, d - 2);
  sB.castShadow = true;
  g.add(sB);
  return g;
}

function buildPLC(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const w = 110;
  const h = 100;
  const d = 75;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x2c5d8a,
      metalness: 0.1,
      roughness: 0.5,
    })
  );
  body.position.z = d / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Front face plate (lighter)
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.95, h * 0.95, 1),
    new THREE.MeshStandardMaterial({
      color: 0x3a7aae,
      metalness: 0.15,
      roughness: 0.45,
    })
  );
  face.position.z = d + 0.5;
  g.add(face);

  // Status LEDs in a vertical column
  const ledGeom = new THREE.SphereGeometry(1.2, 12, 8);
  const colors = [mats.greenLED, mats.greenLED, mats.amberLED, mats.redLED];
  for (let i = 0; i < 8; i++) {
    const led = new THREE.Mesh(ledGeom, colors[i % colors.length]);
    led.position.set(-w / 2 + 8, h / 2 - 8 - i * 8, d + 1.5);
    g.add(led);
  }

  // I/O terminal block at bottom
  const io = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.9, 8, 6),
    mats.grayPlastic
  );
  io.position.set(0, -h / 2 + 6, d + 3);
  io.castShadow = true;
  g.add(io);
  for (let i = 0; i < 16; i++) {
    const screw = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.8, 8),
      mats.brass
    );
    screw.rotation.x = Math.PI / 2;
    screw.position.set(
      -w / 2 + 6 + i * ((w * 0.9) / 16),
      -h / 2 + 6,
      d + 6.4
    );
    g.add(screw);
  }
  return g;
}

function buildMotor(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const r = 35;
  const len = 90;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 32),
    mats.blackPlastic
  );
  body.rotation.z = Math.PI / 2;
  body.position.z = r;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Cooling fins
  for (let i = 0; i < 12; i++) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(len * 0.9, 1, r * 0.15),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        metalness: 0.6,
        roughness: 0.4,
      })
    );
    const a = (i / 12) * Math.PI * 2;
    fin.position.set(0, Math.cos(a) * r, r + Math.sin(a) * r);
    fin.rotation.x = a;
    g.add(fin);
  }

  // Mounting feet
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(20, r * 1.6, 6),
      mats.steel
    );
    foot.position.set(sx * (len / 2 - 10), 0, 3);
    foot.castShadow = true;
    foot.receiveShadow = true;
    g.add(foot);
  }

  // Shaft sticking out one end
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 25, 16),
    mats.chrome
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(len / 2 + 12, 0, r);
  shaft.castShadow = true;
  g.add(shaft);

  // Junction box on top
  const jbox = new THREE.Mesh(
    new THREE.BoxGeometry(40, 25, 18),
    mats.blackPlastic
  );
  jbox.position.set(0, 0, r * 2 - 3);
  jbox.castShadow = true;
  g.add(jbox);
  return g;
}

function buildTransformer(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const w = 80;
  const h = 90;
  const d = 75;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x4a4d52,
      metalness: 0.6,
      roughness: 0.4,
    })
  );
  body.position.z = d / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Iron core stripes
  for (let i = -2; i <= 2; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 4, d + 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x2a2c30,
        metalness: 0.7,
        roughness: 0.35,
      })
    );
    stripe.position.set(0, i * 8, d / 2);
    g.add(stripe);
  }

  // Primary terminals (top)
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 8, 12),
      mats.brass
    );
    t.rotation.x = Math.PI / 2;
    t.position.set(-20 + i * 20, h / 2 - 5, d - 4);
    t.castShadow = true;
    g.add(t);
  }
  // Secondary terminals (bottom)
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 8, 12),
      mats.brass
    );
    t.rotation.x = Math.PI / 2;
    t.position.set(-22 + i * 14, -h / 2 + 5, d - 4);
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

function buildIndicator(mats: MaterialBag, color?: string): THREE.Group {
  const g = new THREE.Group();
  // Bezel
  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 11, 5, 32),
    mats.chrome
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = 2.5;
  bezel.castShadow = true;
  bezel.receiveShadow = true;
  g.add(bezel);

  // Dome lens
  const c = (color || 'red').toLowerCase();
  let lensMat: THREE.MeshStandardMaterial;
  if (c.includes('green')) lensMat = mats.greenLED;
  else if (c.includes('amber') || c.includes('yellow')) lensMat = mats.amberLED;
  else lensMat = mats.redLED;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(8, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    lensMat
  );
  dome.rotation.x = -Math.PI / 2;
  dome.position.z = 5;
  dome.castShadow = true;
  g.add(dome);

  // Tiny point light to give the indicator a glow
  const pl = new THREE.PointLight(
    (lensMat as THREE.MeshStandardMaterial).emissive.getHex(),
    0.4,
    60,
    2
  );
  pl.position.set(0, 0, 12);
  g.add(pl);

  return g;
}

function buildPushbutton(mats: MaterialBag, color?: string): THREE.Group {
  const g = new THREE.Group();
  const c = (color || 'green').toLowerCase();
  let capMat: THREE.MeshStandardMaterial;
  if (c.includes('estop') || c.includes('red')) capMat = mats.red;
  else if (c.includes('green') || c.includes('start')) capMat = mats.green;
  else if (c.includes('blue')) capMat = mats.blue;
  else if (c.includes('yellow')) capMat = mats.yellow;
  else capMat = mats.green;

  // Bezel ring
  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 4, 32),
    mats.chrome
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = 2;
  bezel.castShadow = true;
  bezel.receiveShadow = true;
  g.add(bezel);

  // Cap
  const isEstop = c.includes('estop');
  const capR = isEstop ? 18 : 10;
  const capH = isEstop ? 8 : 6;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(capR, capR * 0.85, capH, 32),
    capMat
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 4 + capH / 2;
  cap.castShadow = true;
  cap.receiveShadow = true;
  g.add(cap);

  if (isEstop) {
    // Yellow ring base
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 3, 32),
      mats.yellow
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 1.5;
    ring.castShadow = true;
    g.add(ring);
  }

  // Back side terminal block
  const tb = new THREE.Mesh(
    new THREE.BoxGeometry(20, 25, 15),
    mats.blackPlastic
  );
  tb.position.z = -8;
  g.add(tb);
  return g;
}

function buildFuse(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  // Two metal end caps + glass tube horizontal
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 25, 24),
    mats.glass
  );
  tube.rotation.z = Math.PI / 2;
  tube.position.z = 8;
  g.add(tube);

  const capGeom = new THREE.CylinderGeometry(5.5, 5.5, 5, 24);
  const c1 = new THREE.Mesh(capGeom, mats.chrome);
  c1.rotation.z = Math.PI / 2;
  c1.position.set(-13, 0, 8);
  c1.castShadow = true;
  g.add(c1);
  const c2 = new THREE.Mesh(capGeom, mats.chrome);
  c2.rotation.z = Math.PI / 2;
  c2.position.set(13, 0, 8);
  c2.castShadow = true;
  g.add(c2);

  // Fuse element (thin wire inside)
  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 22, 6),
    new THREE.MeshStandardMaterial({
      color: 0xc8a44a,
      metalness: 0.9,
      roughness: 0.3,
    })
  );
  wire.rotation.z = Math.PI / 2;
  wire.position.z = 8;
  g.add(wire);

  // Holder body
  const holder = new THREE.Mesh(
    new THREE.BoxGeometry(36, 18, 14),
    mats.grayPlastic
  );
  holder.position.z = 7;
  holder.castShadow = true;
  holder.receiveShadow = true;
  g.add(holder);
  return g;
}

function buildSwitch(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  // Selector switch — bezel + knob
  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 4, 32),
    mats.chrome
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = 2;
  g.add(bezel);
  const knob = new THREE.Mesh(
    new THREE.BoxGeometry(22, 6, 5),
    mats.blackPlastic
  );
  knob.position.z = 6.5;
  knob.castShadow = true;
  g.add(knob);
  return g;
}

function buildDefault(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(40, 40, 40),
    mats.grayPlastic
  );
  body.position.z = 20;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  return g;
}

function buildWireframePlaceholder(mats: MaterialBag): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(40, 40, 30),
    mats.wireframe
  );
  body.position.z = 15;
  g.add(body);
  return g;
}

function buildComponentForCategory(
  cat: SymbolCategory,
  mats: MaterialBag,
  entity: SymbolEntity
): THREE.Group {
  const tag = entity.tag?.toLowerCase() || '';
  switch (cat) {
    case 'contactor-relay': {
      // Use smaller relay if tag begins with R or it's clearly small
      if (tag.startsWith('r')) return buildRelay(mats);
      return buildContactor(mats, entity.tag);
    }
    case 'fuse-breaker': {
      if (entity.symbolId.toLowerCase().includes('fuse')) return buildFuse(mats);
      return buildBreaker(mats);
    }
    case 'terminal':
      return buildTerminal(mats);
    case 'plc-io':
      return buildPLC(mats);
    case 'motor':
      return buildMotor(mats);
    case 'transformer':
      return buildTransformer(mats);
    case 'indicator': {
      const c =
        entity.attributes?.color ||
        (entity.symbolId.includes('green')
          ? 'green'
          : entity.symbolId.includes('amber')
          ? 'amber'
          : 'red');
      return buildIndicator(mats, c);
    }
    case 'pushbutton': {
      const c =
        entity.attributes?.color ||
        (tag.includes('estop') || entity.symbolId.includes('estop')
          ? 'estop'
          : entity.symbolId.includes('start') || tag.startsWith('start')
          ? 'green'
          : entity.symbolId.includes('stop')
          ? 'red'
          : 'green');
      return buildPushbutton(mats, c);
    }
    case 'switch':
      return buildSwitch(mats);
    case 'panel-component':
    default:
      return buildDefault(mats);
  }
}

// ---------- Enclosure builder -----------------------------------------------
function buildEnclosure(
  scene: THREE.Object3D,
  mats: MaterialBag,
  W: number,
  H: number
): THREE.Group {
  const root = new THREE.Group();

  // Back panel (steel, 3mm thick) — positioned with its front face at z=0
  const backThick = 3;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, backThick),
    mats.steelPainted
  );
  back.position.set(W / 2, H / 2, -backThick / 2);
  back.receiveShadow = true;
  back.castShadow = false;
  root.add(back);

  // Side rails (door frame) — 60mm deep box surrounding panel
  const frameDepth = 200;
  const frameThick = 25;
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0xb8bcc2,
    metalness: 0.5,
    roughness: 0.45,
  });
  const left = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, H + frameThick * 2, frameDepth),
    sideMat
  );
  left.position.set(-frameThick / 2, H / 2, frameDepth / 2 - backThick);
  left.castShadow = true;
  left.receiveShadow = true;
  root.add(left);
  const right = left.clone();
  right.position.x = W + frameThick / 2;
  root.add(right);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(W + frameThick * 2, frameThick, frameDepth),
    sideMat
  );
  top.position.set(W / 2, H + frameThick / 2, frameDepth / 2 - backThick);
  top.castShadow = true;
  top.receiveShadow = true;
  root.add(top);
  const bottom = top.clone();
  bottom.position.y = -frameThick / 2;
  root.add(bottom);

  // DIN rails — typical: rows at H * 0.25, 0.55, 0.85
  // Profile: top-hat 35mm wide, 7.5mm tall.
  const dinShape = new THREE.Shape();
  dinShape.moveTo(-17.5, 0);
  dinShape.lineTo(-17.5, 5);
  dinShape.lineTo(-15, 7.5);
  dinShape.lineTo(-12, 7.5);
  dinShape.lineTo(-12, 5);
  dinShape.lineTo(12, 5);
  dinShape.lineTo(12, 7.5);
  dinShape.lineTo(15, 7.5);
  dinShape.lineTo(17.5, 5);
  dinShape.lineTo(17.5, 0);
  dinShape.closePath();
  const dinExtrude = new THREE.ExtrudeGeometry(dinShape, {
    depth: W * 0.92,
    bevelEnabled: false,
  });
  dinExtrude.rotateY(Math.PI / 2);
  // After rotation, the extruded length runs along +X.
  // Place at y = row position, z = small offset above panel.

  const railRows = [H * 0.22, H * 0.5, H * 0.78];
  for (const ry of railRows) {
    const rail = new THREE.Mesh(dinExtrude.clone(), mats.dinRail);
    // The shape sits in XY before rotation; after rotateY it becomes ZX.
    // We want the cross-section in YZ, length along X.
    // ExtrudeGeometry creates along Z by default, so after rotateY(PI/2),
    // local Z -> world X. The shape's Y becomes the cross-section height.
    rail.position.set(W * 0.04, ry, 0);
    rail.castShadow = true;
    rail.receiveShadow = true;
    root.add(rail);
  }

  // Wire ducts — between DIN rail rows. Typical Panduit-style slotted duct.
  const ductRows = [H * 0.36, H * 0.64, H * 0.92, H * 0.08];
  const ductHeight = 38;
  const ductDepth = 50;
  for (const dy of ductRows) {
    if (dy < 0 || dy > H) continue;
    const ductGroup = new THREE.Group();
    // Body
    const ductBody = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.92, ductHeight, ductDepth),
      mats.duct
    );
    ductBody.position.set(W * 0.5, dy, ductDepth / 2);
    ductBody.castShadow = true;
    ductBody.receiveShadow = true;
    ductGroup.add(ductBody);

    // Slots on front face (decorative)
    const slotCount = Math.max(4, Math.floor(W / 25));
    for (let i = 0; i < slotCount; i++) {
      // Top row slot
      const slotGeom = new THREE.BoxGeometry(8, ductHeight * 0.7, 1);
      const slot = new THREE.Mesh(slotGeom, mats.ductSlot);
      slot.position.set(
        W * 0.06 + i * ((W * 0.88) / slotCount),
        dy,
        ductDepth + 0.05
      );
      ductGroup.add(slot);
    }
    // Top lip
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.93, 3, ductDepth + 4),
      mats.duct
    );
    lip.position.set(W * 0.5, dy + ductHeight / 2, ductDepth / 2 + 2);
    ductGroup.add(lip);
    // Bottom lip
    const lipB = lip.clone();
    lipB.position.y = dy - ductHeight / 2;
    ductGroup.add(lipB);

    root.add(ductGroup);
  }

  // Subtle ground bar at bottom
  const gnd = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.85, 12, 8),
    mats.copper
  );
  gnd.position.set(W * 0.5, 18, 4);
  gnd.castShadow = true;
  gnd.receiveShadow = true;
  root.add(gnd);

  // Door — hinged on the right side. Mode (open/closed/hidden) is applied
  // imperatively after build via root.getObjectByName('door').
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(H * 0.95, H + frameThick * 1.6, 4),
    new THREE.MeshStandardMaterial({
      color: 0xa8acb2,
      metalness: 0.7,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })
  );
  door.name = 'door';
  door.geometry.translate(H * 0.475, 0, 0);
  door.position.set(W + frameThick, H / 2, frameDepth - backThick - 4);
  door.rotation.y = -Math.PI * 0.55;
  door.castShadow = true;
  door.receiveShadow = true;
  root.add(door);

  scene.add(root);
  return root;
}

// ---------- Wire builder -----------------------------------------------------
function wireColor(t?: string): number {
  const k = (t || '').toUpperCase();
  if (k.includes('PE') || k.includes('GND')) return 0x2c8a3a; // green
  if (k.includes('N')) return 0x1f6fb4; // blue
  if (k.includes('L1') || k === 'L1') return 0x2a2a2a; // black
  if (k.includes('L2')) return 0xb22a2a; // red
  if (k.includes('L3')) return 0x2a2ab2; // blue-ish
  if (k.includes('24V') || k.includes('+24')) return 0xc41a1a; // red
  if (k.includes('0V') || k.includes('COM')) return 0x141414;
  if (k.includes('120')) return 0xc41a1a;
  return 0xc41a1a;
}

// ---------- Building-mode scenery -------------------------------------------
// Default elevation (mm) for each containment type in building mode.
// Tuned to a real 3 m wall height — runs hang just below the ceiling like
// a real ceiling-mount BIM model.
const BUILDING_ELEVATION: Record<string, number> = {
  trunking: 2700,
  basket: 2400,
  tray: 2100,
  conduit: 1800,
};

// ---------- Containment builder ---------------------------------------------
// Build a Group representing one containment run by walking each polyline
// segment and emitting the appropriate per-segment geometry. Corners may
// show a small gap at sharp bends — acceptable for a panel-layout overview.
function buildContainmentGroup(
  c: ContainmentEntity,
  H: number,
  mats: MaterialBag,
  // Bottom-of-section elevation in panel-Z. In panel mode this stays small
  // so runs sit on the back panel; in building mode the caller passes a
  // ceiling-height value so runs hang above the floor like real BIM models.
  baseZ = 30
): THREE.Group | null {
  if (!c.points || c.points.length < 2) return null;
  const grp = new THREE.Group();
  const w = c.width ?? 50;
  const h = c.height ?? 50;

  // Per-entity color override. When the sample (or user) sets a colour on
  // the containment, fresh materials replace the cached defaults so the
  // run reads with that hue in 3D.
  const overrideHex = c.color ? new THREE.Color(c.color).getHex() : null;
  const matFor = (
    fallback: THREE.Material,
    metalness = 0.05,
    roughness = 0.55,
  ): THREE.Material => {
    if (overrideHex == null) return fallback;
    return new THREE.MeshStandardMaterial({
      color: overrideHex,
      metalness,
      roughness,
    });
  };

  for (let i = 0; i < c.points.length - 1; i++) {
    const a = c.points[i];
    const b = c.points[i + 1];
    // Flip y to match panel convention (CAD y is screen-down).
    const ax = a.x;
    const ay = H - a.y;
    const bx = b.x;
    const by = H - b.y;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;

    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    // Segment is built along its local +x axis (length), then rotated to
    // match its heading in the XY plane.
    const heading = Math.atan2(dy, dx);

    if (c.containmentType === 'conduit') {
      const radius = w / 2;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, 16, 1, false),
        matFor(mats.chrome, 0.85, 0.25)
      );
      // CylinderGeometry's axis is +Y; rotate so it lies along +X, then
      // rotate again into the segment's heading.
      tube.rotation.z = Math.PI / 2;
      const wrap = new THREE.Group();
      wrap.add(tube);
      wrap.position.set(cx, cy, baseZ + radius);
      wrap.rotation.z = heading;
      tube.castShadow = true;
      tube.receiveShadow = true;
      grp.add(wrap);
      continue;
    }

    if (c.containmentType === 'trunking') {
      // Solid rectangular tube + a darker lid on top.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(len, w, h),
        matFor(mats.grayPlastic, 0.1, 0.55)
      );
      // The lid keeps a distinct darker accent even when an override hue
      // is supplied — modulate the override to make it slightly darker.
      let lidMat: THREE.Material = mats.blackPlastic;
      if (overrideHex != null) {
        const c2 = new THREE.Color(overrideHex).multiplyScalar(0.55);
        lidMat = new THREE.MeshStandardMaterial({
          color: c2,
          metalness: 0.05,
          roughness: 0.6,
        });
      }
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(len, w * 0.92, h * 0.12),
        lidMat
      );
      lid.position.z = h / 2 + (h * 0.12) / 2 - 0.5;
      const wrap = new THREE.Group();
      wrap.add(body);
      wrap.add(lid);
      wrap.position.set(cx, cy, baseZ + h / 2);
      wrap.rotation.z = heading;
      body.castShadow = true;
      body.receiveShadow = true;
      lid.castShadow = true;
      grp.add(wrap);
      continue;
    }

    if (c.containmentType === 'tray') {
      // U-channel — bottom plate + two side rails, top open.
      const tk = 2; // wall thickness
      const wrap = new THREE.Group();
      const trayMat = matFor(mats.steel, 0.4, 0.45);
      const bottom = new THREE.Mesh(
        new THREE.BoxGeometry(len, w, tk),
        trayMat
      );
      bottom.position.z = -h / 2 + tk / 2;
      bottom.castShadow = true;
      bottom.receiveShadow = true;
      wrap.add(bottom);
      for (const sy of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(len, tk, h),
          trayMat
        );
        side.position.set(0, sy * (w / 2 - tk / 2), 0);
        side.castShadow = true;
        side.receiveShadow = true;
        wrap.add(side);
      }
      // Perforation indication: a few thin slots along the bottom
      const slotCount = Math.max(2, Math.floor(len / 30));
      for (let k = 0; k < slotCount; k++) {
        const slot = new THREE.Mesh(
          new THREE.BoxGeometry(8, w * 0.5, 0.4),
          mats.ductSlot
        );
        slot.position.set(
          -len / 2 + (k + 0.5) * (len / slotCount),
          0,
          -h / 2 + tk + 0.2
        );
        wrap.add(slot);
      }
      wrap.position.set(cx, cy, baseZ + h / 2);
      wrap.rotation.z = heading;
      grp.add(wrap);
      continue;
    }

    if (c.containmentType === 'basket') {
      // Cable basket — thin solid bottom + low side flanges. Looks like a
      // real basket from a distance and avoids the "ladder rungs" look that
      // a hollow cage would create when viewed from below.
      const wrap = new THREE.Group();
      const basketMat = matFor(mats.steel, 0.4, 0.45);
      const tk = 1.5;
      const flangeH = Math.min(h, 12); // short side flanges, not full height
      const bottom = new THREE.Mesh(
        new THREE.BoxGeometry(len, w, tk),
        basketMat
      );
      bottom.position.z = -h / 2 + tk / 2;
      bottom.castShadow = true;
      bottom.receiveShadow = true;
      wrap.add(bottom);
      for (const sy of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(len, tk, flangeH),
          basketMat
        );
        side.position.set(0, sy * (w / 2 - tk / 2), -h / 2 + flangeH / 2);
        side.castShadow = true;
        side.receiveShadow = true;
        wrap.add(side);
      }
      // Mesh hint: a few longitudinal cylinders running along the bottom
      // imply the wire-mesh weave without sticking up like ladder rungs.
      const meshCount = 4;
      for (let r = 0; r < meshCount; r++) {
        const t = (r + 0.5) / meshCount;
        const y = -w / 2 + t * w;
        const rail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, len, 6),
          basketMat
        );
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, y, -h / 2 + tk + 0.7);
        wrap.add(rail);
      }
      wrap.position.set(cx, cy, baseZ + h / 2);
      wrap.rotation.z = heading;
      grp.add(wrap);
      continue;
    }
  }

  return grp;
}

// ---------- Wall builder ----------------------------------------------------
// Walls are extruded segments along a polyline. Built in panel coords; the
// contentRoot's -90deg X rotation flips +Z (height) onto world +Y so each
// segment stands vertical on the floor.

interface ContainmentRunInfo {
  points: Vec2[];
  containmentType: string;
  width: number;
  height: number;
  baseZ: number;
}

interface HoleDef {
  tPos: number;
  holeW: number;
  zBottom: number;
  zTop: number;
}

function segmentIntersect2D(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): { t: number; s: number } | null {
  const ux = bx - ax, uy = by - ay;
  const vx = dx - cx, vy = dy - cy;
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-6) return null;
  const wx = ax - cx, wy = ay - cy;
  const t = (vx * wy - vy * wx) / cross;
  const s = (ux * wy - uy * wx) / cross;
  if (t < -0.001 || t > 1.001 || s < -0.001 || s > 1.001) return null;
  return {
    t: Math.max(0, Math.min(1, t)),
    s: Math.max(0, Math.min(1, s)),
  };
}

function computeHolesForSegment(
  wallAx: number, wallAy: number,
  wallBx: number, wallBy: number,
  runs: ContainmentRunInfo[],
  H: number,
  wallHeight: number,
): HoleDef[] {
  const holes: HoleDef[] = [];
  const wallLen = Math.hypot(wallBx - wallAx, wallBy - wallAy);
  if (wallLen < 1) return holes;
  const wdx = (wallBx - wallAx) / wallLen;
  const wdy = (wallBy - wallAy) / wallLen;

  const CLEARANCE = 40;

  for (const run of runs) {
    for (let j = 0; j < run.points.length - 1; j++) {
      const ca = run.points[j];
      const cb = run.points[j + 1];
      const cax = ca.x, cay = H - ca.y;
      const cbx = cb.x, cby = H - cb.y;

      const hit = segmentIntersect2D(
        wallAx, wallAy, wallBx, wallBy,
        cax, cay, cbx, cby,
      );
      if (!hit) continue;

      const contDx = cbx - cax, contDy = cby - cay;
      const contLen = Math.hypot(contDx, contDy);
      if (contLen < 1) continue;

      const sinAngle = Math.abs((contDx * wdy - contDy * wdx) / contLen);
      if (sinAngle < 0.05) continue;

      const crossWidth = run.width;
      const crossHeight = run.containmentType === 'conduit'
        ? run.width : run.height;
      const holeW = crossWidth / sinAngle + CLEARANCE * 2;
      const zBottom = Math.max(0, run.baseZ - CLEARANCE);
      const zTop = Math.min(wallHeight, run.baseZ + crossHeight + CLEARANCE);

      holes.push({
        tPos: hit.t,
        holeW: Math.min(holeW, wallLen * 0.9),
        zBottom,
        zTop,
      });
    }
  }

  holes.sort((a, b) => a.tPos - b.tPos);
  return holes;
}

function buildWallGroup(
  w: WallEntity,
  H: number,
  _mats: MaterialBag,
  containmentRuns: ContainmentRunInfo[] = [],
): THREE.Group | null {
  if (!w.points || w.points.length < 2) return null;
  const grp = new THREE.Group();
  const thickness = w.thickness ?? 200;
  const wallHeight = w.height ?? 3000;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xeceeef,
    metalness: 0.0,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < w.points.length - 1; i++) {
    const a = w.points[i];
    const b = w.points[i + 1];
    const ax = a.x;
    const ay = H - a.y;
    const bx = b.x;
    const by = H - b.y;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;

    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const heading = Math.atan2(dy, dx);

    const holes = computeHolesForSegment(
      ax, ay, bx, by, containmentRuns, H, wallHeight,
    );

    if (holes.length === 0) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(len, thickness, wallHeight),
        wallMat,
      );
      seg.position.set(cx, cy, wallHeight / 2);
      seg.rotation.z = heading;
      seg.castShadow = true;
      seg.receiveShadow = true;
      grp.add(seg);
    } else {
      const segGroup = new THREE.Group();
      segGroup.position.set(cx, cy, 0);
      segGroup.rotation.z = heading;

      const addBox = (bx: number, bz: number, bw: number, bh: number) => {
        if (bw < 1 || bh < 1) return;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(bw, thickness, bh),
          wallMat,
        );
        mesh.position.set(bx, 0, bz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        segGroup.add(mesh);
      };

      let cursor = -len / 2;
      for (const hole of holes) {
        const hCenter = hole.tPos * len - len / 2;
        const hLeft = hCenter - hole.holeW / 2;
        const hRight = hCenter + hole.holeW / 2;

        const beforeW = hLeft - cursor;
        if (beforeW > 1) {
          addBox((cursor + hLeft) / 2, wallHeight / 2, beforeW, wallHeight);
        }

        if (hole.zBottom > 1) {
          addBox(hCenter, hole.zBottom / 2, hole.holeW, hole.zBottom);
        }
        const aboveH = wallHeight - hole.zTop;
        if (aboveH > 1) {
          addBox(hCenter, hole.zTop + aboveH / 2, hole.holeW, aboveH);
        }

        cursor = hRight;
      }

      const afterW = len / 2 - cursor;
      if (afterW > 1) {
        addBox((cursor + len / 2) / 2, wallHeight / 2, afterW, wallHeight);
      }

      grp.add(segGroup);
    }
  }

  return grp;
}

// ---------- Room builder ----------------------------------------------------
// A thin floor slab covering the rectangle from r.a to r.b. Panel-Y must be
// flipped to match panel convention (CAD y is screen-down).
function buildRoomGroup(
  r: RoomEntity,
  H: number,
  // mats unused for now — kept for signature parity with other builders.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mats: MaterialBag
): THREE.Group | null {
  const xMin = Math.min(r.a.x, r.b.x);
  const xMax = Math.max(r.a.x, r.b.x);
  const yMin = Math.min(r.a.y, r.b.y);
  const yMax = Math.max(r.a.y, r.b.y);
  const width = xMax - xMin;
  const depth = yMax - yMin;
  if (width < 1e-3 || depth < 1e-3) return null;

  const grp = new THREE.Group();
  const slabThick = 6; // mm — sits just above the building floor (y = -10)

  // Panel-coord centre. Panel-Y flip: yMin..yMax in sheet coords becomes
  // (H - yMin)..(H - yMax) in panel-Y; the centre is symmetric.
  const cx = (xMin + xMax) / 2;
  const cy = H - (yMin + yMax) / 2;

  const colorHex = r.floorColor
    ? new THREE.Color(r.floorColor).getHex()
    : 0xb6c1cc;
  const slabMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.0,
    roughness: 0.85,
  });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, slabThick),
    slabMat
  );
  slab.position.set(cx, cy, slabThick / 2);
  slab.receiveShadow = true;
  // No castShadow — the slab is flat against the floor.
  grp.add(slab);

  return grp;
}

function buildWireMesh(w: WireEntity, H: number): THREE.Mesh | null {
  if (!w.points || w.points.length < 2) return null;
  const color = w.color
    ? new THREE.Color(w.color).getHex()
    : wireColor(w.wireType);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.5,
  });
  const pts: THREE.Vector3[] = w.points.map(
    (p, i) =>
      new THREE.Vector3(
        p.x,
        H - p.y,
        25 + (i % 2) * 1.5
      )
  );
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  const tube = new THREE.TubeGeometry(
    curve,
    Math.max(8, pts.length * 6),
    1.2,
    8,
    false
  );
  const mesh = new THREE.Mesh(tube, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- Custom orbit controls -------------------------------------------
interface OrbitState {
  target: THREE.Vector3;
  // spherical coords
  azimuth: number;
  polar: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
  apply(camera: THREE.PerspectiveCamera): void;
}

function makeOrbitControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  initialTarget: THREE.Vector3
): { state: OrbitState; dispose: () => void } {
  const state: OrbitState = {
    target: initialTarget.clone(),
    azimuth: 0.5,
    polar: 1.05,
    distance: camera.position.distanceTo(initialTarget),
    minDistance: 50,
    maxDistance: 30000,
    apply(cam) {
      const sinP = Math.sin(this.polar);
      const cosP = Math.cos(this.polar);
      const sinA = Math.sin(this.azimuth);
      const cosA = Math.cos(this.azimuth);
      cam.position.set(
        this.target.x + this.distance * sinP * sinA,
        this.target.y + this.distance * cosP,
        this.target.z + this.distance * sinP * cosA
      );
      cam.lookAt(this.target);
    },
  };

  // Initialize azimuth/polar from current camera position
  const offset = new THREE.Vector3().subVectors(camera.position, state.target);
  state.distance = offset.length();
  state.polar = Math.acos(
    Math.max(-1, Math.min(1, offset.y / state.distance))
  );
  state.azimuth = Math.atan2(offset.x, offset.z);

  let isRotating = false;
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      isRotating = true;
    } else if (e.button === 2) {
      isPanning = true;
    }
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!isRotating && !isPanning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (isRotating) {
      state.azimuth -= dx * 0.005;
      state.polar = Math.max(
        0.05,
        Math.min(Math.PI - 0.05, state.polar - dy * 0.005)
      );
      state.apply(camera);
    } else if (isPanning) {
      // Pan in camera-relative axes
      const panX = -dx * state.distance * 0.0015;
      const panY = dy * state.distance * 0.0015;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.getWorldDirection(new THREE.Vector3()); // ensure matrices fresh
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      state.target.addScaledVector(right, panX);
      state.target.addScaledVector(up, panY);
      state.apply(camera);
    }
  };
  const onMouseUp = () => {
    isRotating = false;
    isPanning = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Normalize delta across input devices: trackpads send many small
    // pixel-mode events, mice send a few large line-mode ticks.
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= 100;
    // Clamp per-event so one big mouse tick doesn't overshoot wildly
    delta = Math.max(-80, Math.min(80, delta));
    const factor = Math.exp(delta * 0.005);
    state.distance = Math.max(
      state.minDistance,
      Math.min(state.maxDistance, state.distance * factor)
    );
    state.apply(camera);
  };
  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    dispose: () => {
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

// ---------- Disposal helpers -------------------------------------------------
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child: THREE.Object3D) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = child as any;
    if (m.geometry && typeof m.geometry.dispose === 'function') {
      m.geometry.dispose();
    }
    if (m.material) {
      if (Array.isArray(m.material)) {
        for (const mm of m.material)
          if (mm && typeof mm.dispose === 'function') mm.dispose();
      } else if (typeof m.material.dispose === 'function') {
        m.material.dispose();
      }
    }
  });
}

// ---------- Active sheet selection -------------------------------------------
function pickSheetForViewer(project: Project): { sheet: Sheet; isPanel: boolean } {
  const active = project.sheets[project.activeSheetId];
  if (active && active.kind === 'panel-layout') {
    return { sheet: active, isPanel: true };
  }
  // Prefer the first panel-layout sheet if any
  for (const id of project.sheetOrder) {
    const s = project.sheets[id];
    if (s && s.kind === 'panel-layout') return { sheet: s, isPanel: true };
  }
  return { sheet: active, isPanel: false };
}

// ---------- View presets -----------------------------------------------------
export type ViewPreset = 'iso' | 'front' | 'top' | 'left';
export type DoorMode = 'open' | 'closed' | 'hidden';

// Apply a named camera framing for a panel of size W x H.
// sceneStyle controls whether the camera frames a vertical panel ('panel')
// or a horizontal floor ('building'); the latter accounts for the -90° X
// rotation that contentRoot receives in building mode.
function applyViewPreset(
  preset: ViewPreset,
  W: number,
  H: number,
  camera: THREE.PerspectiveCamera,
  orbit: OrbitState,
  sceneStyle: 'panel' | 'building' = 'panel'
): void {
  const fovRad = (camera.fov * Math.PI) / 180;

  let dir: THREE.Vector3;
  let fitDist: number;
  if (sceneStyle === 'building') {
    // Building-mode: rotated content lays on the floor (X ∈ [0, W],
    // Z ∈ [-H, 0]). Fit the floor diagonal plus generous margin so the
    // whole building, including 3m walls, is in frame.
    const diag = Math.hypot(W, H);
    fitDist = diag / (2 * Math.tan(fovRad / 2)) * 0.9;
    // Aim mid-room height so the camera sees walls + ceiling ducts.
    orbit.target.set(W / 2, 1500, -H / 2);
    switch (preset) {
      case 'front':
        dir = new THREE.Vector3(0, 0.15, 1).normalize();
        break;
      case 'top':
        dir = new THREE.Vector3(0.001, 1, 0.001).normalize();
        break;
      case 'left':
        dir = new THREE.Vector3(-1, 0.15, 0.1).normalize();
        break;
      case 'iso':
      default:
        // Higher angle so the camera clears the 3 m walls and sees the
        // rooftop / interior layout.
        dir = new THREE.Vector3(-0.4, 0.7, 0.55).normalize();
        break;
    }
  } else {
    fitDist = Math.max(W, H) / (2 * Math.tan(fovRad / 2)) * 1.4 + 200;
    orbit.target.set(W / 2, H / 2, 100);
    switch (preset) {
      case 'front':
        dir = new THREE.Vector3(0, 0.05, 1).normalize();
        break;
      case 'top':
        dir = new THREE.Vector3(0, 1, 0.001).normalize();
        break;
      case 'left':
        dir = new THREE.Vector3(-1, 0.1, 0.1).normalize();
        break;
      case 'iso':
      default:
        dir = new THREE.Vector3(-0.4, 0.5, 1).normalize();
        break;
    }
  }

  camera.position.copy(orbit.target).addScaledVector(dir, fitDist);
  const offset = new THREE.Vector3().subVectors(camera.position, orbit.target);
  orbit.distance = offset.length();
  orbit.polar = Math.acos(
    Math.max(-1, Math.min(1, offset.y / orbit.distance))
  );
  orbit.azimuth = Math.atan2(offset.x, offset.z);
  orbit.apply(camera);
}

// Apply door visibility/rotation for a given mode.
function applyDoorMode(root: THREE.Object3D | null, mode: DoorMode): void {
  if (!root) return;
  const door = root.getObjectByName('door');
  if (!door) return;
  switch (mode) {
    case 'open':
      door.visible = true;
      door.rotation.y = -Math.PI * 0.55;
      break;
    case 'closed':
      door.visible = true;
      door.rotation.y = 0;
      break;
    case 'hidden':
      door.visible = false;
      break;
  }
}

// ---------- Main component ---------------------------------------------------
export interface Panel3DProps {
  project: Project;
  width?: number;
  height?: number;
  doorMode?: DoorMode;
  // Increment `viewKey` to (re-)apply `viewPreset`. Without this nonce the
  // effect couldn't tell a fresh user-click from the prop merely staying
  // the same after the user has orbited.
  viewKey?: number;
  viewPreset?: ViewPreset;
}

export function Panel3D({
  project,
  width,
  height,
  doorMode = 'open',
  viewKey = 0,
  viewPreset = 'iso',
}: Panel3DProps): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Persistent three.js refs across renders/effects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<{ state: OrbitState; dispose: () => void } | null>(
    null
  );
  const animationRef = useRef<number | null>(null);
  const contentRootRef = useRef<THREE.Group | null>(null);
  const materialsRef = useRef<MaterialBag | null>(null);
  // Last-built panel dimensions, so view-preset effect can reframe correctly.
  const sizeRef = useRef<{ w: number; h: number }>({ w: 600, h: 400 });
  // Diffing state for incremental scene updates
  const enclosureRef = useRef<THREE.Group | null>(null);
  const symbolsGroupRef = useRef<THREE.Group | null>(null);
  const wiresGroupRef = useRef<THREE.Group | null>(null);
  const containmentGroupRef = useRef<THREE.Group | null>(null);
  const symbolMapRef = useRef<Map<string, { group: THREE.Group; sig: string }>>(
    new Map()
  );
  const wireMapRef = useRef<Map<string, { mesh: THREE.Mesh; sig: string }>>(
    new Map()
  );
  const containmentMapRef = useRef<
    Map<string, { group: THREE.Group; sig: string }>
  >(new Map());
  // Walls + rooms: only populated in building mode, but we keep refs at the
  // top level so cleanup mirrors the other diff maps.
  const wallsGroupRef = useRef<THREE.Group | null>(null);
  const roomsGroupRef = useRef<THREE.Group | null>(null);
  const wallMapRef = useRef<
    Map<string, { group: THREE.Group; sig: string }>
  >(new Map());
  const roomMapRef = useRef<
    Map<string, { group: THREE.Group; sig: string }>
  >(new Map());
  // (sheetId, w, h) signature so we know when to reframe and rebuild enclosure
  const lastFrameSigRef = useRef<string>('');
  const lastEnclosureSigRef = useRef<string>('');
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  // Scene-style elements: panel mode and building mode each get their own
  // floor + ambient setup. Toggled via .visible based on the active sheet.
  const panelFloorRef = useRef<THREE.Mesh | null>(null);
  const panelAccentRef = useRef<THREE.Mesh | null>(null);
  const buildingFloorRef = useRef<THREE.Mesh | null>(null);
  const buildingAmbientRef = useRef<THREE.Light | null>(null);
  const skyMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const lastSceneStyleRef = useRef<'panel' | 'building'>('panel');

  // ---- One-time scene initialization -----------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Try to load symbol library asynchronously (fire-and-forget)
    ensureSymbolLibrary();

    const initialW = mount.clientWidth || width || 800;
    const initialH = mount.clientHeight || height || 600;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d22);
    scene.fog = new THREE.Fog(0x1a1d22, 1500, 5000);
    sceneRef.current = scene;

    // Gradient background (a large hemispheric sky-dome)
    const skyGeo = new THREE.SphereGeometry(4500, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x2a313a) },
        bottomColor: { value: new THREE.Color(0x0d1015) },
        offset: { value: 200 },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
    skyMatRef.current = skyMat;

    // Camera — positioned later when project is known. Far plane sized to
    // comfortably contain a building-scale scene (tens of metres).
    const camera = new THREE.PerspectiveCamera(
      45,
      initialW / initialH,
      1,
      200000
    );
    camera.position.set(800, 800, 1200);
    camera.lookAt(400, 200, 0);
    cameraRef.current = camera;

    // Renderer
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

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x202428, 0.45);
    hemi.position.set(0, 1500, 0);
    scene.add(hemi);

    // Key light (directional, casts shadow)
    const dir = new THREE.DirectionalLight(0xfff2d8, 1.4);
    dir.position.set(900, 1400, 1100);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 4000;
    dir.shadow.camera.left = -1500;
    dir.shadow.camera.right = 1500;
    dir.shadow.camera.top = 1500;
    dir.shadow.camera.bottom = -1500;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.5;
    scene.add(dir);

    // Fill light (cooler, opposite side)
    const fill = new THREE.DirectionalLight(0xa6c4ff, 0.5);
    fill.position.set(-700, 800, 600);
    scene.add(fill);

    // Rim/back light
    const rim = new THREE.DirectionalLight(0xffe2bb, 0.3);
    rim.position.set(0, 400, -1500);
    scene.add(rim);

    // Floors — one for each scene style. Visibility toggled per sheet.
    const floorGeo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x171a1f,
      metalness: 0.0,
      roughness: 0.95,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -50;
    floor.receiveShadow = true;
    scene.add(floor);
    panelFloorRef.current = floor;

    // Subtle radial accent on floor under panel (fake AO)
    const accent = new THREE.Mesh(
      new THREE.CircleGeometry(800, 64),
      new THREE.MeshBasicMaterial({
        color: 0x2a2e34,
        transparent: true,
        opacity: 0.6,
      })
    );
    accent.rotation.x = -Math.PI / 2;
    accent.position.y = -49.5;
    scene.add(accent);
    panelAccentRef.current = accent;

    // Building-style floor: a bright concrete-look slab. Hidden until a
    // sheet with sceneStyle='building' becomes active.
    const buildingFloorGeo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
    const buildingFloorMat = new THREE.MeshStandardMaterial({
      color: 0xc9cdd2,
      metalness: 0.0,
      roughness: 0.85,
    });
    const buildingFloor = new THREE.Mesh(buildingFloorGeo, buildingFloorMat);
    buildingFloor.rotation.x = -Math.PI / 2;
    buildingFloor.position.y = -10;
    buildingFloor.receiveShadow = true;
    buildingFloor.visible = false;
    scene.add(buildingFloor);
    buildingFloorRef.current = buildingFloor;

    // Extra ambient light used only in building mode for the brighter,
    // daylight-interior feel seen in BIM viewers.
    const buildingAmbient = new THREE.AmbientLight(0xffffff, 0.0);
    scene.add(buildingAmbient);
    buildingAmbientRef.current = buildingAmbient;

    // Materials cache
    materialsRef.current = buildMaterials();

    // Orbit controls
    orbitRef.current = makeOrbitControls(
      camera,
      renderer.domElement,
      new THREE.Vector3(400, 250, 0)
    );

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || initialW;
      const h = mount.clientHeight || initialH;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(mount);
    resizeObsRef.current = ro;

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      orbitRef.current?.dispose();
      orbitRef.current = null;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;

      if (contentRootRef.current) {
        scene.remove(contentRootRef.current);
        disposeObject(contentRootRef.current);
        contentRootRef.current = null;
      }
      enclosureRef.current = null;
      symbolsGroupRef.current = null;
      wiresGroupRef.current = null;
      containmentGroupRef.current = null;
      wallsGroupRef.current = null;
      roomsGroupRef.current = null;
      symbolMapRef.current.clear();
      wireMapRef.current.clear();
      containmentMapRef.current.clear();
      wallMapRef.current.clear();
      roomMapRef.current.clear();
      lastFrameSigRef.current = '';
      lastEnclosureSigRef.current = '';

      // Dispose scene-attached singletons
      scene.traverse((obj: THREE.Object3D) => disposeObject(obj));
      materialsRef.current?.dispose();
      materialsRef.current = null;

      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Reconcile content when project changes (incremental) ------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const mats = materialsRef.current;
    if (!scene || !camera || !orbit || !mats) return;

    // Lazily create the persistent root + sub-groups on first run.
    let root = contentRootRef.current;
    if (!root) {
      root = new THREE.Group();
      contentRootRef.current = root;
      scene.add(root);
      const symG = new THREE.Group();
      const wireG = new THREE.Group();
      const contG = new THREE.Group();
      const wallG = new THREE.Group();
      const roomG = new THREE.Group();
      symbolsGroupRef.current = symG;
      wiresGroupRef.current = wireG;
      containmentGroupRef.current = contG;
      wallsGroupRef.current = wallG;
      roomsGroupRef.current = roomG;
      root.add(symG);
      root.add(wireG);
      root.add(contG);
      root.add(wallG);
      root.add(roomG);
    }
    const symbolsGroup = symbolsGroupRef.current!;
    const wiresGroup = wiresGroupRef.current!;
    const containmentGroup = containmentGroupRef.current!;
    const wallsGroup = wallsGroupRef.current!;
    const roomsGroup = roomsGroupRef.current!;
    const symbolMap = symbolMapRef.current;
    const wireMap = wireMapRef.current;
    const containmentMap = containmentMapRef.current;
    const wallMap = wallMapRef.current;
    const roomMap = roomMapRef.current;

    const { sheet, isPanel } = pickSheetForViewer(project);
    const W = sheet?.width || 600;
    const H = sheet?.height || 400;
    const sceneStyle: 'panel' | 'building' = sheet?.sceneStyle ?? 'panel';
    const isBuilding = sceneStyle === 'building';
    const enclSig = `${W}x${H}|${sceneStyle}`;

    // Apply scene-style toggles: panel uses dark floor + enclosure, building
    // uses a bright concrete floor with no panel hardware.
    if (panelFloorRef.current) panelFloorRef.current.visible = !isBuilding;
    if (panelAccentRef.current) panelAccentRef.current.visible = !isBuilding;
    if (buildingFloorRef.current) buildingFloorRef.current.visible = isBuilding;
    if (buildingAmbientRef.current) buildingAmbientRef.current.intensity = isBuilding ? 0.55 : 0.0;
    if (skyMatRef.current) {
      const u = skyMatRef.current.uniforms;
      if (isBuilding) {
        u.topColor.value.setHex(0xd9e2eb);
        u.bottomColor.value.setHex(0x9aa1a8);
      } else {
        u.topColor.value.setHex(0x2a313a);
        u.bottomColor.value.setHex(0x0d1015);
      }
    }
    // Push fog way back in building mode (camera distances run 5–15 m) and
    // tint it daylight-gray so it doesn't kill colours at range.
    if (scene.fog && scene.fog instanceof THREE.Fog) {
      if (isBuilding) {
        scene.fog.color.setHex(0xc4cdd4);
        scene.fog.near = 30000;
        scene.fog.far = 200000;
        scene.background = new THREE.Color(0xc4cdd4);
      } else {
        scene.fog.color.setHex(0x1a1d22);
        scene.fog.near = 1500;
        scene.fog.far = 5000;
        scene.background = new THREE.Color(0x1a1d22);
      }
    }
    // In building mode, rotate the contentRoot so the panel's X-Y plane
    // becomes the world's X-(-Z) floor plane. Containment runs that
    // previously stuck out toward the camera now extrude upward.
    root.rotation.x = isBuilding ? -Math.PI / 2 : 0;
    lastSceneStyleRef.current = sceneStyle;

    // (Re)build the enclosure when size or scene style changes. In building
    // mode the enclosure is omitted entirely.
    if (enclSig !== lastEnclosureSigRef.current) {
      if (enclosureRef.current) {
        root.remove(enclosureRef.current);
        disposeObject(enclosureRef.current);
        enclosureRef.current = null;
      }
      if (!isBuilding) {
        const enc = new THREE.Group();
        buildEnclosure(enc, mats, W, H);
        root.add(enc);
        enclosureRef.current = enc;
      }
      lastEnclosureSigRef.current = enclSig;
    }

    // Symbols: walk current entities, build/update/remove.
    const seenSymbols = new Set<string>();
    if (sheet) {
      for (const id of sheet.entityOrder) {
        const e: Entity | undefined = sheet.entities[id];
        if (!e || e.visible === false || e.kind !== 'symbol') continue;
        const sym = e as SymbolEntity;
        const cat = categoryFor(sym);
        // Signature controls when the underlying geometry must be rebuilt.
        // Position/rotation/scale don't change geometry — applied directly.
        const sig = [
          isPanel ? cat : 'wf',
          sym.symbolId,
          sym.tag ?? '',
          sym.attributes?.color ?? '',
          sym.mirror ? '1' : '0',
        ].join('|');

        let entry = symbolMap.get(id);
        if (!entry || entry.sig !== sig) {
          if (entry) {
            symbolsGroup.remove(entry.group);
            disposeObject(entry.group);
          }
          const g = isPanel
            ? buildComponentForCategory(cat, mats, sym)
            : buildWireframePlaceholder(mats);
          symbolsGroup.add(g);
          entry = { group: g, sig };
          symbolMap.set(id, entry);
        }

        const g = entry.group;
        g.position.set(sym.position.x, H - sym.position.y, 0);
        g.rotation.z = sym.rotation || 0;
        const s = sym.scale && sym.scale !== 1 ? sym.scale : 1;
        g.scale.setScalar(s);
        if (sym.mirror) g.scale.x *= -1;
        seenSymbols.add(id);
      }
    }
    for (const [id, entry] of symbolMap) {
      if (seenSymbols.has(id)) continue;
      symbolsGroup.remove(entry.group);
      disposeObject(entry.group);
      symbolMap.delete(id);
    }

    // Wires: same diff pattern. Geometry depends on point list, so the
    // signature includes the JSON of points + style.
    const seenWires = new Set<string>();
    if (sheet && isPanel) {
      for (const id of sheet.entityOrder) {
        const e = sheet.entities[id];
        if (!e || e.visible === false || e.kind !== 'wire') continue;
        const w = e as WireEntity;
        const sig = [
          JSON.stringify(w.points),
          w.wireType ?? '',
          w.color ?? '',
          String(H),
        ].join('|');
        let entry = wireMap.get(id);
        if (!entry || entry.sig !== sig) {
          if (entry) {
            wiresGroup.remove(entry.mesh);
            disposeObject(entry.mesh);
          }
          const mesh = buildWireMesh(w, H);
          if (!mesh) continue;
          wiresGroup.add(mesh);
          entry = { mesh, sig };
          wireMap.set(id, entry);
        }
        seenWires.add(id);
      }
    }
    for (const [id, entry] of wireMap) {
      if (seenWires.has(id)) continue;
      wiresGroup.remove(entry.mesh);
      disposeObject(entry.mesh);
      wireMap.delete(id);
    }

    // Containment runs (trunking / basket / tray / conduit). Geometry is
    // built per-segment, so any change to points/dims/type forces rebuild.
    const seenContainment = new Set<string>();
    if (sheet) {
      for (const id of sheet.entityOrder) {
        const e = sheet.entities[id];
        if (!e || e.visible === false || e.kind !== 'containment') continue;
        const c = e as ContainmentEntity;
        const baseZ = isBuilding
          ? BUILDING_ELEVATION[c.containmentType] ?? 2200
          : 30;
        const sig = [
          c.containmentType,
          JSON.stringify(c.points),
          String(c.width ?? ''),
          String(c.height ?? ''),
          String(c.color ?? ''),
          String(H),
          String(baseZ),
        ].join('|');
        let entry = containmentMap.get(id);
        if (!entry || entry.sig !== sig) {
          if (entry) {
            containmentGroup.remove(entry.group);
            disposeObject(entry.group);
          }
          const grp = buildContainmentGroup(c, H, mats, baseZ);
          if (!grp) continue;
          containmentGroup.add(grp);
          entry = { group: grp, sig };
          containmentMap.set(id, entry);
        }
        seenContainment.add(id);
      }
    }
    for (const [id, entry] of containmentMap) {
      if (seenContainment.has(id)) continue;
      containmentGroup.remove(entry.group);
      disposeObject(entry.group);
      containmentMap.delete(id);
    }

    // Walls and rooms — only meaningful for floor-plan (building) sheets.
    // In panel mode we still want any previously-built meshes torn down so
    // toggling sceneStyle doesn't leave them orbiting the panel.
    if (isBuilding) {
      // Collect containment run info for wall cutout detection.
      const containmentRuns: ContainmentRunInfo[] = [];
      if (sheet) {
        for (const id of sheet.entityOrder) {
          const e = sheet.entities[id];
          if (!e || e.visible === false || e.kind !== 'containment') continue;
          const c = e as ContainmentEntity;
          const cBaseZ = BUILDING_ELEVATION[c.containmentType] ?? 2200;
          containmentRuns.push({
            points: c.points,
            containmentType: c.containmentType,
            width: c.width ?? 50,
            height: c.containmentType === 'conduit'
              ? (c.width ?? 50) : (c.height ?? 50),
            baseZ: cBaseZ,
          });
        }
      }
      const contRunSig = containmentRuns.map(r =>
        `${r.containmentType}:${JSON.stringify(r.points)}:${r.width}:${r.height}:${r.baseZ}`
      ).join(';;');

      const seenWalls = new Set<string>();
      if (sheet) {
        for (const id of sheet.entityOrder) {
          const e = sheet.entities[id];
          if (!e || e.visible === false || e.kind !== 'wall') continue;
          const wEnt = e as WallEntity;
          const sig = [
            JSON.stringify(wEnt.points),
            String(wEnt.thickness ?? ''),
            String(wEnt.height ?? ''),
            String(H),
            contRunSig,
          ].join('|');
          let entry = wallMap.get(id);
          if (!entry || entry.sig !== sig) {
            if (entry) {
              wallsGroup.remove(entry.group);
              disposeObject(entry.group);
            }
            const grp = buildWallGroup(wEnt, H, mats, containmentRuns);
            if (!grp) continue;
            wallsGroup.add(grp);
            entry = { group: grp, sig };
            wallMap.set(id, entry);
          }
          seenWalls.add(id);
        }
      }
      for (const [id, entry] of wallMap) {
        if (seenWalls.has(id)) continue;
        wallsGroup.remove(entry.group);
        disposeObject(entry.group);
        wallMap.delete(id);
      }

      const seenRooms = new Set<string>();
      if (sheet) {
        for (const id of sheet.entityOrder) {
          const e = sheet.entities[id];
          if (!e || e.visible === false || e.kind !== 'room') continue;
          const rEnt = e as RoomEntity;
          const sig = [
            JSON.stringify(rEnt.a),
            JSON.stringify(rEnt.b),
            String(rEnt.floorColor ?? ''),
            String(H),
          ].join('|');
          let entry = roomMap.get(id);
          if (!entry || entry.sig !== sig) {
            if (entry) {
              roomsGroup.remove(entry.group);
              disposeObject(entry.group);
            }
            const grp = buildRoomGroup(rEnt, H, mats);
            if (!grp) continue;
            roomsGroup.add(grp);
            entry = { group: grp, sig };
            roomMap.set(id, entry);
          }
          seenRooms.add(id);
        }
      }
      for (const [id, entry] of roomMap) {
        if (seenRooms.has(id)) continue;
        roomsGroup.remove(entry.group);
        disposeObject(entry.group);
        roomMap.delete(id);
      }
    } else {
      // Panel mode: tear down any leftover wall/room meshes so a sheet
      // switch doesn't leave architectural geometry next to the enclosure.
      for (const [, entry] of wallMap) {
        wallsGroup.remove(entry.group);
        disposeObject(entry.group);
      }
      wallMap.clear();
      for (const [, entry] of roomMap) {
        roomsGroup.remove(entry.group);
        disposeObject(entry.group);
      }
      roomMap.clear();
    }

    sizeRef.current = { w: W, h: H };
    applyDoorMode(enclosureRef.current, doorMode);

    // Only reframe the camera when the panel sheet itself changes (or its
    // size or scene style changes). Don't snap the camera back on every
    // entity edit.
    const frameSig = `${sheet?.id ?? ''}|${enclSig}`;
    if (frameSig !== lastFrameSigRef.current) {
      applyViewPreset(viewPreset, W, H, camera, orbit.state, sceneStyle);
      lastFrameSigRef.current = frameSig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // ---- React to door-mode prop without rebuilding the scene ------------
  useEffect(() => {
    applyDoorMode(contentRootRef.current, doorMode);
  }, [doorMode]);

  // ---- React to view-preset requests (bumped via viewKey) --------------
  useEffect(() => {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) return;
    const { w, h } = sizeRef.current;
    applyViewPreset(viewPreset, w, h, camera, orbit.state, lastSceneStyleRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const style: React.CSSProperties = {
    width: width ? `${width}px` : '100%',
    height: height ? `${height}px` : '100%',
    minHeight: 200,
    background: 'linear-gradient(180deg, #2a313a 0%, #0d1015 100%)',
    overflow: 'hidden',
    position: 'relative',
    userSelect: 'none',
    cursor: 'grab',
  };

  return <div ref={mountRef} style={style} />;
}

export default Panel3D;
