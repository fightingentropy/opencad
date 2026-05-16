// Default elevations (mm above floor FFL) for containment runs.
//
// In real BIM models containment hangs at conventional heights above the
// finished floor — high-level trays just below the slab, basket below
// that, conduits wall-mounted at local services. These defaults match the
// hard-coded values in Panel3D's BUILDING_ELEVATION map but are aware of
// the floor's ceilingVoid / ceiling height for sites where 3 m floor
// heights aren't appropriate.

import type { ContainmentEntity, ContainmentType } from '../types';
import type { Floor } from '../models/site';

// Reference defaults (mm) for a nominal 3000 mm floor-to-floor height.
const DEFAULT_BY_TYPE: Record<ContainmentType, number> = {
  ladder: 2700,
  trunking: 2700,
  basket: 2400,
  tray: 2100,
  duct: 300, // floor / underground duct sits low
  busbar: 2700, // overhead busway
  conduit: 1800, // wall-mounted local drops, not high-level route spines
};

// Hint to pick a low-level / floor route — used by floor trunking/duct.
const LOW_LEVEL_SUBTYPES = new Set<string>([
  'floor',
  'skirting',
  'dado',
  'underground-duct',
  'cable-trench',
]);

/**
 * Pick a sensible Z elevation (mm above floor FFL) for a containment run.
 *
 *   1. If the entity has an explicit `elevation`, return it.
 *   2. Otherwise look up the per-type default.
 *   3. Apply subType / floor adjustments (wall conduit, low-level
 *      trunking, tight ceiling void, etc.).
 *
 * The returned value is the *bottom* of the containment cross-section
 * (so the renderer can stack runs by adding the height/2 itself).
 */
export function defaultElevation(
  containment: ContainmentEntity,
  floor?: Floor,
): number {
  if (typeof containment.elevation === 'number') {
    return containment.elevation;
  }

  const type = containment.containmentType;
  let z = DEFAULT_BY_TYPE[type] ?? 2200;

  // Conduit refinements ----------------------------------------------------
  if (type === 'conduit') {
    const sub = containment.subType ?? '';
    if (sub === 'flexible-metal' || sub === 'flexible-plastic') z = 1800;
  }

  // Low-level trunking / duct ---------------------------------------------
  if (LOW_LEVEL_SUBTYPES.has(containment.subType ?? '')) {
    z = type === 'duct' ? 100 : 150;
  }

  // Floor-aware refinement -------------------------------------------------
  // If we know the floor height, anchor ceiling-mounted runs to a constant
  // distance below the slab rather than the global default.
  if (floor) {
    const floorHeight = floor.floorHeight ?? 3000;
    const ceilingVoid = floor.ceilingVoid ?? 0;
    const slabUnderside = floorHeight - (floor.slabThickness ?? 0);
    const ceilingPlane = ceilingVoid > 0 ? slabUnderside - ceilingVoid : slabUnderside;

    // High-level routing — pin to just under the structure.
    const isHighLevelType =
      type === 'ladder' ||
      type === 'trunking' ||
      type === 'basket' ||
      type === 'tray' ||
      type === 'busbar';
    if (isHighLevelType) {
      // Treat 'tray' separately so TS narrowing keeps it in the union.
      const t: string = type;
      const offsetBelowSlab = t === 'tray' ? 600 : t === 'basket' ? 400 : 200;
      const candidate = slabUnderside - offsetBelowSlab;
      // Don't go higher than the ceiling plane if there's a finished ceiling.
      z = ceilingVoid > 0 ? Math.min(candidate, ceilingPlane - 50) : candidate;
    }
  }

  return Math.max(0, z);
}

/**
 * Convenience: bulk-resolve elevations for a list of containments. Useful
 * when the caller wants to sort runs top-down before rendering.
 */
export function elevationsFor(
  list: ContainmentEntity[],
  floor?: Floor,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of list) out.set(c.id, defaultElevation(c, floor));
  return out;
}
