import type { SymbolDef, SymbolCategory, SymbolPrimitive, SymbolPin, Vec2 } from '../types';

// IEEE/JIC-style schematic symbols. Coordinates in mm, Y-up.
// Pin spacing on 5mm grid for clean snapping.

const def = (s: SymbolDef): SymbolDef => s;
const v = (x: number, y: number): Vec2 => ({ x, y });

// ---------- POWER SOURCES ----------
const acSource = def({
  id: 'src-ac',
  name: 'AC Source',
  category: 'power-source',
  description: 'Alternating current source',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: '+', name: '+', position: v(0, 10), type: 'power' },
    { id: '-', name: '-', position: v(0, -10), type: 'power' },
  ],
  primitives: [
    { kind: 'circle', c: v(0, 0), r: 8 },
    { kind: 'line', a: v(0, 8), b: v(0, 10) },
    { kind: 'line', a: v(0, -8), b: v(0, -10) },
    { kind: 'polyline', points: [v(-4, 0), v(-2, 3), v(2, -3), v(4, 0)] },
  ],
  tagPrefix: 'V',
  standard: 'IEEE',
});

const dcSource = def({
  id: 'src-dc',
  name: 'DC Source',
  category: 'power-source',
  description: 'Direct current source',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: '+', name: '+', position: v(0, 10), type: 'power' },
    { id: '-', name: '-', position: v(0, -10), type: 'power' },
  ],
  primitives: [
    { kind: 'circle', c: v(0, 0), r: 8 },
    { kind: 'line', a: v(0, 8), b: v(0, 10) },
    { kind: 'line', a: v(0, -8), b: v(0, -10) },
    { kind: 'line', a: v(-4, 1), b: v(4, 1) },
    { kind: 'line', a: v(-3, -2), b: v(-1, -2) },
    { kind: 'line', a: v(1, -2), b: v(3, -2) },
  ],
  tagPrefix: 'V',
  standard: 'IEEE',
});

const battery = def({
  id: 'battery',
  name: 'Battery',
  category: 'power-source',
  description: 'Battery / DC cell',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 10 },
  pins: [
    { id: '+', name: '+', position: v(0, 10), type: 'power' },
    { id: '-', name: '-', position: v(0, -10), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 5) },
    { kind: 'line', a: v(-6, 5), b: v(6, 5) },
    { kind: 'line', a: v(-3, 2), b: v(3, 2) },
    { kind: 'line', a: v(-6, -1), b: v(6, -1) },
    { kind: 'line', a: v(-3, -4), b: v(3, -4) },
    { kind: 'line', a: v(0, -4), b: v(0, -10) },
    { kind: 'text', p: v(8, 5), text: '+', size: 3, align: 'left' },
    { kind: 'text', p: v(8, -4), text: '-', size: 3, align: 'left' },
  ],
  tagPrefix: 'BT',
  standard: 'IEEE',
});

const generator = def({
  id: 'generator',
  name: 'Generator',
  category: 'power-source',
  description: 'Electrical generator',
  bounds: { minX: -10, minY: -12, maxX: 10, maxY: 12 },
  pins: [
    { id: '1', name: '1', position: v(-5, 12), type: 'power' },
    { id: '2', name: '2', position: v(0, 12), type: 'power' },
    { id: '3', name: '3', position: v(5, 12), type: 'power' },
  ],
  primitives: [
    { kind: 'circle', c: v(0, 0), r: 9 },
    { kind: 'line', a: v(-5, 12), b: v(-5, 8) },
    { kind: 'line', a: v(0, 12), b: v(0, 9) },
    { kind: 'line', a: v(5, 12), b: v(5, 8) },
    { kind: 'text', p: v(0, 0), text: 'G', size: 6, align: 'center' },
  ],
  tagPrefix: 'G',
  standard: 'IEEE',
});

// ---------- GROUND ----------
const earthGround = def({
  id: 'gnd-earth',
  name: 'Earth Ground',
  category: 'ground',
  description: 'Earth/protective ground (PE)',
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  pins: [{ id: '1', name: '1', position: v(0, 5), type: 'ground' }],
  primitives: [
    { kind: 'line', a: v(0, 5), b: v(0, 0) },
    { kind: 'line', a: v(-5, 0), b: v(5, 0) },
    { kind: 'line', a: v(-3, -2), b: v(3, -2) },
    { kind: 'line', a: v(-1.5, -4), b: v(1.5, -4) },
  ],
  tagPrefix: 'GND',
  standard: 'IEEE',
});

const chassisGround = def({
  id: 'gnd-chassis',
  name: 'Chassis Ground',
  category: 'ground',
  description: 'Chassis ground',
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  pins: [{ id: '1', name: '1', position: v(0, 5), type: 'ground' }],
  primitives: [
    { kind: 'line', a: v(0, 5), b: v(0, 0) },
    { kind: 'line', a: v(-5, 0), b: v(5, 0) },
    { kind: 'line', a: v(-5, 0), b: v(-3, -3) },
    { kind: 'line', a: v(-2, 0), b: v(0, -3) },
    { kind: 'line', a: v(1, 0), b: v(3, -3) },
  ],
  tagPrefix: 'GND',
  standard: 'IEEE',
});

const signalGround = def({
  id: 'gnd-signal',
  name: 'Signal Ground',
  category: 'ground',
  description: 'Signal/reference ground',
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  pins: [{ id: '1', name: '1', position: v(0, 5), type: 'ground' }],
  primitives: [
    { kind: 'line', a: v(0, 5), b: v(0, 0) },
    { kind: 'polyline', points: [v(-5, 0), v(0, -5), v(5, 0)], closed: true },
  ],
  tagPrefix: 'GND',
  standard: 'IEEE',
});

// ---------- SWITCHES ----------
const switchSPST = def({
  id: 'sw-spst',
  name: 'SPST Switch',
  category: 'switch',
  description: 'Single-pole single-throw switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 8 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
  ],
  tagPrefix: 'S',
  standard: 'IEEE',
});

const switchSPDT = def({
  id: 'sw-spdt',
  name: 'SPDT Switch',
  category: 'switch',
  description: 'Single-pole double-throw',
  bounds: { minX: -10, minY: -8, maxX: 10, maxY: 8 },
  pins: [
    { id: 'C', name: 'C', position: v(-10, 0) },
    { id: 'NO', name: 'NO', position: v(10, 6) },
    { id: 'NC', name: 'NC', position: v(10, -6) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 6), b: v(10, 6) },
    { kind: 'line', a: v(4, -6), b: v(10, -6) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 6), r: 0.7 },
    { kind: 'circle', c: v(4, -6), r: 0.7 },
  ],
  tagPrefix: 'S',
  standard: 'IEEE',
});

const switchDPDT = def({
  id: 'sw-dpdt',
  name: 'DPDT Switch',
  category: 'switch',
  description: 'Double-pole double-throw',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: 'C1', name: 'C1', position: v(-10, 4) },
    { id: 'NO1', name: 'NO1', position: v(10, 8) },
    { id: 'NC1', name: 'NC1', position: v(10, 0) },
    { id: 'C2', name: 'C2', position: v(-10, -6) },
    { id: 'NO2', name: 'NO2', position: v(10, -2) },
    { id: 'NC2', name: 'NC2', position: v(10, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 4), b: v(-4, 4) },
    { kind: 'line', a: v(-4, 4), b: v(4, 8) },
    { kind: 'line', a: v(4, 8), b: v(10, 8) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'line', a: v(-10, -6), b: v(-4, -6) },
    { kind: 'line', a: v(-4, -6), b: v(4, -2) },
    { kind: 'line', a: v(4, -2), b: v(10, -2) },
    { kind: 'line', a: v(4, -10), b: v(10, -10) },
    { kind: 'line', a: v(-4, 4), b: v(-4, -6), lineWidth: 0.2 },
  ],
  tagPrefix: 'S',
  standard: 'IEEE',
});

const limitSwitchNO = def({
  id: 'sw-limit-no',
  name: 'Limit Switch NO',
  category: 'switch',
  description: 'Normally open limit switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 8) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
  ],
  tagPrefix: 'LS',
  standard: 'IEEE',
});

