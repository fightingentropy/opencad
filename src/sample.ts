import { createEmptyProject, newEntityId } from './state/store';
import type {
  Project,
  Entity,
  SheetId,
  LayerId,
  ContainmentType,
  Vec2,
} from './types';

// Demo project: a small floor plan with walls, rooms, and electrical
// containment routed between them. The same layout reads as a CAD plan
// in 2D and as a building interior in 3D.
export const createSampleProject = (): Project => {
  const project = createEmptyProject();
  project.name = 'Building Containment Demo';
  project.client = 'OpenCAD';
  project.engineer = 'Demo Engineer';

  const annLayer = project.layerOrder[4];
  const containmentLayer = project.layerOrder[6];
  const wallLayer = project.layerOrder[7];
  const roomLayer = project.layerOrder[8];

  // Trim the default 4 sheets to a single Floor Plan sheet so the demo's
  // intent is unambiguous: one drawing, one building.
  const order = project.sheetOrder;
  for (let i = 1; i < order.length; i++) {
    delete project.sheets[order[i]];
  }
  project.sheetOrder = [order[0]];

  const planId = project.sheetOrder[0];
  const plan = project.sheets[planId];
  plan.name = 'Floor Plan';
  plan.number = '001';
  plan.kind = 'panel-layout';
  plan.width = 12000;
  plan.height = 8000;
  plan.sceneStyle = 'building';

  populateFloorPlan(
    project,
    planId,
    wallLayer,
    roomLayer,
    containmentLayer,
    annLayer,
  );

  project.activeSheetId = planId;
  return project;
};

// ---------- helpers --------------------------------------------------------

const add = (project: Project, sheetId: SheetId, e: Entity) => {
  const sheet = project.sheets[sheetId];
  sheet.entities[e.id] = e;
  sheet.entityOrder.push(e.id);
};

