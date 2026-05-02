import { createEmptyProject, newEntityId } from './state/store';
import type { Project, Entity, SheetId, LayerId } from './types';

// Build a sample motor-starter schematic so the app demos something on first load.
export const createSampleProject = (): Project => {
  const project = createEmptyProject();
  project.name = 'Motor Starter Demo';
  project.client = 'OpenCAD';
  project.engineer = 'Demo Engineer';

  const sheets = project.sheetOrder;
  const symbolsLayer = project.layerOrder[1]; // "Symbols"
  const wiresLayer = project.layerOrder[0];   // "Wires"
  const annLayer = project.layerOrder[4];     // "Annotation"
  const panelLayer = project.layerOrder[5];   // "Panel Layout"

  // Power Schematic (sheet 0)
  populatePowerSchematic(project, sheets[0], symbolsLayer, wiresLayer, annLayer);
  // Control Schematic (sheet 1)
  populateControlSchematic(project, sheets[1], symbolsLayer, wiresLayer, annLayer);
  // Panel Layout (sheet 2)
  populatePanelLayout(project, sheets[2], panelLayer, symbolsLayer);
  // One Line (sheet 3)
  populateOneLine(project, sheets[3], symbolsLayer, wiresLayer, annLayer);

  project.activeSheetId = sheets[0];
  return project;
};

const add = (project: Project, sheetId: SheetId, e: Entity) => {
  const sheet = project.sheets[sheetId];
  sheet.entities[e.id] = e;
  sheet.entityOrder.push(e.id);
};

const symbol = (
  layerId: LayerId,
  symbolId: string,
  x: number,
  y: number,
  rotation = 0,
  tag?: string,
  description?: string,
  partNumber?: string,
  rating?: string,
  manufacturer?: string,
): Entity => ({
  id: newEntityId(),
  kind: 'symbol',
  layerId,
  visible: true,
  locked: false,
  symbolId,
  position: { x, y },
  rotation,
  scale: 1,
  mirror: false,
  tag,
  description,
  partNumber,
  rating,
  manufacturer,
});

const wire = (layerId: LayerId, points: { x: number; y: number }[], wireNumber?: string, wireType?: string): Entity => ({
  id: newEntityId(),
  kind: 'wire',
  layerId,
  visible: true,
  locked: false,
  points,
  wireNumber,
  wireType,
});

const text = (layerId: LayerId, x: number, y: number, t: string, fontSize = 4): Entity => ({
  id: newEntityId(),
  kind: 'text',
  layerId,
  visible: true,
  locked: false,
  position: { x, y },
  text: t,
  fontSize,
  rotation: 0,
  align: 'left',
});