const limitSwitchNC = def({
  id: 'sw-limit-nc',
  name: 'Limit Switch NC',
  category: 'switch',
  description: 'Normally closed limit switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 8), b: v(4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(-4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
  ],
  tagPrefix: 'LS',
  standard: 'IEEE',
});

const pressureSwitch = def({
  id: 'sw-pressure',
  name: 'Pressure Switch',
  category: 'switch',
  description: 'Pressure-actuated switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'arc', c: v(0, 9), r: 1.5, start: 0, end: Math.PI },
    { kind: 'line', a: v(-1.5, 9), b: v(0, 6) },
    { kind: 'line', a: v(1.5, 9), b: v(0, 6) },
  ],
  tagPrefix: 'PS',
  standard: 'IEEE',
});

const tempSwitch = def({
  id: 'sw-temp',
  name: 'Temperature Switch',
  category: 'switch',
  description: 'Temperature-actuated switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'text', p: v(0, 9), text: 'T°', size: 3, align: 'center' },
  ],
  tagPrefix: 'TS',
  standard: 'IEEE',
});

const flowSwitch = def({
  id: 'sw-flow',
  name: 'Flow Switch',
  category: 'switch',
  description: 'Flow-actuated switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'polyline', points: [v(-2, 9), v(0, 6), v(2, 9)] },
  ],
  tagPrefix: 'FS',
  standard: 'IEEE',
});

const levelSwitch = def({
  id: 'sw-level',
  name: 'Level Switch',
  category: 'switch',
  description: 'Liquid level switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'circle', c: v(0, 9), r: 1.6 },
  ],
  tagPrefix: 'LS',
  standard: 'IEEE',
});

const disconnectSwitch = def({
  id: 'sw-disconnect',
  name: 'Disconnect Switch',
  category: 'switch',
  description: '3-pole disconnect switch',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 14 },
  pins: [
    { id: '1L1', name: '1', position: v(-6, 14) },
    { id: '2L2', name: '2', position: v(0, 14) },
    { id: '3L3', name: '3', position: v(6, 14) },
    { id: '1T1', name: '4', position: v(-6, -10) },
    { id: '2T2', name: '6', position: v(0, -10) },
    { id: '3T3', name: '6', position: v(6, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 14), b: v(-6, 8) },
    { kind: 'line', a: v(0, 14), b: v(0, 8) },
    { kind: 'line', a: v(6, 14), b: v(6, 8) },
    { kind: 'line', a: v(-6, 8), b: v(-2, -2) },
    { kind: 'line', a: v(0, 8), b: v(4, -2) },
    { kind: 'line', a: v(6, 8), b: v(10, -2) },
    { kind: 'line', a: v(-6, -4), b: v(-6, -10) },
    { kind: 'line', a: v(0, -4), b: v(0, -10) },
    { kind: 'line', a: v(6, -4), b: v(6, -10) },
    { kind: 'circle', c: v(-6, 8), r: 0.7 },
    { kind: 'circle', c: v(0, 8), r: 0.7 },
    { kind: 'circle', c: v(6, 8), r: 0.7 },
    { kind: 'circle', c: v(-6, -4), r: 0.7 },
    { kind: 'circle', c: v(0, -4), r: 0.7 },
    { kind: 'circle', c: v(6, -4), r: 0.7 },
    { kind: 'line', a: v(-6, 8), b: v(6, 8), lineWidth: 0.2 },
  ],
  tagPrefix: 'Q',
  standard: 'IEEE',
});

const selectorSwitch = def({
  id: 'sw-selector',
  name: 'Selector Switch',
  category: 'switch',
  description: '2-position selector switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'line', a: v(-2, 9), b: v(2, 9) },
    { kind: 'circle', c: v(0, 9), r: 0.5 },
  ],
  tagPrefix: 'SS',
  standard: 'IEEE',
});

const footSwitch = def({
  id: 'sw-foot',
  name: 'Foot Switch',
  category: 'switch',
  description: 'Foot-operated switch',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'rect', a: v(-2.5, 8), b: v(2.5, 9.5) },
    { kind: 'line', a: v(0, 8), b: v(0, 6) },
  ],
  tagPrefix: 'FS',
  standard: 'IEEE',
});

// ---------- PUSHBUTTONS ----------
const pbNO = def({
  id: 'pb-no',
  name: 'PB NO',
  category: 'pushbutton',
  description: 'Pushbutton normally open',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(-6, 0), b: v(6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-6, 0), r: 0.7 },
    { kind: 'circle', c: v(6, 0), r: 0.7 },
    { kind: 'line', a: v(-3, 0), b: v(3, 0), lineWidth: 0 },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
    { kind: 'line', a: v(-3, 4), b: v(3, 4) },
    // disconnect bridge raised when not pressed
    { kind: 'line', a: v(-3, 1.5), b: v(3, 1.5) },
  ],
  tagPrefix: 'PB',
  standard: 'IEEE',
});

const pbNC = def({
  id: 'pb-nc',
  name: 'PB NC',
  category: 'pushbutton',
  description: 'Pushbutton normally closed',
  bounds: { minX: -10, minY: -5, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-6, 0), r: 0.7 },
    { kind: 'circle', c: v(6, 0), r: 0.7 },
    { kind: 'line', a: v(-3, -2), b: v(3, -2) },
    { kind: 'line', a: v(0, -2), b: v(0, 4) },
    { kind: 'line', a: v(-3, 4), b: v(3, 4) },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
  ],
  tagPrefix: 'PB',
  standard: 'IEEE',
});

const eStop = def({
  id: 'pb-estop',
  name: 'E-Stop',
  category: 'pushbutton',
  description: 'Emergency stop pushbutton',
  bounds: { minX: -10, minY: -8, maxX: 10, maxY: 8 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-6, 0), r: 0.7 },
    { kind: 'circle', c: v(6, 0), r: 0.7 },
    { kind: 'line', a: v(-3, -2), b: v(3, -2) },
    { kind: 'line', a: v(0, -2), b: v(0, 4) },
    { kind: 'circle', c: v(0, 5), r: 3 },
    { kind: 'text', p: v(0, 5), text: '!', size: 4, align: 'center' },
  ],
  tagPrefix: 'ES',
  standard: 'IEEE',
});

const pbIlluminated = def({
  id: 'pb-illuminated',
  name: 'PB Illuminated',
  category: 'pushbutton',
  description: 'Illuminated pushbutton',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-6, 0), r: 0.7 },
    { kind: 'circle', c: v(6, 0), r: 0.7 },
    { kind: 'line', a: v(-3, 1.5), b: v(3, 1.5) },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
    { kind: 'line', a: v(-3, 4), b: v(3, 4) },
    { kind: 'circle', c: v(0, 8.5), r: 1.6 },
    { kind: 'line', a: v(-1.1, 7.5), b: v(1.1, 9.5) },
    { kind: 'line', a: v(1.1, 7.5), b: v(-1.1, 9.5) },
  ],
  tagPrefix: 'PB',
  standard: 'IEEE',
});

const keyOpPB = def({
  id: 'pb-key',
  name: 'Key PB',
  category: 'pushbutton',
  description: 'Key-operated pushbutton',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 12 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-6, 0), r: 0.7 },
    { kind: 'circle', c: v(6, 0), r: 0.7 },
    { kind: 'line', a: v(-3, 1.5), b: v(3, 1.5) },
    { kind: 'line', a: v(0, 4), b: v(0, 8) },
    { kind: 'line', a: v(-3, 4), b: v(3, 4) },
    { kind: 'circle', c: v(0, 10), r: 1.5 },
    { kind: 'line', a: v(0, 8.5), b: v(0, 11.5) },
  ],
  tagPrefix: 'PB',
  standard: 'IEEE',
});

// ---------- CONTACTOR / RELAY ----------
const contactorCoil = def({
  id: 'coil',
  name: 'Coil',
  category: 'contactor-relay',
  description: 'Contactor or relay coil',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'A1', name: 'A1', position: v(-10, 0) },
    { id: 'A2', name: 'A2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'rect', a: v(-6, -3), b: v(6, 3) },
    { kind: 'line', a: v(-3, -3), b: v(-3, 3) },
    { kind: 'line', a: v(3, -3), b: v(3, 3) },
    { kind: 'text', p: v(-9, 4), text: 'A1', size: 1.8, align: 'left' },
    { kind: 'text', p: v(9, 4), text: 'A2', size: 1.8, align: 'right' },
  ],
  tagPrefix: 'K',
  standard: 'IEEE',
});

