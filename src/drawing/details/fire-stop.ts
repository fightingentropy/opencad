// Auto-generate a fire-stop installation detail. Produces a face-view
// (looking at the wall) plus a section-view (cut through the seal) with
// dimensioning and a leader callout to the seal product.
//
// All entities are returned with positions relative to the supplied
// (originX, originY) so the caller can drop the detail anywhere on a
// detail sheet without further math. Layer assignment uses placeholder
// IDs ('default') — caller is expected to remap to the destination
// drawing's layers (annotation, hatch, dim) before insertion.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  DimensionEntity,
  Entity,
  LeaderEntity,
  LineEntity,
  PolylineEntity,
  RectangleEntity,
  TextEntity,
  WallEntity,
} from '../../types';
import type { PenetrationSeal } from '../../models/fire';

// Layer IDs are remapped at insertion time. Until then we tag each
// entity so the caller's remap step knows which existing layer to
// retarget. These names match the default-layer set in src/state/store.
const LAYER_DIM = 'Dimensions';
const LAYER_ANN = 'Annotation';
const LAYER_HATCH = 'Construction';

const newId = () => nanoid(10);

// Pad / margin constants, all in mm at 1:1.
const FACE_VIEW_W = 80; // width of the face-view rectangle
const FACE_VIEW_H = 80; // height of the face-view rectangle
const SECTION_VIEW_W = 80;
const SECTION_VIEW_H = 30; // wall thickness illustration
const VIEW_GAP = 30; // horizontal gap between face & section view

// Hatch lines for showing intumescent / fire-resistant fill within the
// seal opening. Returns short 45° dashes filling the supplied rectangle.
const buildHatch = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing = 4,
): LineEntity[] => {
  const lines: LineEntity[] = [];
  const w = x1 - x0;
  const h = y1 - y0;
  // Diagonal hatch: every 'spacing' mm draw a 45° line clipped to the rect.
  // We sweep d (the perpendicular offset of the line) across the diagonal.
  const dMin = -h;
  const dMax = w;
  for (let d = dMin; d <= dMax; d += spacing) {
    // line: y - y0 = (x - x0) - d  =>  y = x - x0 - d + y0
    // intersections with the rect edges
    const intersections: { x: number; y: number }[] = [];
    // left edge x=x0
    {
      const y = x0 - x0 - d + y0;
      if (y >= y0 && y <= y1) intersections.push({ x: x0, y });
    }
    // right edge x=x1
    {
      const y = x1 - x0 - d + y0;
      if (y >= y0 && y <= y1) intersections.push({ x: x1, y });
    }
    // bottom edge y=y0
    {
      const x = y0 - y0 + d + x0;
      if (x >= x0 && x <= x1) intersections.push({ x, y: y0 });
    }
    // top edge y=y1
    {
      const x = y1 - y0 + d + x0;
      if (x >= x0 && x <= x1) intersections.push({ x, y: y1 });
    }
    if (intersections.length >= 2) {
      lines.push({
        id: newId(),
        kind: 'line',
        layerId: LAYER_HATCH,
        visible: true,
        locked: false,
        a: intersections[0],
        b: intersections[1],
      });
    }
  }
  return lines;
};

