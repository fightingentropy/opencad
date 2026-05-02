import { useStore } from '../state/store';
import type { WireEntity, Vec2 } from '../types';
import { dist } from '../lib/math';

// Auto-generate wire numbers for all wires in the active sheet.
// Connected wires (sharing endpoints within tolerance) get the same number.
export const autoNumberWires = (): void => {
  const state = useStore.getState();
  const project = state.project;
  const sheet = project.sheets[project.activeSheetId];

  // Build a graph: wires are nodes, edges if they share a near-endpoint
  const wires: WireEntity[] = [];
  for (const id of sheet.entityOrder) {
    const e = sheet.entities[id];
    if (e && e.kind === 'wire') wires.push(e);
  }
  if (wires.length === 0) return;

  // Union-find groups
  const parent = new Map<string, string>();
  for (const w of wires) parent.set(w.id, w.id);
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(x, cur);
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const tol = 0.5; // mm
  const samePoint = (a: Vec2, b: Vec2) => dist(a, b) < tol;

  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
      const a = wires[i];
      const b = wires[j];
      const aEnds = [a.points[0], a.points[a.points.length - 1]];
      const bEnds = [b.points[0], b.points[b.points.length - 1]];
      const overlap = aEnds.some((ae) => bEnds.some((be) => samePoint(ae, be))) ||
        a.points.some((ap) => b.points.some((bp) => samePoint(ap, bp)));
      if (overlap) union(a.id, b.id);
    }
  }

  // Group by root
  const groups = new Map<string, WireEntity[]>();
  for (const w of wires) {
    const r = find(w.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(w);
  }

  // Sort groups by lowest leftmost endpoint
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const ax = Math.min(...a.flatMap((w) => w.points.map((p) => p.x)));
    const bx = Math.min(...b.flatMap((w) => w.points.map((p) => p.x)));
    return ax - bx;
  });

  let next = 100;
  for (const grp of sortedGroups) {
    // Use existing tagged number if any wire in the group has one
    const existing = grp.map((w) => w.wireNumber).find((x) => x);
    const num = existing ?? String(next++);
    for (const w of grp) {
      if (w.wireNumber !== num) {
        state.updateEntity(w.id, { wireNumber: num } as Partial<WireEntity>);
      }
    }
  }
};