const coilTimerOn = def({
  id: 'coil-tdon',
  name: 'TDR On-Delay',
  category: 'contactor-relay',
  description: 'Time-delay-on relay coil',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'A1', name: 'A1', position: v(-10, 0) },
    { id: 'A2', name: 'A2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'rect', a: v(-6, -3), b: v(6, 3) },
    { kind: 'text', p: v(0, 0), text: 'TDR', size: 2.6, align: 'center' },
    { kind: 'text', p: v(-9, 4), text: 'A1', size: 1.8, align: 'left' },
  ],
  tagPrefix: 'TR',
  standard: 'IEEE',
});

const coilTimerOff = def({
  id: 'coil-tdoff',
  name: 'TDR Off-Delay',
  category: 'contactor-relay',
  description: 'Time-delay-off relay coil',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'A1', name: 'A1', position: v(-10, 0) },
    { id: 'A2', name: 'A2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'rect', a: v(-6, -3), b: v(6, 3) },
    { kind: 'text', p: v(0, 0), text: 'TOF', size: 2.6, align: 'center' },
  ],
  tagPrefix: 'TR',
  standard: 'IEEE',
});

const contactNO = def({
  id: 'contact-no',
  name: 'NO Contact',
  category: 'contactor-relay',
  description: 'Normally open contact',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 8 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
  ],
  tagPrefix: 'K',
  standard: 'IEEE',
});

const contactNC = def({
  id: 'contact-nc',
  name: 'NC Contact',
  category: 'contactor-relay',
  description: 'Normally closed contact',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 7 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 6), b: v(4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(-4, 5) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
  ],
  tagPrefix: 'K',
  standard: 'IEEE',
});

const contactNOTOn = def({
  id: 'contact-no-tdon',
  name: 'NO TDR On',
  category: 'contactor-relay',
  description: 'NO contact, time-delay on energize',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 9 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'arc', c: v(0, 8), r: 2.2, start: 0, end: Math.PI },
  ],
  tagPrefix: 'TR',
  standard: 'IEEE',
});

const contactNOTOff = def({
  id: 'contact-no-tdoff',
  name: 'NO TDR Off',
  category: 'contactor-relay',
  description: 'NO contact, time-delay on de-energize',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 9 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(4, 6) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'arc', c: v(0, 6), r: 2.2, start: Math.PI, end: 2 * Math.PI },
  ],
  tagPrefix: 'TR',
  standard: 'IEEE',
});

const overloadRelay = def({
  id: 'overload-coil',
  name: 'Overload Heater',
  category: 'contactor-relay',
  description: 'Overload relay heating element',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'rect', a: v(-6, -3), b: v(6, 3) },
    { kind: 'polyline', points: [v(-4, 0), v(-2, 2), v(0, -2), v(2, 2), v(4, 0)] },
  ],
  tagPrefix: 'OL',
  standard: 'IEEE',
});

const overloadContact = def({
  id: 'overload-contact',
  name: 'Overload Contact',
  category: 'contactor-relay',
  description: 'Overload relay NC reset contact',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 8 },
  pins: [
    { id: '95', name: '95', position: v(-10, 0) },
    { id: '96', name: '96', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-4, 0) },
    { kind: 'line', a: v(-4, 6), b: v(4, 0) },
    { kind: 'line', a: v(-4, 0), b: v(-4, 5) },
    { kind: 'line', a: v(4, 0), b: v(10, 0) },
    { kind: 'circle', c: v(-4, 0), r: 0.7 },
    { kind: 'circle', c: v(4, 0), r: 0.7 },
    { kind: 'rect', a: v(-1.5, -2), b: v(1.5, 2), lineWidth: 0.2 },
  ],
  tagPrefix: 'OL',
  standard: 'IEEE',
});

const ssr = def({
  id: 'ssr',
  name: 'Solid State Relay',
  category: 'contactor-relay',
  description: 'Solid-state relay',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: '1', name: '+', position: v(-10, 6) },
    { id: '2', name: '-', position: v(-10, -6) },
    { id: '3', name: 'L', position: v(10, 6) },
    { id: '4', name: 'T', position: v(10, -6) },
  ],
  primitives: [
    { kind: 'rect', a: v(-7, -8), b: v(7, 8) },
    { kind: 'line', a: v(-10, 6), b: v(-7, 6) },
    { kind: 'line', a: v(-10, -6), b: v(-7, -6) },
    { kind: 'line', a: v(7, 6), b: v(10, 6) },
    { kind: 'line', a: v(7, -6), b: v(10, -6) },
    { kind: 'text', p: v(0, 1), text: 'SSR', size: 3, align: 'center' },
  ],
  tagPrefix: 'SSR',
  standard: 'IEEE',
});