const populatePowerSchematic = (
  p: Project,
  sheetId: SheetId,
  symLayer: LayerId,
  wireLayer: LayerId,
  annLayer: LayerId,
) => {
  // L1, L2, L3 from top of sheet
  const x1 = 60, x2 = 100, x3 = 140;
  const yTop = 220;
  const yMotor = 60;

  // L1/L2/L3 power rails labels
  add(p, sheetId, text(annLayer, x1 - 6, yTop + 10, 'L1'));
  add(p, sheetId, text(annLayer, x2 - 6, yTop + 10, 'L2'));
  add(p, sheetId, text(annLayer, x3 - 6, yTop + 10, 'L3'));

  // 3-pole disconnect at top
  add(p, sheetId, symbol(symLayer, 'sw-disconnect', 100, 200, 0, 'QM1', 'Main Disconnect', 'NSX160F', '160A', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: x1, y: yTop }, { x: x1, y: 214 }], '1L1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: x2, y: yTop }, { x: x2, y: 214 }], '1L2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: x3, y: yTop }, { x: x3, y: 214 }], '1L3', 'L3'));
  add(p, sheetId, wire(wireLayer, [{ x: 94, y: 196 }, { x: x1, y: 180 }], '2L1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: 100, y: 196 }, { x: x2, y: 180 }], '2L2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: 106, y: 196 }, { x: x3, y: 180 }], '2L3', 'L3'));

  // 3-pole circuit breaker
  add(p, sheetId, symbol(symLayer, 'breaker-3p', 100, 170, 0, 'CB1', 'Main breaker', '3RV2011-1FA10', '5A', 'Siemens'));
  add(p, sheetId, wire(wireLayer, [{ x: 94, y: 160 }, { x: x1, y: 150 }], '3L1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: 100, y: 160 }, { x: x2, y: 150 }], '3L2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: 106, y: 160 }, { x: x3, y: 150 }], '3L3', 'L3'));

  // Contactor (3 NO contacts shown as one symbol)
  add(p, sheetId, symbol(symLayer, 'breaker-3p', 100, 130, 0, 'KM1', 'Motor contactor', '3RT2024-1BB40', '12A', 'Siemens'));
  add(p, sheetId, wire(wireLayer, [{ x: 94, y: 120 }, { x: x1, y: 110 }], '4L1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: 100, y: 120 }, { x: x2, y: 110 }], '4L2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: 106, y: 120 }, { x: x3, y: 110 }], '4L3', 'L3'));

  // Overload heater (3 windings shown one)
  add(p, sheetId, symbol(symLayer, 'overload-coil', x1, 95, 0, 'F2', 'Overload', '3RU2116-1DB0', '3A', 'Siemens'));
  add(p, sheetId, symbol(symLayer, 'overload-coil', x2, 95, 0, 'F2'));
  add(p, sheetId, symbol(symLayer, 'overload-coil', x3, 95, 0, 'F2'));
  add(p, sheetId, wire(wireLayer, [{ x: x1, y: 89 }, { x: x1, y: 80 }], 'T1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: x2, y: 89 }, { x: x2, y: 80 }], 'T2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: x3, y: 89 }, { x: x3, y: 80 }], 'T3', 'L3'));

  // 3-phase motor at bottom
  add(p, sheetId, symbol(symLayer, 'motor-3ph', x2, yMotor, 0, 'M1', 'Conveyor motor', '1LE1003-0EB42', '3 kW 400V 1450 rpm', 'Siemens'));
  add(p, sheetId, wire(wireLayer, [{ x: x1 - 8, y: yMotor + 14 }, { x: x1, y: 80 }], 'T1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: x2, y: yMotor + 14 }, { x: x2, y: 80 }], 'T2', 'L2'));
  add(p, sheetId, wire(wireLayer, [{ x: x2 + 8, y: yMotor + 14 }, { x: x3, y: 80 }], 'T3', 'L3'));

  // PE ground bus
  add(p, sheetId, symbol(symLayer, 'gnd-earth', x2 + 30, yMotor - 4, 0, 'PE', 'Protective earth'));
  add(p, sheetId, wire(wireLayer, [{ x: x2, y: yMotor - 16 }, { x: x2 + 30, y: yMotor + 1 }], 'PE', 'PE'));

  // Title
  add(p, sheetId, text(annLayer, 20, 240, 'POWER SCHEMATIC — MOTOR STARTER', 5));
  add(p, sheetId, text(annLayer, 20, 232, '400V 50Hz Three-Phase', 3));
};

const populateControlSchematic = (
  p: Project,
  sheetId: SheetId,
  symLayer: LayerId,
  wireLayer: LayerId,
  annLayer: LayerId,
) => {
  // Standard ladder: L1 left rail, N right rail
  const xL = 60, xN = 380;
  const yTop = 220, yBot = 50;

  add(p, sheetId, text(annLayer, xL - 8, yTop + 6, 'L1'));
  add(p, sheetId, text(annLayer, xN - 4, yTop + 6, 'N'));
  add(p, sheetId, wire(wireLayer, [{ x: xL, y: yBot }, { x: xL, y: yTop }], '1', 'L1'));
  add(p, sheetId, wire(wireLayer, [{ x: xN, y: yBot }, { x: xN, y: yTop }], 'N', 'N'));

  // Rung 1: Start/Stop with seal-in
  let y = 200;
  // Stop (NC PB)
  add(p, sheetId, symbol(symLayer, 'pb-nc', 100, y, 0, 'PB1', 'STOP', 'XB4BS542', '22mm red', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: xL, y }, { x: 90, y }], '2'));
  // Start (NO PB)
  add(p, sheetId, symbol(symLayer, 'pb-no', 160, y, 0, 'PB2', 'START', 'XB4BA31', '22mm green', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: 110, y }, { x: 150, y }], '3'));
  // Seal-in NO contact in parallel with PB2
  add(p, sheetId, symbol(symLayer, 'contact-no', 160, y - 14, 0, 'KM1', 'Seal-in contact'));
  add(p, sheetId, wire(wireLayer, [{ x: 110, y }, { x: 110, y: y - 14 }, { x: 150, y: y - 14 }], '3'));
  add(p, sheetId, wire(wireLayer, [{ x: 170, y: y - 14 }, { x: 170, y }], '4'));
  // Overload aux NC
  add(p, sheetId, symbol(symLayer, 'overload-contact', 230, y, 0, 'F2', 'Overload aux'));
  add(p, sheetId, wire(wireLayer, [{ x: 170, y }, { x: 220, y }], '4'));
  // Coil
  add(p, sheetId, symbol(symLayer, 'coil', 330, y, 0, 'KM1', 'Motor contactor coil', '3RT2024-1BB40', '24VDC', 'Siemens'));
  add(p, sheetId, wire(wireLayer, [{ x: 240, y }, { x: 320, y }], '5'));
  add(p, sheetId, wire(wireLayer, [{ x: 340, y }, { x: xN, y }], 'N', 'N'));

  // Rung 2: Run light
  y = 160;
  add(p, sheetId, symbol(symLayer, 'contact-no', 100, y, 0, 'KM1', 'Run contact aux'));
  add(p, sheetId, wire(wireLayer, [{ x: xL, y }, { x: 90, y }], '2'));
  add(p, sheetId, symbol(symLayer, 'light-g', 330, y, 0, 'PL1', 'Run lamp', 'XB4BV33', '24VDC green', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: 110, y }, { x: 326, y }], '6'));
  add(p, sheetId, wire(wireLayer, [{ x: 334, y }, { x: xN, y }], 'N', 'N'));

  // Rung 3: Fault light
  y = 130;
  add(p, sheetId, symbol(symLayer, 'overload-contact', 100, y, 0, 'F2', 'Overload trip aux'));
  add(p, sheetId, wire(wireLayer, [{ x: xL, y }, { x: 90, y }], '2'));
  add(p, sheetId, symbol(symLayer, 'light-r', 330, y, 0, 'PL2', 'Fault lamp', 'XB4BV34', '24VDC red', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: 110, y }, { x: 326, y }], '7'));
  add(p, sheetId, wire(wireLayer, [{ x: 334, y }, { x: xN, y }], 'N', 'N'));

  // Rung 4: E-stop relay coil
  y = 90;
  add(p, sheetId, symbol(symLayer, 'pb-estop', 130, y, 0, 'ES1', 'E-Stop', 'XB4BS8445', 'Mushroom 40mm', 'Schneider'));
  add(p, sheetId, wire(wireLayer, [{ x: xL, y }, { x: 120, y }], '2'));
  add(p, sheetId, symbol(symLayer, 'coil', 330, y, 0, 'KSR', 'Safety relay', 'PNOZ X3', '24VDC', 'Pilz'));
  add(p, sheetId, wire(wireLayer, [{ x: 140, y }, { x: 320, y }], '8'));
  add(p, sheetId, wire(wireLayer, [{ x: 340, y }, { x: xN, y }], 'N', 'N'));

  // Title
  add(p, sheetId, text(annLayer, 20, 240, 'CONTROL SCHEMATIC — START/STOP', 5));
  add(p, sheetId, text(annLayer, 20, 232, '24VDC Control Voltage', 3));
};

