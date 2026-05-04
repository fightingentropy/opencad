// Auto-generate a trapeze-hanger installation detail. Outputs front and
// side elevation views of a typical drop-rod + horizontal channel +
// containment combo, dimensioned per BS EN 61537.
//
// Like the fire-stop detail, entities are positioned around a working
// origin so the caller can place the result anywhere on a detail sheet.

import { nanoid } from 'nanoid';
import type {
  ContainmentEntity,
  DimensionEntity,
  Entity,
  LeaderEntity,
  LineEntity,
  RectangleEntity,
  SupportEntity,
  TextEntity,
} from '../../types';

const LAYER_ANN = 'Annotation';
const LAYER_DIM = 'Dimensions';

const newId = () => nanoid(10);

// View dimensions in mm at 1:1.
const FRONT_W = 200; // total drop width (rod-to-rod span)
const FRONT_H = 220; // height from channel up to ceiling fix
const SIDE_W = 80; // depth of containment in side view
const VIEW_GAP = 40;

// Typical sizes.
const ROD_DIAMETER = 10; // M10 threaded rod
const CHANNEL_DEPTH = 41; // 41x21 unistrut style channel

export const generateTrapezeDetail = (
  support: SupportEntity,
  containment: ContainmentEntity,
): Entity[] => {
  const out: Entity[] = [];

  // Origin = lower-left of front view.
  const ox = 0;
  const oy = 0;

  // Containment cross-section sizing — width and height of the duct
  // sitting on top of the channel.
  const cWidth = containment.width ?? 100;
  const cHeight = containment.height ?? 50;

  // Channel sized to span the containment with 100mm overhang each side.
  const channelLength =
    support.channelLength ?? Math.max(FRONT_W, cWidth + 200);

  // Drop-rod length — top of channel to ceiling fix.
  const rodLength = support.rodLength ?? FRONT_H - CHANNEL_DEPTH;

  // -------- Front view ----------------------------------------------------
  // Centerline of the front view.
  const frontCx = ox + channelLength / 2;
  // Channel sits at y = oy. Containment sits on top of channel.
  const channelY0 = oy + rodLength;
  const channelY1 = channelY0 + CHANNEL_DEPTH;

  // Channel outline.
  out.push(rect(ox, channelY0, ox + channelLength, channelY1));

  // Containment cross-section centred on channel.
  const contX0 = frontCx - cWidth / 2;
  const contX1 = frontCx + cWidth / 2;
  const contY0 = channelY1;
  const contY1 = channelY1 + cHeight;
  out.push(rect(contX0, contY0, contX1, contY1));

  // Two threaded rods — one each side, set in 50mm from channel ends.
  const rodInset = 50;
  const rodLeftX = ox + rodInset;
  const rodRightX = ox + channelLength - rodInset;
  out.push(...rod(rodLeftX, oy, channelY0));
  out.push(...rod(rodRightX, oy, channelY0));

  // Solid ceiling line spanning the rod tops.
  out.push(
    line(
      { x: rodLeftX - 20, y: oy + rodLength },
      { x: rodRightX + 20, y: oy + rodLength },
    ),
  );
  // Hatched ceiling band — rendered as short ticks for now.
  for (let x = rodLeftX - 20; x <= rodRightX + 20; x += 8) {
    out.push(
      line(
        { x, y: oy + rodLength },
        { x: x + 4, y: oy + rodLength + 4 },
      ),
    );
  }

  // Drop-rod brackets — small triangles connecting rod to channel.
  // Just a couple of vertical ticks on each end of the channel.
  out.push(
    line(
      { x: rodLeftX - 8, y: channelY0 - 3 },
      { x: rodLeftX + 8, y: channelY0 - 3 },
    ),
  );
  out.push(
    line(
      { x: rodRightX - 8, y: channelY0 - 3 },
      { x: rodRightX + 8, y: channelY0 - 3 },
    ),
  );

  // Dimensions on the front view.
  out.push(
    dim({ x: ox, y: channelY1 }, { x: ox + channelLength, y: channelY1 }, 18, `${channelLength}`),
  );
  out.push(
    dim({ x: rodLeftX, y: oy }, { x: rodLeftX, y: channelY0 }, -20, `${rodLength}`),
  );
  out.push(
    dim({ x: contX0, y: contY1 }, { x: contX1, y: contY1 }, 8, `${cWidth}`),
  );

  // Front-view label.
  out.push(label('FRONT VIEW', frontCx, oy - 18, 'center'));

  // -------- Side view -----------------------------------------------------
  const sideOx = ox + channelLength + VIEW_GAP;
  // Side view shares channel-Y / containment-Y with front view.
  // Channel cross-section on the side: just the depth × thickness rectangle.
  const sideChannelX0 = sideOx + (SIDE_W - 60) / 2;
  const sideChannelX1 = sideChannelX0 + 60;
  out.push(rect(sideChannelX0, channelY0, sideChannelX1, channelY1));

  // Containment seen from the end — width = cHeight, depth visible.
  const sideContX0 = sideOx + (SIDE_W - cHeight) / 2;
  const sideContX1 = sideContX0 + cHeight;
  out.push(rect(sideContX0, contY0, sideContX1, contY1));

  // One drop rod centred on the side view.
  const sideRodX = sideOx + SIDE_W / 2;
  out.push(...rod(sideRodX, oy, channelY0));
  // Ceiling line.
  out.push(
    line(
      { x: sideOx - 10, y: oy + rodLength },
      { x: sideOx + SIDE_W + 10, y: oy + rodLength },
    ),
  );

  // Side-view dimension — containment depth.
  out.push(
    dim(
      { x: sideContX0, y: contY1 },
      { x: sideContX1, y: contY1 },
      8,
      `${cHeight}`,
    ),
  );

  // Side-view label.
  out.push(label('SIDE VIEW', sideOx + SIDE_W / 2, oy - 18, 'center'));

  // -------- Leader callout -------------------------------------------------
  const leaderText = [
    `${support.supportKind ?? 'trapeze'} hanger`,
    `M${ROD_DIAMETER} threaded rod`,
    support.safeWorkingLoadKg
      ? `SWL ${support.safeWorkingLoadKg}kg`
      : '',
    support.anchorType ? `${support.anchorType} anchor` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const leaderTip = { x: rodRightX + 4, y: (channelY0 + oy + rodLength) / 2 };
  const leaderElbow = {
    x: rodRightX + 40,
    y: leaderTip.y + 30,
  };
  const leaderEnd = { x: leaderElbow.x + 60, y: leaderElbow.y };
  const leader: LeaderEntity = {
    id: newId(),
    kind: 'leader',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    points: [leaderTip, leaderElbow, leaderEnd],
    text: leaderText,
    fontSize: 2.4,
    arrowStyle: 'arrow',
    targetEntityId: support.id,
  };
  out.push(leader);

  // Title strip across both views.
  out.push(
    label(
      `TRAPEZE SUPPORT DETAIL`,
      (ox + sideOx + SIDE_W) / 2,
      oy - 32,
      'center',
      4,
    ),
  );

  return out;
};

// --- helpers --------------------------------------------------------------

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): RectangleEntity => ({
  id: newId(),
  kind: 'rectangle',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});

const line = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): LineEntity => ({
  id: newId(),
  kind: 'line',
  layerId: LAYER_ANN,
  visible: true,
  locked: false,
  a,
  b,
});

// Threaded rod = two parallel vertical lines at the rod diameter.
const rod = (cx: number, y0: number, y1: number): LineEntity[] => [
  {
    id: newId(),
    kind: 'line',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: cx - ROD_DIAMETER / 2, y: y0 },
    b: { x: cx - ROD_DIAMETER / 2, y: y1 },
  },
  {
    id: newId(),
    kind: 'line',
    layerId: LAYER_ANN,
    visible: true,
    locked: false,
    a: { x: cx + ROD_DIAMETER / 2, y: y0 },
    b: { x: cx + ROD_DIAMETER / 2, y: y1 },
  },
];

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