// ---------- MOTORS ----------
const motor3ph = def({
  id: 'motor-3ph',
  name: '3-Phase Motor',
  category: 'motor',
  description: 'Three-phase induction motor',
  bounds: { minX: -12, minY: -16, maxX: 12, maxY: 14 },
  pins: [
    { id: 'L1', name: 'L1', position: v(-8, 14), type: 'power' },
    { id: 'L2', name: 'L2', position: v(0, 14), type: 'power' },
    { id: 'L3', name: 'L3', position: v(8, 14), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(-8, 14), b: v(-8, 9) },
    { kind: 'line', a: v(0, 14), b: v(0, 10) },
    { kind: 'line', a: v(8, 14), b: v(8, 9) },
    { kind: 'circle', c: v(0, 0), r: 10 },
    { kind: 'text', p: v(0, 1), text: 'M', size: 7, align: 'center' },
    { kind: 'text', p: v(0, -5), text: '3~', size: 3, align: 'center' },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

const motor1ph = def({
  id: 'motor-1ph',
  name: '1-Phase Motor',
  category: 'motor',
  description: 'Single-phase motor',
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 14 },
  pins: [
    { id: 'L', name: 'L', position: v(-5, 14), type: 'power' },
    { id: 'N', name: 'N', position: v(5, 14), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(-5, 14), b: v(-5, 9) },
    { kind: 'line', a: v(5, 14), b: v(5, 9) },
    { kind: 'circle', c: v(0, 0), r: 10 },
    { kind: 'text', p: v(0, 1), text: 'M', size: 7, align: 'center' },
    { kind: 'text', p: v(0, -5), text: '1~', size: 3, align: 'center' },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

const motorDC = def({
  id: 'motor-dc',
  name: 'DC Motor',
  category: 'motor',
  description: 'DC motor',
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 14 },
  pins: [
    { id: '+', name: '+', position: v(-5, 14), type: 'power' },
    { id: '-', name: '-', position: v(5, 14), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(-5, 14), b: v(-5, 9) },
    { kind: 'line', a: v(5, 14), b: v(5, 9) },
    { kind: 'circle', c: v(0, 0), r: 10 },
    { kind: 'text', p: v(0, 1), text: 'M', size: 7, align: 'center' },
    { kind: 'line', a: v(-3, -5), b: v(3, -5) },
    { kind: 'line', a: v(-1.5, -7), b: v(1.5, -7) },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

const motorServo = def({
  id: 'motor-servo',
  name: 'Servo Motor',
  category: 'motor',
  description: 'Servo motor',
  bounds: { minX: -12, minY: -16, maxX: 12, maxY: 14 },
  pins: [
    { id: 'U', name: 'U', position: v(-8, 14), type: 'power' },
    { id: 'V', name: 'V', position: v(0, 14), type: 'power' },
    { id: 'W', name: 'W', position: v(8, 14), type: 'power' },
    { id: 'E', name: 'E', position: v(0, -14), type: 'output' },
  ],
  primitives: [
    { kind: 'line', a: v(-8, 14), b: v(-8, 9) },
    { kind: 'line', a: v(0, 14), b: v(0, 10) },
    { kind: 'line', a: v(8, 14), b: v(8, 9) },
    { kind: 'circle', c: v(0, 0), r: 10 },
    { kind: 'text', p: v(0, 1), text: 'SM', size: 5, align: 'center' },
    { kind: 'line', a: v(0, -10), b: v(0, -14) },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

const motorStepper = def({
  id: 'motor-stepper',
  name: 'Stepper Motor',
  category: 'motor',
  description: 'Stepper motor',
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 14 },
  pins: [
    { id: 'A+', name: 'A+', position: v(-8, 14) },
    { id: 'A-', name: 'A-', position: v(-3, 14) },
    { id: 'B+', name: 'B+', position: v(3, 14) },
    { id: 'B-', name: 'B-', position: v(8, 14) },
  ],
  primitives: [
    { kind: 'line', a: v(-8, 14), b: v(-8, 9) },
    { kind: 'line', a: v(-3, 14), b: v(-3, 9) },
    { kind: 'line', a: v(3, 14), b: v(3, 9) },
    { kind: 'line', a: v(8, 14), b: v(8, 9) },
    { kind: 'circle', c: v(0, 0), r: 10 },
    { kind: 'text', p: v(0, 1), text: 'M', size: 6, align: 'center' },
    { kind: 'text', p: v(0, -5), text: 'STP', size: 2.5, align: 'center' },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

// ---------- TRANSFORMERS ----------
const transformer = def({
  id: 'transformer',
  name: 'Transformer',
  category: 'transformer',
  description: 'Two-winding transformer',
  bounds: { minX: -8, minY: -14, maxX: 8, maxY: 14 },
  pins: [
    { id: 'H1', name: 'H1', position: v(-5, 14) },
    { id: 'H2', name: 'H2', position: v(5, 14) },
    { id: 'X1', name: 'X1', position: v(-5, -14) },
    { id: 'X2', name: 'X2', position: v(5, -14) },
  ],
  primitives: [
    { kind: 'line', a: v(-5, 14), b: v(-5, 8) },
    { kind: 'line', a: v(5, 14), b: v(5, 8) },
    { kind: 'line', a: v(-5, -14), b: v(-5, -8) },
    { kind: 'line', a: v(5, -14), b: v(5, -8) },
    { kind: 'arc', c: v(-5, 5.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-5, 2.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(5, 5.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(5, 2.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(-5, -2.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-5, -5.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(5, -2.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(5, -5.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'line', a: v(0, 9), b: v(0, -9), lineWidth: 0.3 },
  ],
  tagPrefix: 'T',
  standard: 'IEEE',
});

const ctTransformer = def({
  id: 'transformer-ct',
  name: 'Current Transformer',
  category: 'transformer',
  description: 'Current transformer',
  bounds: { minX: -8, minY: -8, maxX: 8, maxY: 12 },
  pins: [
    { id: 'P1', name: 'P1', position: v(-8, 0) },
    { id: 'P2', name: 'P2', position: v(8, 0) },
    { id: 'S1', name: 'S1', position: v(-3, 12) },
    { id: 'S2', name: 'S2', position: v(3, 12) },
  ],
  primitives: [
    { kind: 'line', a: v(-8, 0), b: v(8, 0) },
    { kind: 'circle', c: v(0, 0), r: 4 },
    { kind: 'line', a: v(-3, 12), b: v(-3, 5) },
    { kind: 'line', a: v(3, 12), b: v(3, 5) },
  ],
  tagPrefix: 'CT',
  standard: 'IEEE',
});

const controlTransformer = def({
  id: 'transformer-control',
  name: 'Control Xfmr',
  category: 'transformer',
  description: 'Control transformer with fused secondary',
  bounds: { minX: -10, minY: -14, maxX: 10, maxY: 14 },
  pins: [
    { id: 'H1', name: 'H1', position: v(-5, 14) },
    { id: 'H4', name: 'H4', position: v(5, 14) },
    { id: 'X1', name: 'X1', position: v(-5, -14) },
    { id: 'X2', name: 'X2', position: v(5, -14) },
  ],
  primitives: [
    { kind: 'line', a: v(-5, 14), b: v(-5, 8) },
    { kind: 'line', a: v(5, 14), b: v(5, 8) },
    { kind: 'line', a: v(-5, -14), b: v(-5, -8) },
    { kind: 'line', a: v(5, -14), b: v(5, -8) },
    { kind: 'arc', c: v(-5, 5.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-5, 2.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(5, 5.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(5, 2.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(-5, -2.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-5, -5.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(5, -2.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'arc', c: v(5, -5.5), r: 1.5, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'line', a: v(0, 9), b: v(0, -9), lineWidth: 0.3 },
    { kind: 'text', p: v(8, 8), text: 'CPT', size: 2.4, align: 'left' },
  ],
  tagPrefix: 'CPT',
  standard: 'IEEE',
});

const autoTransformer = def({
  id: 'transformer-auto',
  name: 'Auto-Transformer',
  category: 'transformer',
  description: 'Auto-transformer',
  bounds: { minX: -6, minY: -12, maxX: 6, maxY: 12 },
  pins: [
    { id: 'H1', name: 'H1', position: v(0, 12) },
    { id: 'X1', name: 'X1', position: v(6, 0) },
    { id: 'H2', name: 'H2', position: v(0, -12) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 12), b: v(0, 8) },
    { kind: 'line', a: v(0, -12), b: v(0, -8) },
    { kind: 'arc', c: v(-1.5, 5.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-1.5, 2.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-1.5, -0.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-1.5, -3.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'arc', c: v(-1.5, -6.5), r: 1.5, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'line', a: v(0, 0), b: v(6, 0) },
    { kind: 'circle', c: v(0, 0), r: 0.6 },
  ],
  tagPrefix: 'T',
  standard: 'IEEE',
});

// ---------- FUSE / BREAKER ----------
const fuse = def({
  id: 'fuse',
  name: 'Fuse',
  category: 'fuse-breaker',
  description: 'Fuse',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 3 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-5, 0) },
    { kind: 'rect', a: v(-5, -2), b: v(5, 2) },
    { kind: 'line', a: v(5, 0), b: v(10, 0) },
  ],
  tagPrefix: 'F',
  standard: 'IEEE',
});

const breaker1P = def({
  id: 'breaker-1p',
  name: '1P Breaker',
  category: 'fuse-breaker',
  description: 'Single-pole circuit breaker',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 10 },
  pins: [
    { id: '1', name: '1', position: v(0, 10) },
    { id: '2', name: '2', position: v(0, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 6) },
    { kind: 'line', a: v(0, 6), b: v(5, -2) },
    { kind: 'line', a: v(0, -6), b: v(0, -10) },
    { kind: 'circle', c: v(0, 6), r: 0.7 },
    { kind: 'circle', c: v(0, -6), r: 0.7 },
    { kind: 'rect', a: v(-3, 3), b: v(3, -3), lineWidth: 0.2 },
  ],
  tagPrefix: 'CB',
  standard: 'IEEE',
});

const breaker2P = def({
  id: 'breaker-2p',
  name: '2P Breaker',
  category: 'fuse-breaker',
  description: 'Two-pole circuit breaker',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 10 },
  pins: [
    { id: '1', name: 'L1', position: v(-4, 10) },
    { id: '2', name: 'L2', position: v(4, 10) },
    { id: '3', name: 'T1', position: v(-4, -10) },
    { id: '4', name: 'T2', position: v(4, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-4, 10), b: v(-4, 6) },
    { kind: 'line', a: v(4, 10), b: v(4, 6) },
    { kind: 'line', a: v(-4, 6), b: v(0, -2) },
    { kind: 'line', a: v(4, 6), b: v(8, -2) },
    { kind: 'line', a: v(-4, -6), b: v(-4, -10) },
    { kind: 'line', a: v(4, -6), b: v(4, -10) },
    { kind: 'circle', c: v(-4, 6), r: 0.7 },
    { kind: 'circle', c: v(4, 6), r: 0.7 },
    { kind: 'circle', c: v(-4, -6), r: 0.7 },
    { kind: 'circle', c: v(4, -6), r: 0.7 },
    { kind: 'line', a: v(-4, 6), b: v(4, 6), lineWidth: 0.2 },
  ],
  tagPrefix: 'CB',
  standard: 'IEEE',
});

const breaker3P = def({
  id: 'breaker-3p',
  name: '3P Breaker',
  category: 'fuse-breaker',
  description: 'Three-pole circuit breaker',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: 'L1', name: 'L1', position: v(-6, 10) },
    { id: 'L2', name: 'L2', position: v(0, 10) },
    { id: 'L3', name: 'L3', position: v(6, 10) },
    { id: 'T1', name: 'T1', position: v(-6, -10) },
    { id: 'T2', name: 'T2', position: v(0, -10) },
    { id: 'T3', name: 'T3', position: v(6, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 10), b: v(-6, 6) },
    { kind: 'line', a: v(0, 10), b: v(0, 6) },
    { kind: 'line', a: v(6, 10), b: v(6, 6) },
    { kind: 'line', a: v(-6, 6), b: v(-2, -2) },
    { kind: 'line', a: v(0, 6), b: v(4, -2) },
    { kind: 'line', a: v(6, 6), b: v(10, -2) },
    { kind: 'line', a: v(-6, -6), b: v(-6, -10) },
    { kind: 'line', a: v(0, -6), b: v(0, -10) },
    { kind: 'line', a: v(6, -6), b: v(6, -10) },
    { kind: 'circle', c: v(-6, 6), r: 0.7 },
    { kind: 'circle', c: v(0, 6), r: 0.7 },
    { kind: 'circle', c: v(6, 6), r: 0.7 },
    { kind: 'circle', c: v(-6, -6), r: 0.7 },
    { kind: 'circle', c: v(0, -6), r: 0.7 },
    { kind: 'circle', c: v(6, -6), r: 0.7 },
    { kind: 'line', a: v(-6, 6), b: v(6, 6), lineWidth: 0.2 },
  ],
  tagPrefix: 'CB',
  standard: 'IEEE',
});

const gfci = def({
  id: 'breaker-gfci',
  name: 'GFCI Breaker',
  category: 'fuse-breaker',
  description: 'Ground-fault circuit interrupter',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 10 },
  pins: [
    { id: 'L', name: 'L', position: v(0, 10) },
    { id: 'T', name: 'T', position: v(0, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 6) },
    { kind: 'line', a: v(0, 6), b: v(5, -2) },
    { kind: 'line', a: v(0, -6), b: v(0, -10) },
    { kind: 'circle', c: v(0, 6), r: 0.7 },
    { kind: 'circle', c: v(0, -6), r: 0.7 },
    { kind: 'rect', a: v(-4, 3), b: v(4, -3), lineWidth: 0.2 },
    { kind: 'text', p: v(0, 0), text: 'GF', size: 2.6, align: 'center' },
  ],
  tagPrefix: 'CB',
  standard: 'IEEE',
});

// ---------- INDICATORS ----------
const pilotLight = (idSuffix: string, color: string, label: string) => def({
  id: `light-${idSuffix}`,
  name: `Pilot Light ${label}`,
  category: 'indicator',
  description: `Pilot indicator (${label})`,
  bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
  pins: [
    { id: '1', name: '1', position: v(-6, 0) },
    { id: '2', name: '2', position: v(6, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 0), b: v(-4, 0) },
    { kind: 'line', a: v(4, 0), b: v(6, 0) },
    { kind: 'circle', c: v(0, 0), r: 4 },
    { kind: 'line', a: v(-2.8, -2.8), b: v(2.8, 2.8) },
    { kind: 'line', a: v(-2.8, 2.8), b: v(2.8, -2.8) },
    { kind: 'text', p: v(0, -7.5), text: label, size: 2.4, align: 'center' },
  ],
  tagPrefix: 'PL',
  standard: 'IEEE',
});

const pilotR = pilotLight('r', '#ff5d5d', 'R');
const pilotG = pilotLight('g', '#6dd17c', 'G');
const pilotA = pilotLight('a', '#ffb347', 'A');
const pilotB = pilotLight('b', '#5cdcff', 'B');
const pilotW = pilotLight('w', '#ffffff', 'W');

const beacon = def({
  id: 'beacon',
  name: 'Beacon',
  category: 'indicator',
  description: 'Rotating beacon / strobe',
  bounds: { minX: -6, minY: -8, maxX: 6, maxY: 8 },
  pins: [
    { id: '1', name: '1', position: v(-6, 0) },
    { id: '2', name: '2', position: v(6, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 0), b: v(-4, 0) },
    { kind: 'line', a: v(4, 0), b: v(6, 0) },
    { kind: 'arc', c: v(0, 0), r: 4, start: 0, end: Math.PI },
    { kind: 'line', a: v(-4, 0), b: v(4, 0) },
    { kind: 'line', a: v(-3, -1), b: v(-5, -3) },
    { kind: 'line', a: v(0, -1), b: v(0, -4) },
    { kind: 'line', a: v(3, -1), b: v(5, -3) },
  ],
  tagPrefix: 'BC',
  standard: 'IEEE',
});

const buzzer = def({
  id: 'buzzer',
  name: 'Buzzer',
  category: 'indicator',
  description: 'Audible buzzer',
  bounds: { minX: -6, minY: -5, maxX: 6, maxY: 5 },
  pins: [
    { id: '1', name: '1', position: v(-6, 0) },
    { id: '2', name: '2', position: v(6, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 0), b: v(-4, 0) },
    { kind: 'line', a: v(4, 0), b: v(6, 0) },
    { kind: 'arc', c: v(0, 0), r: 4, start: -Math.PI / 2, end: Math.PI / 2 },
    { kind: 'line', a: v(0, 4), b: v(-4, 4) },
    { kind: 'line', a: v(0, -4), b: v(-4, -4) },
    { kind: 'line', a: v(-4, -4), b: v(-4, 4) },
  ],
  tagPrefix: 'BZ',
  standard: 'IEEE',
});

const horn = def({
  id: 'horn',
  name: 'Horn',
  category: 'indicator',
  description: 'Audible horn / siren',
  bounds: { minX: -8, minY: -5, maxX: 8, maxY: 5 },
  pins: [
    { id: '1', name: '1', position: v(-8, 0) },
    { id: '2', name: '2', position: v(8, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-8, 0), b: v(-5, 0) },
    { kind: 'line', a: v(5, 0), b: v(8, 0) },
    { kind: 'polyline', points: [v(-5, -3), v(-5, 3), v(5, 5), v(5, -5)], closed: true },
  ],
  tagPrefix: 'HRN',
  standard: 'IEEE',
});

// ---------- TERMINALS ----------
const terminal = def({
  id: 'terminal',
  name: 'Terminal',
  category: 'terminal',
  description: 'Terminal block point',
  bounds: { minX: -3, minY: -8, maxX: 3, maxY: 8 },
  pins: [
    { id: 'L', name: 'L', position: v(0, 8) },
    { id: 'F', name: 'F', position: v(0, -8) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 8), b: v(0, 2) },
    { kind: 'line', a: v(0, -8), b: v(0, -2) },
    { kind: 'circle', c: v(0, 0), r: 2 },
  ],
  tagPrefix: 'X',
  standard: 'IEEE',
});

const fuseTerminal = def({
  id: 'terminal-fuse',
  name: 'Fuse Terminal',
  category: 'terminal',
  description: 'Fuse terminal block',
  bounds: { minX: -3, minY: -10, maxX: 3, maxY: 10 },
  pins: [
    { id: 'L', name: 'L', position: v(0, 10) },
    { id: 'F', name: 'F', position: v(0, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 4) },
    { kind: 'line', a: v(0, -10), b: v(0, -4) },
    { kind: 'rect', a: v(-2, -4), b: v(2, 4) },
  ],
  tagPrefix: 'X',
  standard: 'IEEE',
});

const groundTerminal = def({
  id: 'terminal-ground',
  name: 'Ground Terminal',
  category: 'terminal',
  description: 'PE ground terminal',
  bounds: { minX: -5, minY: -8, maxX: 5, maxY: 8 },
  pins: [
    { id: 'L', name: 'L', position: v(0, 8) },
  ],
  primitives: [
    { kind: 'line', a: v(0, 8), b: v(0, 2) },
    { kind: 'circle', c: v(0, 0), r: 2 },
    { kind: 'line', a: v(0, -2), b: v(0, -4) },
    { kind: 'line', a: v(-5, -4), b: v(5, -4) },
    { kind: 'line', a: v(-3, -6), b: v(3, -6) },
    { kind: 'line', a: v(-1.5, -8), b: v(1.5, -8) },
  ],
  tagPrefix: 'GND',
  standard: 'IEEE',
});

// ---------- RESISTOR / CAPACITOR ----------
const resistor = def({
  id: 'resistor',
  name: 'Resistor',
  category: 'resistor-capacitor',
  description: 'Resistor',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 3 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'polyline', points: [v(-6, 0), v(-5, 2), v(-3, -2), v(-1, 2), v(1, -2), v(3, 2), v(5, -2), v(6, 0)] },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
  ],
  tagPrefix: 'R',
  standard: 'IEEE',
});

const potentiometer = def({
  id: 'potentiometer',
  name: 'Potentiometer',
  category: 'resistor-capacitor',
  description: 'Variable resistor / potentiometer',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 7 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: 'W', position: v(0, 7) },
    { id: '3', name: '3', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'polyline', points: [v(-6, 0), v(-5, 2), v(-3, -2), v(-1, 2), v(1, -2), v(3, 2), v(5, -2), v(6, 0)] },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'polyline', points: [v(0, 7), v(0, 3), v(-1.5, 1.5), v(0, 3), v(1.5, 1.5)] },
  ],
  tagPrefix: 'R',
  standard: 'IEEE',
});

const capacitor = def({
  id: 'capacitor',
  name: 'Capacitor',
  category: 'resistor-capacitor',
  description: 'Capacitor',
  bounds: { minX: -10, minY: -4, maxX: 10, maxY: 4 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-1, 0) },
    { kind: 'line', a: v(-1, -3), b: v(-1, 3) },
    { kind: 'line', a: v(1, -3), b: v(1, 3) },
    { kind: 'line', a: v(1, 0), b: v(10, 0) },
  ],
  tagPrefix: 'C',
  standard: 'IEEE',
});

const polarizedCap = def({
  id: 'capacitor-polarized',
  name: 'Polarized Cap',
  category: 'resistor-capacitor',
  description: 'Polarized capacitor',
  bounds: { minX: -10, minY: -4, maxX: 10, maxY: 5 },
  pins: [
    { id: '+', name: '+', position: v(-10, 0) },
    { id: '-', name: '-', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-1, 0) },
    { kind: 'line', a: v(-1, -3), b: v(-1, 3) },
    { kind: 'arc', c: v(2, 0), r: 3, start: Math.PI / 2, end: 3 * Math.PI / 2 },
    { kind: 'line', a: v(2, 0), b: v(10, 0) },
    { kind: 'text', p: v(-3, 4), text: '+', size: 2.4, align: 'center' },
  ],
  tagPrefix: 'C',
  standard: 'IEEE',
});

const inductor = def({
  id: 'inductor',
  name: 'Inductor',
  category: 'resistor-capacitor',
  description: 'Inductor / coil',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 4 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-7, 0) },
    { kind: 'arc', c: v(-5, 0), r: 2, start: 0, end: Math.PI },
    { kind: 'arc', c: v(-1.5, 0), r: 2, start: 0, end: Math.PI },
    { kind: 'arc', c: v(2, 0), r: 2, start: 0, end: Math.PI },
    { kind: 'arc', c: v(5.5, 0), r: 2, start: 0, end: Math.PI },
    { kind: 'line', a: v(7.5, 0), b: v(10, 0) },
  ],
  tagPrefix: 'L',
  standard: 'IEEE',
});

// ---------- DIODE / LED ----------
const diode = def({
  id: 'diode',
  name: 'Diode',
  category: 'diode-led',
  description: 'Standard diode',
  bounds: { minX: -10, minY: -4, maxX: 10, maxY: 4 },
  pins: [
    { id: 'A', name: 'A', position: v(-10, 0) },
    { id: 'K', name: 'K', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-2, 0) },
    { kind: 'polyline', points: [v(-2, 3), v(-2, -3), v(2, 0)], closed: true, fill: '#e6e6e6' },
    { kind: 'line', a: v(2, 3), b: v(2, -3) },
    { kind: 'line', a: v(2, 0), b: v(10, 0) },
  ],
  tagPrefix: 'D',
  standard: 'IEEE',
});

const zenerDiode = def({
  id: 'diode-zener',
  name: 'Zener Diode',
  category: 'diode-led',
  description: 'Zener diode',
  bounds: { minX: -10, minY: -4, maxX: 10, maxY: 4 },
  pins: [
    { id: 'A', name: 'A', position: v(-10, 0) },
    { id: 'K', name: 'K', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-2, 0) },
    { kind: 'polyline', points: [v(-2, 3), v(-2, -3), v(2, 0)], closed: true, fill: '#e6e6e6' },
    { kind: 'polyline', points: [v(0, 3), v(2, 3), v(2, -3), v(4, -3)] },
    { kind: 'line', a: v(2, 0), b: v(10, 0) },
  ],
  tagPrefix: 'D',
  standard: 'IEEE',
});

const led = def({
  id: 'led',
  name: 'LED',
  category: 'diode-led',
  description: 'Light-emitting diode',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'A', name: 'A', position: v(-10, 0) },
    { id: 'K', name: 'K', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-2, 0) },
    { kind: 'polyline', points: [v(-2, 3), v(-2, -3), v(2, 0)], closed: true, fill: '#e6e6e6' },
    { kind: 'line', a: v(2, 3), b: v(2, -3) },
    { kind: 'line', a: v(2, 0), b: v(10, 0) },
    { kind: 'line', a: v(2, 4), b: v(5, 6) },
    { kind: 'polyline', points: [v(5, 6), v(4.4, 5.5), v(4.6, 5.0)] },
    { kind: 'line', a: v(0, 4), b: v(3, 6) },
    { kind: 'polyline', points: [v(3, 6), v(2.4, 5.5), v(2.6, 5.0)] },
  ],
  tagPrefix: 'D',
  standard: 'IEEE',
});