// Build the entity list. Caller drops it onto a detail sheet at
// (originX, originY) — typically the lower-left corner of a detail box.
export const generateFireStopDetail = (
  seal: PenetrationSeal,
  containment: ContainmentEntity,
  wall: WallEntity,
  originX: number,
  originY: number,
): Entity[] => {
  const out: Entity[] = [];

  const openingW = seal.openingWidth ?? containment.width ?? 100;
  const openingH = seal.openingHeight ?? containment.height ?? 50;
  const wallThickness = wall.thickness ?? 200;

  // -------- Face-view rectangle -------------------------------------------
  // Outer wall surface — the rectangle the reader is looking at.
  const faceX0 = originX;
  const faceY0 = originY;
  const faceX1 = faceX0 + FACE_VIEW_W;
  const faceY1 = faceY0 + FACE_VIEW_H;
  const faceRect: RectangleEntity = {
    id: newId(),
    kind: 'rectangle',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: faceX0, y: faceY0 },
    b: { x: faceX1, y: faceY1 },
  };
  out.push(faceRect);

  // Penetration opening centred on the face view.
  const openCx = (faceX0 + faceX1) / 2;
  const openCy = (faceY0 + faceY1) / 2;
  const openX0 = openCx - openingW / 2;
  const openY0 = openCy - openingH / 2;
  const openX1 = openCx + openingW / 2;
  const openY1 = openCy + openingH / 2;
  const openingRect: RectangleEntity = {
    id: newId(),
    kind: 'rectangle',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: openX0, y: openY0 },
    b: { x: openX1, y: openY1 },
  };
  out.push(openingRect);

  // Hatch the opening to indicate seal material.
  out.push(...buildHatch(openX0, openY0, openX1, openY1, 4));

  // Face-view label.
  out.push(label(`FACE VIEW`, (faceX0 + faceX1) / 2, faceY0 - 8, 'center'));

  // Dimension across the opening — width.
  out.push(
    dim({ x: openX0, y: openY0 }, { x: openX1, y: openY0 }, -10, `${openingW}`),
  );
  // Dimension across the opening — height.
  out.push(
    dim({ x: openX1, y: openY0 }, { x: openX1, y: openY1 }, 10, `${openingH}`),
  );

  // -------- Section-view rectangle ----------------------------------------
  const sectX0 = faceX1 + VIEW_GAP;
  const sectY0 = originY + (FACE_VIEW_H - SECTION_VIEW_H) / 2;
  const sectX1 = sectX0 + SECTION_VIEW_W;
  const sectY1 = sectY0 + SECTION_VIEW_H;

  // Wall body — drawn at scaled thickness within the section view.
  const wallBody: RectangleEntity = {
    id: newId(),
    kind: 'rectangle',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: sectX0, y: sectY0 },
    b: { x: sectX1, y: sectY1 },
  };
  out.push(wallBody);
  // Wall hatch to show construction (concrete / masonry pattern).
  out.push(...buildHatch(sectX0, sectY0, sectX1, sectY1, 5));

  // Penetration through the wall — a horizontal slot at mid-height.
  const sectOpenY0 = sectY0 + (SECTION_VIEW_H - openingH) / 2;
  const sectOpenY1 = sectOpenY0 + openingH;
  // Wider than the wall thickness on each side to show seal extending
  // beyond the wall surface.
  const sealOverrun = 6;
  const sectOpen: RectangleEntity = {
    id: newId(),
    kind: 'rectangle',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: sectX0 - sealOverrun, y: sectOpenY0 },
    b: { x: sectX1 + sealOverrun, y: sectOpenY1 },
  };
  out.push(sectOpen);
  out.push(
    ...buildHatch(
      sectX0 - sealOverrun,
      sectOpenY0,
      sectX1 + sealOverrun,
      sectOpenY1,
      3,
    ),
  );

  // Containment passing through — a thinner band representing the
  // service the seal is around.
  const cWidth = Math.min(openingH * 0.6, openingW * 0.6);
  const contY0 = (sectOpenY0 + sectOpenY1) / 2 - cWidth / 2;
  const contY1 = contY0 + cWidth;
  const containmentBand: PolylineEntity = {
    id: newId(),
    kind: 'polyline',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    points: [
      { x: sectX0 - sealOverrun - 12, y: (contY0 + contY1) / 2 },
      { x: sectX1 + sealOverrun + 12, y: (contY0 + contY1) / 2 },
    ],
    closed: false,
  };
  out.push(containmentBand);

  // Section-view label.
  out.push(label(`SECTION`, (sectX0 + sectX1) / 2, sectY0 - 8, 'center'));

  // Dimension across the wall thickness.
  out.push(
    dim(
      { x: sectX0, y: sectY1 },
      { x: sectX1, y: sectY1 },
      8,
      `${wallThickness}`,
    ),
  );

  // -------- Leader to the seal product ------------------------------------
  // Pull the leader from the section-view opening centre out to a label
  // sitting above the section.
  const leaderTip = { x: (sectX0 + sectX1) / 2, y: sectY1 - 1 };
  const leaderElbow = { x: (sectX0 + sectX1) / 2 + 25, y: sectY1 + 30 };
  const leaderEnd = { x: leaderElbow.x + 60, y: leaderElbow.y };
  const productLabel = [
    seal.reference,
    seal.sealType ?? 'composite seal',
    seal.productPartNumber ?? '',
    `${seal.requiredRating}min rated`,
  ]
    .filter(Boolean)
    .join('\n');
  const leader: LeaderEntity = {
    id: newId(),
    kind: 'leader',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    points: [leaderTip, leaderElbow, leaderEnd],
    text: productLabel,
    fontSize: 2.4,
    arrowStyle: 'arrow',
    targetEntityId: seal.id,
  };
  out.push(leader);

  // Title strip below both views.
  out.push(
    label(
      `FIRE STOP DETAIL — ${seal.reference}`,
      (faceX0 + sectX1) / 2,
      faceY0 - 22,
      'center',
      4,
    ),
  );

  return out;
};

// --- helpers --------------------------------------------------------------

const label = (
  text: string,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right' = 'left',
  size = 3,
): TextEntity => ({
  id: newId(),
  kind: 'text',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  position: { x, y },
  text,
  fontSize: size,
  rotation: 0,
  align,
});

const dim = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  offset: number,
  text?: string,
): DimensionEntity => ({
  id: newId(),
  kind: 'dimension',
  layerId: LAYER_DIM,
  visible: true,
  locked: false,
  a,
  b,
  offset,
  text,
});
