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

  // Door (open at an angle) — barely visible behind, just for context
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(H * 0.95, H + frameThick * 1.6, 4),
    new THREE.MeshStandardMaterial({
      color: 0xa8acb2,
      metalness: 0.7,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })
  );
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
function buildWires(
  scene: THREE.Object3D,
  wires: WireEntity[],
  H: number
): THREE.Group {
  const root = new THREE.Group();

  // Wire color by type
  const colorOf = (t?: string): number => {
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
  };

  for (const w of wires) {
    if (!w.points || w.points.length < 2) continue;
    const color = w.color
      ? new THREE.Color(w.color).getHex()
      : colorOf(w.wireType);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.05,
      roughness: 0.5,
    });
    // Build a path with a bit of z-variation so wires sit in ducts
    const pts: THREE.Vector3[] = w.points.map(
      (p, i) =>
        new THREE.Vector3(
          p.x,
          // y in CAD is screen-down typically; flip so panel y matches three.js up
          H - p.y,
          // raise wires off panel surface so they sit "in" the ducts at ~25mm
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
    root.add(mesh);
  }

  scene.add(root);
  return root;
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
    minDistance: 100,
    maxDistance: 5000,
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
    const factor = Math.exp(e.deltaY * 0.001);
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

// ---------- Main component ---------------------------------------------------
export interface Panel3DProps {
  project: Project;
  width?: number;
  height?: number;
}

export function Panel3D({
  project,
  width,
  height,
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
  const resizeObsRef = useRef<ResizeObserver | null>(null);

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

    // Camera — positioned later when project is known
    const camera = new THREE.PerspectiveCamera(
      45,
      initialW / initialH,
      1,
      10000
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

    // Floor (large dark plane for context)
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

  // ---- Rebuild content when project changes ----------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const mats = materialsRef.current;
    if (!scene || !camera || !orbit || !mats) return;

    // Remove old content
    if (contentRootRef.current) {
      scene.remove(contentRootRef.current);
      disposeObject(contentRootRef.current);
      contentRootRef.current = null;
    }

    const root = new THREE.Group();
    contentRootRef.current = root;
    scene.add(root);

    const { sheet, isPanel } = pickSheetForViewer(project);
    const W = sheet?.width || 600;
    const H = sheet?.height || 400;

    // Build enclosure (always)
    buildEnclosure(root, mats, W, H);

    // Iterate symbol entities and place 3D components
    if (sheet) {
      for (const id of sheet.entityOrder) {
        const e: Entity | undefined = sheet.entities[id];
        if (!e) continue;
        if (e.visible === false) continue;
        if (e.kind !== 'symbol') continue;
        const sym = e as SymbolEntity;
        const cat = categoryFor(sym);

        let g: THREE.Group;
        if (!isPanel) {
          g = buildWireframePlaceholder(mats);
        } else {
          g = buildComponentForCategory(cat, mats, sym);
        }
        // Position: CAD y is screen-down; we flip to make y go up.
        g.position.set(sym.position.x, H - sym.position.y, 0);
        if (sym.rotation) g.rotation.z = sym.rotation;
        if (sym.scale && sym.scale !== 1) g.scale.setScalar(sym.scale);
        if (sym.mirror) g.scale.x *= -1;
        root.add(g);
      }

      // Build wires (only meaningful in panel mode)
      if (isPanel) {
        const wires: WireEntity[] = [];
        for (const id of sheet.entityOrder) {
          const e = sheet.entities[id];
          if (e && e.kind === 'wire' && e.visible !== false) {
            wires.push(e as WireEntity);
          }
        }
        if (wires.length > 0) buildWires(root, wires, H);
      }
    }

    // Reposition camera for a 3/4 view on the panel
    const targetX = W / 2;
    const targetY = H / 2;
    const targetZ = 50;
    orbit.state.target.set(targetX, targetY, targetZ);
    // Compute a 3/4 view roughly at (W*0.7, H*0.7, 600) relative to back panel
    const camPos = new THREE.Vector3(W * 1.0, H * 1.1, Math.max(W, H) * 1.2);
    camera.position.copy(camPos);
    const offset = new THREE.Vector3().subVectors(
      camera.position,
      orbit.state.target
    );
    orbit.state.distance = offset.length();
    orbit.state.polar = Math.acos(
      Math.max(-1, Math.min(1, offset.y / orbit.state.distance))
    );
    orbit.state.azimuth = Math.atan2(offset.x, offset.z);
    orbit.state.apply(camera);
  }, [project]);

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