const bridgeRectifier = def({
  id: 'bridge-rectifier',
  name: 'Bridge Rectifier',
  category: 'diode-led',
  description: 'Full-wave bridge rectifier',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
  pins: [
    { id: 'AC1', name: '~', position: v(-10, 0) },
    { id: 'AC2', name: '~', position: v(10, 0) },
    { id: '+', name: '+', position: v(0, 10) },
    { id: '-', name: '-', position: v(0, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-7, 0) },
    { kind: 'line', a: v(7, 0), b: v(10, 0) },
    { kind: 'line', a: v(0, 10), b: v(0, 7) },
    { kind: 'line', a: v(0, -10), b: v(0, -7) },
    { kind: 'polyline', points: [v(-7, 0), v(0, 7), v(7, 0), v(0, -7)], closed: true },
    { kind: 'text', p: v(0, 0), text: '~', size: 4, align: 'center' },
  ],
  tagPrefix: 'BR',
  standard: 'IEEE',
});

// ---------- SENSORS ----------
const proxSensor = def({
  id: 'sensor-prox',
  name: 'Proximity Sensor',
  category: 'sensor',
  description: 'Inductive/capacitive prox sensor',
  bounds: { minX: -8, minY: -8, maxX: 8, maxY: 12 },
  pins: [
    { id: '+', name: 'BN', position: v(-4, 12), type: 'power' },
    { id: '-', name: 'BU', position: v(4, 12), type: 'ground' },
    { id: 'OUT', name: 'BK', position: v(0, -8), type: 'output' },
  ],
  primitives: [
    { kind: 'line', a: v(-4, 12), b: v(-4, 6) },
    { kind: 'line', a: v(4, 12), b: v(4, 6) },
    { kind: 'line', a: v(0, -8), b: v(0, -4) },
    { kind: 'rect', a: v(-6, -4), b: v(6, 6) },
    { kind: 'circle', c: v(0, 1), r: 2.5 },
    { kind: 'line', a: v(0, -1.5), b: v(0, 3.5) },
  ],
  tagPrefix: 'B',
  standard: 'IEEE',
});