const text = (
  layerId: LayerId,
  x: number,
  y: number,
  t: string,
  fontSize = 4,
): Entity => ({
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

const wall = (
  layerId: LayerId,
  points: Vec2[],
  thickness = 80,
  height = 3000,
): Entity => ({
  id: newEntityId(),
  kind: 'wall',
  layerId,
  visible: true,
  locked: false,
  points,
  thickness,
  height,
});

const room = (
  layerId: LayerId,
  a: Vec2,
  b: Vec2,
  name?: string,
  floorColor?: string,
): Entity => ({
  id: newEntityId(),
  kind: 'room',
  layerId,
  visible: true,
  locked: false,
  a,
  b,
  name,
  floorColor,
});

const containment = (
  layerId: LayerId,
  type: ContainmentType,
  points: Vec2[],
  width?: number,
  height?: number,
  color?: string,
): Entity => ({
  id: newEntityId(),
  kind: 'containment',
  layerId,
  visible: true,
  locked: false,
  containmentType: type,
  points,
  width,
  height,
  color,
});

// Per-type colors picked to read clearly in 3D BIM-style views.
const COLOR = {
  trunking: '#d4894a',
  basket: '#bcc1c8',
  tray: '#7fb24a',
  conduit: '#3a6db8',
} as const;

// ---------- Floor plan -----------------------------------------------------

const populateFloorPlan = (
  p: Project,
  sheetId: SheetId,
  wallLayer: LayerId,
  roomLayer: LayerId,
  contLayer: LayerId,
  annLayer: LayerId,
) => {
  // Building footprint: 12 m × 8 m. Five rooms separated by a central
  // east–west corridor. Doorway gaps are baked into the wall polylines.
  // Wall thicknesses: 200mm exterior, 150mm interior. Walls are 3m tall.

  // ---- Rooms (drawn first so walls overlay their borders) ----
  add(p, sheetId, room(roomLayer, { x: 0,     y: 4600 }, { x: 5800,  y: 8000 }, 'MCC Room',   '#a8b8c4'));
  add(p, sheetId, room(roomLayer, { x: 6200,  y: 4600 }, { x: 12000, y: 8000 }, 'Plant Room', '#b8c0a8'));
  add(p, sheetId, room(roomLayer, { x: 0,     y: 2500 }, { x: 12000, y: 4500 }, 'Corridor',   '#c2c6ca'));
  add(p, sheetId, room(roomLayer, { x: 0,     y: 0    }, { x: 5800,  y: 2400 }, 'Office',     '#c2bca8'));
  add(p, sheetId, room(roomLayer, { x: 6200,  y: 0    }, { x: 12000, y: 2400 }, 'Equipment',  '#b8a8b8'));

  // ---- External perimeter wall (closed polyline, 200mm thick) ----
  add(p, sheetId, wall(wallLayer, [
    { x: 0,     y: 0    },
    { x: 12000, y: 0    },
    { x: 12000, y: 8000 },
    { x: 0,     y: 8000 },
    { x: 0,     y: 0    },
  ], 200));

  // ---- North corridor wall (two doorway openings, 150mm thick) ----
  add(p, sheetId, wall(wallLayer, [{ x: 0,    y: 4500 }, { x: 3000,  y: 4500 }], 150));
  add(p, sheetId, wall(wallLayer, [{ x: 4000, y: 4500 }, { x: 8200,  y: 4500 }], 150));
  add(p, sheetId, wall(wallLayer, [{ x: 9200, y: 4500 }, { x: 12000, y: 4500 }], 150));

  // ---- South corridor wall (two doorway openings) ----
  add(p, sheetId, wall(wallLayer, [{ x: 0,    y: 2500 }, { x: 2000,  y: 2500 }], 150));
  add(p, sheetId, wall(wallLayer, [{ x: 3000, y: 2500 }, { x: 8200,  y: 2500 }], 150));
  add(p, sheetId, wall(wallLayer, [{ x: 9200, y: 2500 }, { x: 12000, y: 2500 }], 150));

  // ---- Top divider between MCC and Plant ----
  add(p, sheetId, wall(wallLayer, [{ x: 6000, y: 4500 }, { x: 6000, y: 8000 }], 150));
  // ---- Bottom divider between Office and Equipment ----
  add(p, sheetId, wall(wallLayer, [{ x: 6000, y: 0    }, { x: 6000, y: 2500 }], 150));

  // ---- Containment routes ----
  // All cross-section sizes in mm. Runs hang at ceiling elevations
  // configured in Panel3D BUILDING_ELEVATION (trunking 2700, basket 2400,
  // tray 2100, conduit 1800).

  // Main trunking spine fed from the MCC, running east along the corridor.
  add(p, sheetId, containment(
    contLayer,
    'trunking',
    [
      { x: 3500,  y: 6000 },   // origin inside MCC Room
      { x: 3500,  y: 3800 },   // drops through doorway into corridor
      { x: 11400, y: 3800 },   // runs east along corridor
    ],
    400, 250,
    COLOR.trunking,
  ));

  // Cable basket parallel to the trunking, picking up smaller circuits.
  add(p, sheetId, containment(
    contLayer,
    'basket',
    [
      { x: 600,   y: 3400 },
      { x: 11400, y: 3400 },
    ],
    300, 100,
    COLOR.basket,
  ));

  // Tray for low-voltage / data running along the corridor.
  add(p, sheetId, containment(
    contLayer,
    'tray',
    [
      { x: 600,   y: 3000 },
      { x: 11400, y: 3000 },
    ],
    400, 80,
    COLOR.tray,
  ));

  // Conduit drops to each room — some through doorways, some punching
  // through walls (the 3D view automatically cuts holes where needed).
  // To Plant Room (through the north corridor wall — wall cutout)
  add(p, sheetId, containment(
    contLayer,
    'conduit',
    [
      { x: 7000, y: 3800 },
      { x: 7000, y: 6000 },
    ],
    80, undefined, COLOR.conduit,
  ));
  // To Office (through doorway gap)
  add(p, sheetId, containment(
    contLayer,
    'conduit',
    [
      { x: 2500, y: 3400 },
      { x: 2500, y: 1200 },
    ],
    80, undefined, COLOR.conduit,
  ));
  // To Equipment Room (through doorway gap)
  add(p, sheetId, containment(
    contLayer,
    'conduit',
    [
      { x: 8700, y: 3000 },
      { x: 8700, y: 1200 },
    ],
    100, undefined, COLOR.conduit,
  ));
  // Cross-link between Office and Equipment (through divider wall — cutout)
  add(p, sheetId, containment(
    contLayer,
    'conduit',
    [
      { x: 4500, y: 1200 },
      { x: 7500, y: 1200 },
    ],
    80, undefined, COLOR.conduit,
  ));

  // Title (top-left of sheet)
  add(p, sheetId, text(annLayer, 200, 7700, 'BUILDING — CONTAINMENT PLAN', 80));
  add(p, sheetId, text(annLayer, 200, 7540, 'Walls · Rooms · Trunking · Basket · Tray · Conduit', 40));
};