const populatePanelLayout = (
  p: Project,
  sheetId: SheetId,
  panelLayer: LayerId,
  symLayer: LayerId,
) => {
  // Panel back: 600 × 800 mm
  const x0 = 80, y0 = 80;
  const w = 440, h = 640;
  // Outer enclosure
  add(p, sheetId, {
    id: newEntityId(),
    kind: 'rectangle',
    layerId: panelLayer,
    visible: true,
    locked: false,
    a: { x: x0, y: y0 },
    b: { x: x0 + w, y: y0 + h },
  });

  // 3 DIN rails
  for (let i = 0; i < 3; i++) {
    const ry = y0 + h - 80 - i * 180;
    add(p, sheetId, {
      id: newEntityId(),
      kind: 'rectangle',
      layerId: panelLayer,
      visible: true,
      locked: false,
      a: { x: x0 + 30, y: ry - 18 },
      b: { x: x0 + w - 30, y: ry },
    });
  }

  // Wire ducts on each side and between rails
  for (let i = 0; i < 4; i++) {
    const dy = y0 + h - 30 - i * 180;
    add(p, sheetId, {
      id: newEntityId(),
      kind: 'rectangle',
      layerId: panelLayer,
      visible: true,
      locked: false,
      a: { x: x0 + 30, y: dy - 30 },
      b: { x: x0 + w - 30, y: dy },
    });
  }

  // Place components on the top DIN rail
  add(p, sheetId, symbol(symLayer, 'breaker-3p', x0 + 80, y0 + h - 90, 0, 'CB1', 'Main breaker'));
  add(p, sheetId, symbol(symLayer, 'breaker-3p', x0 + 140, y0 + h - 90, 0, 'KM1', 'Contactor'));
  add(p, sheetId, symbol(symLayer, 'overload-coil', x0 + 200, y0 + h - 90, 0, 'F2', 'Overload'));
  add(p, sheetId, symbol(symLayer, 'breaker-1p', x0 + 280, y0 + h - 90, 0, 'CB2', 'Control breaker'));

  // Middle rail: relays and PLC
  add(p, sheetId, symbol(symLayer, 'plc-cpu', x0 + 110, y0 + h - 270, 0, 'PLC1', 'PLC CPU'));
  add(p, sheetId, symbol(symLayer, 'plc-di', x0 + 200, y0 + h - 270, 0, 'I1', 'Digital inputs'));
  add(p, sheetId, symbol(symLayer, 'plc-do', x0 + 260, y0 + h - 270, 0, 'Q1', 'Digital outputs'));
  add(p, sheetId, symbol(symLayer, 'ssr', x0 + 320, y0 + h - 270, 0, 'SSR1', 'Solid state relay'));

  // Bottom rail: terminals
  for (let i = 0; i < 12; i++) {
    add(p, sheetId, symbol(symLayer, 'terminal', x0 + 60 + i * 22, y0 + h - 450, 0, `X${i + 1}`));
  }

  // Door indicators (top of panel)
  add(p, sheetId, symbol(symLayer, 'pb-estop', x0 + 80, y0 + h - 60, 0, 'ES1', 'E-Stop'));
  add(p, sheetId, symbol(symLayer, 'light-g', x0 + 130, y0 + h - 60, 0, 'PL1', 'Run'));
  add(p, sheetId, symbol(symLayer, 'light-r', x0 + 170, y0 + h - 60, 0, 'PL2', 'Fault'));
  add(p, sheetId, symbol(symLayer, 'pb-no', x0 + 220, y0 + h - 60, 0, 'PB2', 'Start'));
  add(p, sheetId, symbol(symLayer, 'pb-nc', x0 + 260, y0 + h - 60, 0, 'PB1', 'Stop'));
};