const photoSensor = def({
  id: 'sensor-photo',
  name: 'Photo Sensor',
  category: 'sensor',
  description: 'Photoelectric sensor',
  bounds: { minX: -8, minY: -8, maxX: 8, maxY: 12 },
  pins: [
    { id: '+', name: 'BN', position: v(-4, 12), type: 'power' },
    { id: '-', name: 'BU', position: v(4, 12), type: 'ground' },
    { id: 'OUT', name: 'BK', position: v(0, -8), type: 'output' },
  ],
  primitives: [
    { kind: 'line', a: v(-4, 12), b: v(-4, 6) },
    { kind: 'line', a: v(4, 12), b: v(4, 6) },
    { kind: 'line', a: v(0, -8), b: v(0, -4) },
    { kind: 'rect', a: v(-6, -4), b: v(6, 6) },
    { kind: 'polyline', points: [v(-2, 3), v(-2, -1), v(2, -1), v(2, 3)] },
    { kind: 'line', a: v(0, 4), b: v(0, 6.5) },
    { kind: 'polyline', points: [v(-1, 5.5), v(0, 6.5), v(1, 5.5)] },
  ],
  tagPrefix: 'B',
  standard: 'IEEE',
});

const encoder = def({
  id: 'sensor-encoder',
  name: 'Encoder',
  category: 'sensor',
  description: 'Rotary encoder',
  bounds: { minX: -10, minY: -10, maxX: 10, maxY: 12 },
  pins: [
    { id: '+', name: '+V', position: v(-6, 12) },
    { id: 'A', name: 'A', position: v(0, 12) },
    { id: 'B', name: 'B', position: v(6, 12) },
    { id: '-', name: '0V', position: v(0, -10) },
  ],
  primitives: [
    { kind: 'line', a: v(-6, 12), b: v(-6, 8) },
    { kind: 'line', a: v(0, 12), b: v(0, 8) },
    { kind: 'line', a: v(6, 12), b: v(6, 8) },
    { kind: 'line', a: v(0, -10), b: v(0, -6) },
    { kind: 'rect', a: v(-8, -6), b: v(8, 8) },
    { kind: 'circle', c: v(0, 1), r: 3 },
    { kind: 'line', a: v(0, -2), b: v(0, 4) },
    { kind: 'line', a: v(-3, 1), b: v(3, 1) },
  ],
  tagPrefix: 'B',
  standard: 'IEEE',
});

const thermocouple = def({
  id: 'sensor-thermocouple',
  name: 'Thermocouple',
  category: 'sensor',
  description: 'Thermocouple',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 6 },
  pins: [
    { id: '+', name: '+', position: v(-10, 0) },
    { id: '-', name: '-', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-3, 0) },
    { kind: 'line', a: v(3, 0), b: v(10, 0) },
    { kind: 'polyline', points: [v(-3, -2), v(0, 4), v(3, -2)], closed: true },
    { kind: 'text', p: v(0, 6), text: 'TC', size: 2.4, align: 'center' },
  ],
  tagPrefix: 'TC',
  standard: 'IEEE',
});

const rtd = def({
  id: 'sensor-rtd',
  name: 'RTD',
  category: 'sensor',
  description: 'Resistance temperature detector',
  bounds: { minX: -10, minY: -3, maxX: 10, maxY: 6 },
  pins: [
    { id: '1', name: '1', position: v(-10, 0) },
    { id: '2', name: '2', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'line', a: v(-10, 0), b: v(-6, 0) },
    { kind: 'rect', a: v(-6, -2), b: v(6, 2) },
    { kind: 'line', a: v(6, 0), b: v(10, 0) },
    { kind: 'line', a: v(-7, 5), b: v(-3, 1) },
    { kind: 'text', p: v(0, 4), text: 'RTD', size: 2.4, align: 'center' },
  ],
  tagPrefix: 'RT',
  standard: 'IEEE',
});

const pressureSensor = def({
  id: 'sensor-pressure',
  name: 'Pressure Sensor',
  category: 'sensor',
  description: 'Pressure transducer',
  bounds: { minX: -8, minY: -8, maxX: 8, maxY: 12 },
  pins: [
    { id: '+', name: '+', position: v(-4, 12) },
    { id: '-', name: '-', position: v(4, 12) },
  ],
  primitives: [
    { kind: 'line', a: v(-4, 12), b: v(-4, 6) },
    { kind: 'line', a: v(4, 12), b: v(4, 6) },
    { kind: 'rect', a: v(-6, -4), b: v(6, 6) },
    { kind: 'arc', c: v(0, 0), r: 2, start: 0, end: Math.PI },
    { kind: 'text', p: v(0, -2.5), text: 'P', size: 3, align: 'center' },
  ],
  tagPrefix: 'PT',
  standard: 'IEEE',
});

// ---------- PLC IO ----------
const plcDI = def({
  id: 'plc-di',
  name: 'PLC DI',
  category: 'plc-io',
  description: 'PLC digital input',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'IN', name: 'IN', position: v(-10, 0) },
    { id: 'COM', name: 'COM', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'rect', a: v(-8, -5), b: v(8, 5) },
    { kind: 'line', a: v(-10, 0), b: v(-8, 0) },
    { kind: 'line', a: v(8, 0), b: v(10, 0) },
    { kind: 'text', p: v(0, 0), text: 'DI', size: 4, align: 'center' },
  ],
  tagPrefix: 'I',
  standard: 'IEEE',
});

const plcDO = def({
  id: 'plc-do',
  name: 'PLC DO',
  category: 'plc-io',
  description: 'PLC digital output',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'OUT', name: 'OUT', position: v(-10, 0) },
    { id: 'COM', name: 'COM', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'rect', a: v(-8, -5), b: v(8, 5) },
    { kind: 'line', a: v(-10, 0), b: v(-8, 0) },
    { kind: 'line', a: v(8, 0), b: v(10, 0) },
    { kind: 'text', p: v(0, 0), text: 'DO', size: 4, align: 'center' },
  ],
  tagPrefix: 'Q',
  standard: 'IEEE',
});

const plcAI = def({
  id: 'plc-ai',
  name: 'PLC AI',
  category: 'plc-io',
  description: 'PLC analog input',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'IN+', name: 'IN+', position: v(-10, 2) },
    { id: 'IN-', name: 'IN-', position: v(-10, -2) },
    { id: 'AGND', name: 'AGND', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'rect', a: v(-8, -5), b: v(8, 5) },
    { kind: 'line', a: v(-10, 2), b: v(-8, 2) },
    { kind: 'line', a: v(-10, -2), b: v(-8, -2) },
    { kind: 'line', a: v(8, 0), b: v(10, 0) },
    { kind: 'text', p: v(0, 0), text: 'AI', size: 4, align: 'center' },
  ],
  tagPrefix: 'AI',
  standard: 'IEEE',
});

const plcAO = def({
  id: 'plc-ao',
  name: 'PLC AO',
  category: 'plc-io',
  description: 'PLC analog output',
  bounds: { minX: -10, minY: -6, maxX: 10, maxY: 6 },
  pins: [
    { id: 'OUT', name: 'OUT', position: v(-10, 0) },
    { id: 'AGND', name: 'AGND', position: v(10, 0) },
  ],
  primitives: [
    { kind: 'rect', a: v(-8, -5), b: v(8, 5) },
    { kind: 'line', a: v(-10, 0), b: v(-8, 0) },
    { kind: 'line', a: v(8, 0), b: v(10, 0) },
    { kind: 'text', p: v(0, 0), text: 'AO', size: 4, align: 'center' },
  ],
  tagPrefix: 'AO',
  standard: 'IEEE',
});

const plcCpu = def({
  id: 'plc-cpu',
  name: 'PLC CPU',
  category: 'plc-io',
  description: 'PLC processor / CPU',
  bounds: { minX: -14, minY: -10, maxX: 14, maxY: 10 },
  pins: [
    { id: '+', name: '+24V', position: v(-14, 6) },
    { id: '-', name: '0V', position: v(-14, 2) },
    { id: 'COM1', name: 'COM1', position: v(14, 6) },
    { id: 'COM2', name: 'ETH', position: v(14, 2) },
  ],
  primitives: [
    { kind: 'rect', a: v(-12, -8), b: v(12, 8) },
    { kind: 'rect', a: v(-10, -6), b: v(10, 4), lineWidth: 0.2 },
    { kind: 'line', a: v(-14, 6), b: v(-12, 6) },
    { kind: 'line', a: v(-14, 2), b: v(-12, 2) },
    { kind: 'line', a: v(12, 6), b: v(14, 6) },
    { kind: 'line', a: v(12, 2), b: v(14, 2) },
    { kind: 'text', p: v(0, -1), text: 'CPU', size: 5, align: 'center' },
    { kind: 'circle', c: v(8, 6), r: 0.6, fill: '#6dd17c' },
    { kind: 'circle', c: v(6, 6), r: 0.6, fill: '#ffb347' },
    { kind: 'circle', c: v(4, 6), r: 0.6, fill: '#ff5d5d' },
  ],
  tagPrefix: 'PLC',
  standard: 'IEEE',
});