const populateOneLine = (
  p: Project,
  sheetId: SheetId,
  symLayer: LayerId,
  wireLayer: LayerId,
  annLayer: LayerId,
) => {
  // Utility -> Main breaker -> Bus -> Branches
  add(p, sheetId, symbol(symLayer, 'ol-utility', 220, 240, 0, 'U1', '480V Utility'));
  add(p, sheetId, wire(wireLayer, [{ x: 220, y: 232 }, { x: 220, y: 215 }]));
  add(p, sheetId, symbol(symLayer, 'ol-breaker', 220, 200, 0, 'CB-MAIN', 'Main 200A'));
  add(p, sheetId, wire(wireLayer, [{ x: 220, y: 192 }, { x: 220, y: 180 }]));
  // Bus
  add(p, sheetId, symbol(symLayer, 'ol-bus', 220, 180, 0, 'BUS1', 'Main bus'));

  // Branch 1: Transformer + 1-line
  add(p, sheetId, wire(wireLayer, [{ x: 130, y: 180 }, { x: 130, y: 160 }]));
  add(p, sheetId, symbol(symLayer, 'ol-breaker', 130, 145, 0, 'CB1', '60A'));
  add(p, sheetId, wire(wireLayer, [{ x: 130, y: 137 }, { x: 130, y: 130 }]));
  add(p, sheetId, symbol(symLayer, 'ol-transformer', 130, 115, 0, 'T1', '15kVA 480/120-240'));
  add(p, sheetId, wire(wireLayer, [{ x: 130, y: 105 }, { x: 130, y: 95 }]));
  add(p, sheetId, symbol(symLayer, 'ol-bus', 130, 90, 0, 'BUS2', 'Lighting'));

  // Branch 2: VFD + Motor
  add(p, sheetId, wire(wireLayer, [{ x: 220, y: 180 }, { x: 220, y: 160 }]));
  add(p, sheetId, symbol(symLayer, 'ol-breaker', 220, 145, 0, 'CB2', '40A'));
  add(p, sheetId, wire(wireLayer, [{ x: 220, y: 137 }, { x: 220, y: 130 }]));
  add(p, sheetId, symbol(symLayer, 'ol-vfd', 220, 115, 0, 'VFD1', 'PowerFlex 525 7.5kW'));
  add(p, sheetId, wire(wireLayer, [{ x: 220, y: 105 }, { x: 220, y: 95 }]));
  add(p, sheetId, symbol(symLayer, 'ol-motor', 220, 80, 0, 'M1', '7.5kW Conveyor'));

  // Branch 3: Direct motor
  add(p, sheetId, wire(wireLayer, [{ x: 310, y: 180 }, { x: 310, y: 160 }]));
  add(p, sheetId, symbol(symLayer, 'ol-breaker', 310, 145, 0, 'CB3', '20A'));
  add(p, sheetId, wire(wireLayer, [{ x: 310, y: 137 }, { x: 310, y: 130 }]));
  add(p, sheetId, symbol(symLayer, 'ol-motor', 310, 115, 0, 'M2', '3kW Pump'));

  // Branch 4: Generator
  add(p, sheetId, wire(wireLayer, [{ x: 60, y: 180 }, { x: 60, y: 160 }]));
  add(p, sheetId, symbol(symLayer, 'ol-breaker', 60, 145, 0, 'CB-GEN', '200A'));
  add(p, sheetId, wire(wireLayer, [{ x: 60, y: 137 }, { x: 60, y: 130 }]));
  add(p, sheetId, symbol(symLayer, 'ol-generator', 60, 115, 0, 'G1', '50kVA Standby'));

  add(p, sheetId, text(annLayer, 20, 250, 'ONE-LINE DIAGRAM — MAIN POWER', 5));
};