// ---------- ONE LINE ----------
const ol_breaker = def({
  id: 'ol-breaker',
  name: 'Breaker (1-line)',
  category: 'one-line',
  description: 'Circuit breaker single-line',
  bounds: { minX: -3, minY: -8, maxX: 8, maxY: 8 },
  pins: [
    { id: '1', name: '1', position: v(0, 8), type: 'power' },
    { id: '2', name: '2', position: v(0, -8), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(0, 8), b: v(0, 4) },
    { kind: 'line', a: v(0, 4), b: v(6, -4) },
    { kind: 'line', a: v(0, -4), b: v(0, -8) },
    { kind: 'circle', c: v(0, 4), r: 0.7 },
    { kind: 'circle', c: v(0, -4), r: 0.7 },
    { kind: 'rect', a: v(-2, 1), b: v(2, -1), lineWidth: 0.2 },
  ],
  tagPrefix: 'CB',
  standard: 'IEEE',
});

const ol_xfmr = def({
  id: 'ol-transformer',
  name: 'Transformer (1-line)',
  category: 'one-line',
  description: 'Transformer single-line',
  bounds: { minX: -6, minY: -10, maxX: 6, maxY: 10 },
  pins: [
    { id: 'H', name: 'H', position: v(0, 10), type: 'power' },
    { id: 'X', name: 'X', position: v(0, -10), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 5) },
    { kind: 'line', a: v(0, -10), b: v(0, -5) },
    { kind: 'circle', c: v(0, 2), r: 3 },
    { kind: 'circle', c: v(0, -2), r: 3 },
  ],
  tagPrefix: 'T',
  standard: 'IEEE',
});

const ol_motor = def({
  id: 'ol-motor',
  name: 'Motor (1-line)',
  category: 'one-line',
  description: 'Motor single-line',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 8 },
  pins: [{ id: 'L', name: 'L', position: v(0, 8), type: 'power' }],
  primitives: [
    { kind: 'line', a: v(0, 8), b: v(0, 6) },
    { kind: 'circle', c: v(0, -1), r: 7 },
    { kind: 'text', p: v(0, 0), text: 'M', size: 6, align: 'center' },
  ],
  tagPrefix: 'M',
  standard: 'IEEE',
});

const ol_vfd = def({
  id: 'ol-vfd',
  name: 'VFD (1-line)',
  category: 'one-line',
  description: 'Variable frequency drive',
  bounds: { minX: -8, minY: -10, maxX: 8, maxY: 10 },
  pins: [
    { id: 'L', name: 'L', position: v(0, 10), type: 'power' },
    { id: 'T', name: 'T', position: v(0, -10), type: 'power' },
  ],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 6) },
    { kind: 'line', a: v(0, -10), b: v(0, -6) },
    { kind: 'rect', a: v(-6, -6), b: v(6, 6) },
    { kind: 'text', p: v(0, 0), text: 'VFD', size: 3.5, align: 'center' },
  ],
  tagPrefix: 'VFD',
  standard: 'IEEE',
});

const ol_utility = def({
  id: 'ol-utility',
  name: 'Utility',
  category: 'one-line',
  description: 'Utility supply',
  bounds: { minX: -6, minY: -8, maxX: 6, maxY: 6 },
  pins: [{ id: 'L', name: 'L', position: v(0, -8), type: 'power' }],
  primitives: [
    { kind: 'line', a: v(0, -8), b: v(0, -3) },
    { kind: 'circle', c: v(0, 0), r: 5 },
    { kind: 'polyline', points: [v(-3, 0), v(-1, 2), v(1, -2), v(3, 0)] },
  ],
  tagPrefix: 'U',
  standard: 'IEEE',
});

const ol_bus = def({
  id: 'ol-bus',
  name: 'Bus Bar',
  category: 'one-line',
  description: 'Bus bar / panel bus',
  bounds: { minX: -15, minY: -2, maxX: 15, maxY: 2 },
  pins: [
    { id: '1', name: '1', position: v(-15, 0), type: 'power' },
    { id: '2', name: '2', position: v(0, 0), type: 'power' },
    { id: '3', name: '3', position: v(15, 0), type: 'power' },
  ],
  primitives: [
    { kind: 'rect', a: v(-15, -1), b: v(15, 1), fill: '#3ba3ff' },
  ],
  tagPrefix: 'BUS',
  standard: 'IEEE',
});

const ol_generator = def({
  id: 'ol-generator',
  name: 'Generator (1-line)',
  category: 'one-line',
  description: 'Generator single-line',
  bounds: { minX: -8, minY: -8, maxX: 8, maxY: 10 },
  pins: [{ id: 'L', name: 'L', position: v(0, 10), type: 'power' }],
  primitives: [
    { kind: 'line', a: v(0, 10), b: v(0, 7) },
    { kind: 'circle', c: v(0, 0), r: 7 },
    { kind: 'text', p: v(0, 0), text: 'G', size: 6, align: 'center' },
  ],
  tagPrefix: 'G',
  standard: 'IEEE',
});

// ---------- ASSEMBLE ----------
const ALL: SymbolDef[] = [
  acSource, dcSource, battery, generator,
  earthGround, chassisGround, signalGround,
  switchSPST, switchSPDT, switchDPDT, limitSwitchNO, limitSwitchNC,
  pressureSwitch, tempSwitch, flowSwitch, levelSwitch, disconnectSwitch,
  selectorSwitch, footSwitch,
  pbNO, pbNC, eStop, pbIlluminated, keyOpPB,
  contactorCoil, coilTimerOn, coilTimerOff,
  contactNO, contactNC, contactNOTOn, contactNOTOff,
  overloadRelay, overloadContact, ssr,
  motor3ph, motor1ph, motorDC, motorServo, motorStepper,
  transformer, ctTransformer, controlTransformer, autoTransformer,
  fuse, breaker1P, breaker2P, breaker3P, gfci,
  pilotR, pilotG, pilotA, pilotB, pilotW,
  beacon, buzzer, horn,
  terminal, fuseTerminal, groundTerminal,
  resistor, potentiometer, capacitor, polarizedCap, inductor,
  diode, zenerDiode, led, bridgeRectifier,
  proxSensor, photoSensor, encoder, thermocouple, rtd, pressureSensor,
  plcDI, plcDO, plcAI, plcAO, plcCpu,
  ol_breaker, ol_xfmr, ol_motor, ol_vfd, ol_utility, ol_bus, ol_generator,
];

export const SYMBOLS: Record<string, SymbolDef> = Object.fromEntries(ALL.map((s) => [s.id, s]));
export const SYMBOL_LIST: SymbolDef[] = ALL;

export const getSymbol = (id: string): SymbolDef | undefined => SYMBOLS[id];

export const symbolsByCategory = (): Record<SymbolCategory, SymbolDef[]> => {
  const out = {} as Record<SymbolCategory, SymbolDef[]>;
  for (const s of ALL) {
    if (!out[s.category]) out[s.category] = [];
    out[s.category].push(s);
  }
  return out;
};

export const CATEGORY_LABELS: Record<SymbolCategory, string> = {
  'power-source': 'Power Sources',
  'switch': 'Switches',
  'contactor-relay': 'Contactors & Relays',
  'motor': 'Motors',
  'transformer': 'Transformers',
  'fuse-breaker': 'Fuses & Breakers',
  'sensor': 'Sensors',
  'plc-io': 'PLC I/O',
  'pushbutton': 'Pushbuttons',
  'indicator': 'Indicators',
  'terminal': 'Terminals',
  'connector': 'Connectors',
  'ground': 'Ground',
  'resistor-capacitor': 'R / L / C',
  'diode-led': 'Diodes / LEDs',
  'panel-component': 'Panel',
  'one-line': 'One-Line',
};
