// Multi-floor / multi-building 3D scene assembly.
//
// Walks the project's site / building / floor / zone hierarchy and emits
// one Group per floor, positioned at floor.ffl, populated by walls,
// rooms, containment, fittings, supports, equipment and risers. The
// returned SceneControls let the caller isolate a floor, filter by
// system, and tweak per-layer transparency.
//
// This module is independent of Panel3D — Panel3D continues to render
// the legacy panel/building scene; BuildingScene renders the new
// whole-site view. Both can co-exist.

import * as THREE from 'three';
import type {
  Project,
  Sheet,
  Entity,
  ContainmentEntity,
  FittingEntity,
  SupportEntity,
  EquipmentEntity,
  RiserEntity,
  WallEntity,
  RoomEntity,
} from '../types';
import type { Floor, Building, FloorId, SystemId } from '../models/site';
import { renderContainment3D, type RenderOpts as ContainmentRenderOpts } from './ContainmentRender3D';
import { renderFitting3D } from './FittingRender3D';
import { renderSupport3D } from './SupportRender3D';
import { renderEquipment3D } from './EquipmentRender3D';
import { defaultElevation } from './elevations';

// ---------- Public API ------------------------------------------------------

export interface BuildSceneOptions {
  /** Material palette overrides (per-system colours, per-material look). */
  materials?: ContainmentRenderOpts['materials'];
  /** Skip rendering elements outside of these floors. */
  visibleFloors?: Set<FloorId>;
  /** Per-entity systemId resolver; lets the caller tag colours by system. */
  systemIdFor?: (e: Entity) => SystemId | undefined;
  /** Convert CAD-y to scene-y. Defaults to "no flip" — pass H if your
   *  entities use screen-down y like Panel3D. */
  flipY?: number;
  /** Render walls / rooms / equipment / containment etc. Default: all true. */
  layers?: Partial<Record<SceneLayer, boolean>>;
}

export type SceneLayer =
  | 'walls'
  | 'rooms'
  | 'containment'
  | 'fittings'
  | 'supports'
  | 'equipment'
  | 'risers'
  | 'floors'
  | 'labels';

export interface SceneControls {
  /** Show only one floor; pass null to show all. */
  isolateFloor(floorId: FloorId | null): void;
  /** Hide all containment runs not on the given system; null to show all. */
  filterSystem(systemId: SystemId | null): void;
  /** Set per-layer transparency 0..1. */
  setTransparency(layer: SceneLayer, opacity: number): void;
  /** Dispose all geometry / materials owned by the scene. */
  dispose(): void;
}

interface FloorGroupInfo {
  floor: Floor;
  group: THREE.Group;
  systemMap: Map<string, SystemId | undefined>; // entityId -> systemId
}

// ---------- Helpers ---------------------------------------------------------

function tag(obj: THREE.Object3D, entityId: string): void {
  obj.userData.entityId = entityId;
  obj.traverse((child) => { child.userData.entityId = entityId; });
}

function gatherSheetEntities(project: Project, sheetIds: string[]): Entity[] {
  const out: Entity[] = [];
  for (const sid of sheetIds) {
    const sheet: Sheet | undefined = project.sheets[sid];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e) out.push(e);
    }
  }
  return out;
}

function buildWallGroup(walls: WallEntity[], flipY?: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'walls';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xeceeef,
    metalness: 0.0,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  for (const w of walls) {
    if (!w.points || w.points.length < 2) continue;
    const thickness = w.thickness ?? 200;
    const wallH = w.height ?? 3000;
    const grp = new THREE.Group();
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      const ay = flipY != null ? flipY - a.y : a.y;
      const by = flipY != null ? flipY - b.y : b.y;
      const dx = b.x - a.x;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, wallH), mat);
      seg.position.set((a.x + b.x) / 2, (ay + by) / 2, wallH / 2);
      seg.rotation.z = Math.atan2(dy, dx);
      seg.castShadow = true;
      seg.receiveShadow = true;
      grp.add(seg);
    }
    tag(grp, w.id);
    root.add(grp);
  }
  return root;
}

function buildRoomGroup(rooms: RoomEntity[], flipY?: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'rooms';
  for (const r of rooms) {
    const xMin = Math.min(r.a.x, r.b.x);
    const xMax = Math.max(r.a.x, r.b.x);
    const yMin = Math.min(r.a.y, r.b.y);
    const yMax = Math.max(r.a.y, r.b.y);
    const w = xMax - xMin;
    const d = yMax - yMin;
    if (w < 1e-3 || d < 1e-3) continue;
    const colour = r.floorColor ? new THREE.Color(r.floorColor).getHex() : 0xb6c1cc;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, d, 6),
      new THREE.MeshStandardMaterial({ color: colour, metalness: 0.0, roughness: 0.85 }),
    );
    const cy = flipY != null ? flipY - (yMin + yMax) / 2 : (yMin + yMax) / 2;
    slab.position.set((xMin + xMax) / 2, cy, 3);
    slab.receiveShadow = true;
    tag(slab, r.id);
    root.add(slab);
  }
  return root;
}

function buildFloorSlab(floor: Floor, extent: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd6dadf, metalness: 0.0, roughness: 0.85,
  });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(extent, extent, floor.slabThickness ?? 150),
    mat,
  );
  slab.position.z = -((floor.slabThickness ?? 150) / 2);
  slab.receiveShadow = true;
  slab.userData.layer = 'floors';
  return slab;
}

// ---------- Riser builder ---------------------------------------------------

function buildRiser(
  r: RiserEntity,
  fromZ: number,
  toZ: number,
  flipY?: number,
): THREE.Object3D {
  const grp = new THREE.Group();
  grp.name = `riser:${r.id}`;
  const w = r.width || 100;
  const h = r.height || 100;
  const span = Math.max(50, Math.abs(toZ - fromZ));
  const isConduit = r.containmentType === 'conduit';
  const colour = r.color ? new THREE.Color(r.color).getHex() : 0x8a8e94;
  const mat = new THREE.MeshStandardMaterial({
    color: colour, metalness: 0.6, roughness: 0.4,
  });
  const py = flipY != null ? flipY - r.position.y : r.position.y;
  if (isConduit) {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(w / 2, w / 2, span, 16),
      mat,
    );
    tube.position.set(r.position.x, py, (fromZ + toZ) / 2);
    tube.castShadow = true;
    grp.add(tube);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, span), mat);
    box.position.set(r.position.x, py, (fromZ + toZ) / 2);
    box.castShadow = true;
    grp.add(box);
  }
  tag(grp, r.id);
  return grp;
}

// ---------- Floor renderer --------------------------------------------------

function renderFloor(
  project: Project,
  floor: Floor,
  options: BuildSceneOptions,
): FloorGroupInfo {
  const grp = new THREE.Group();
  grp.name = `floor:${floor.id}`;
  grp.position.z = floor.ffl;
  grp.userData.floorId = floor.id;

  const layers = options.layers ?? {};
  const wantWalls = layers.walls !== false;
  const wantRooms = layers.rooms !== false;
  const wantContainment = layers.containment !== false;
  const wantFittings = layers.fittings !== false;
  const wantSupports = layers.supports !== false;
  const wantEquipment = layers.equipment !== false;
  const wantFloor = layers.floors !== false;

  const entities = gatherSheetEntities(project, floor.sheetIds);
  const walls: WallEntity[] = [];
  const rooms: RoomEntity[] = [];
  const containments: ContainmentEntity[] = [];
  const fittings: FittingEntity[] = [];
  const supports: SupportEntity[] = [];
  const equipment: EquipmentEntity[] = [];

  for (const e of entities) {
    if (!e.visible) continue;
    switch (e.kind) {
      case 'wall': walls.push(e); break;
      case 'room': rooms.push(e); break;
      case 'containment': containments.push(e); break;
      case 'fitting': fittings.push(e); break;
      case 'support': supports.push(e); break;
      case 'equipment': equipment.push(e); break;
      default: break;
    }
  }

  const containmentMap = new Map<string, ContainmentEntity>();
  for (const c of containments) containmentMap.set(c.id, c);

  // Build each layer as a sub-group so SceneControls can toggle them.
  if (wantFloor) {
    grp.add(buildFloorSlab(floor, 60000));
  }
  if (wantWalls) grp.add(buildWallGroup(walls, options.flipY));
  if (wantRooms) grp.add(buildRoomGroup(rooms, options.flipY));

  const systemMap = new Map<string, SystemId | undefined>();

  if (wantContainment) {
    const cgrp = new THREE.Group();
    cgrp.name = 'containment';
    for (const c of containments) {
      const systemId = options.systemIdFor?.(c);
      systemMap.set(c.id, systemId);
      const obj = renderContainment3D(c, {
        materials: options.materials,
        systemId,
        floor,
        flipY: options.flipY,
      });
      obj.userData.systemId = systemId;
      cgrp.add(obj);
    }
    grp.add(cgrp);
  }

  if (wantFittings) {
    const fgrp = new THREE.Group();
    fgrp.name = 'fittings';
    for (const f of fittings) {
      const parent = containmentMap.get(f.containmentId);
      const baseZ = parent
        ? defaultElevation(parent, floor) + (parent.height ?? 50) / 2
        : 2400;
      const obj = renderFitting3D(f, {
        parent,
        materials: options.materials,
        systemId: parent ? options.systemIdFor?.(parent) : undefined,
      });
      obj.position.z = baseZ;
      // Adjust position from fitting.position with optional Y flip
      const fy = options.flipY != null ? options.flipY - f.position.y : f.position.y;
      obj.position.set(f.position.x, fy, baseZ);
      obj.userData.systemId = parent ? options.systemIdFor?.(parent) : undefined;
      fgrp.add(obj);
    }
    grp.add(fgrp);
  }

  if (wantSupports) {
    const sgrp = new THREE.Group();
    sgrp.name = 'supports';
    for (const s of supports) {
      // Find the containment this support carries to know the bottom-Z.
      let bottomZ: number | undefined;
      const cid = s.supportingContainmentIds?.[0];
      if (cid) {
        const c = containmentMap.get(cid);
        if (c) bottomZ = defaultElevation(c, floor);
      }
      const obj = renderSupport3D(s, { containmentBottomZ: bottomZ ?? 2400 });
      const sy = options.flipY != null ? options.flipY - s.position.y : s.position.y;
      obj.position.set(s.position.x, sy, 0);
      sgrp.add(obj);
    }
    grp.add(sgrp);
  }

  if (wantEquipment) {
    const egrp = new THREE.Group();
    egrp.name = 'equipment';
    for (const eq of equipment) {
      egrp.add(renderEquipment3D(eq, { flipY: options.flipY }));
    }
    grp.add(egrp);
  }

  return { floor, group: grp, systemMap };
}

// ---------- Public entry point ---------------------------------------------

/**
 * Build the whole-site 3D scene from a project. Returns a Group for
 * adding to the scene plus a SceneControls handle for runtime toggles.
 */
export function buildBuildingScene(
  project: Project,
  options: BuildSceneOptions = {},
): { group: THREE.Group; controls: SceneControls } {
  const root = new THREE.Group();
  root.name = 'site';

  const floorInfos: FloorGroupInfo[] = [];

  // Build each building as a sub-group, positioned at gridOriginX/Y.
  const buildings: Record<string, Building> = project.buildings ?? {};
  const buildingIds = project.activeSiteId
    ? project.sites?.[project.activeSiteId]?.buildingOrder ?? Object.keys(buildings)
    : Object.keys(buildings);

  for (const bid of buildingIds) {
    const b = buildings[bid];
    if (!b) continue;
    const bgrp = new THREE.Group();
    bgrp.name = `building:${bid}`;
    bgrp.position.set(b.gridOriginX ?? 0, b.gridOriginY ?? 0, 0);
    for (const fid of b.floorOrder) {
      const floor = project.floors?.[fid];
      if (!floor) continue;
      if (options.visibleFloors && !options.visibleFloors.has(fid)) continue;
      const info = renderFloor(project, floor, options);
      floorInfos.push(info);
      bgrp.add(info.group);
    }
    root.add(bgrp);
  }

  // Risers — gathered project-wide, then placed by their from/to floor.
  const risers: RiserEntity[] = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const eid of sheet.entityOrder) {
      const e = sheet.entities[eid];
      if (e?.kind === 'riser' && e.visible) risers.push(e);
    }
  }
  if ((options.layers?.risers ?? true) && risers.length > 0) {
    const rgrp = new THREE.Group();
    rgrp.name = 'risers';
    for (const r of risers) {
      const fromFloor = r.fromFloorId ? project.floors?.[r.fromFloorId] : undefined;
      const toFloor = r.toFloorId ? project.floors?.[r.toFloorId] : undefined;
      const fromZ = r.fromElevation ?? fromFloor?.ffl ?? 0;
      const toZ = r.toElevation ?? toFloor?.ffl ?? fromZ + 3000;
      rgrp.add(buildRiser(r, fromZ, toZ, options.flipY));
    }
    root.add(rgrp);
  }

  // ---------- Controls ----------
  const layerOpacity = new Map<SceneLayer, number>();

  const setLayerOpacity = (layer: SceneLayer, opacity: number): void => {
    layerOpacity.set(layer, opacity);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Identify the layer by walking up the parent chain
        let p: THREE.Object3D | null = obj;
        let foundLayer: SceneLayer | null = null;
        while (p) {
          if (p.name === layer) { foundLayer = layer; break; }
          if (p.userData.layer === layer) { foundLayer = layer; break; }
          p = p.parent;
        }
        if (foundLayer === layer) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (m && 'opacity' in m) {
              (m as THREE.Material).transparent = opacity < 1;
              (m as THREE.Material).opacity = opacity;
              (m as THREE.Material).needsUpdate = true;
            }
          }
        }
      }
    });
  };

  const isolateFloor = (floorId: FloorId | null): void => {
    for (const info of floorInfos) {
      info.group.visible = floorId == null || info.floor.id === floorId;
    }
  };

  const filterSystem = (systemId: SystemId | null): void => {
    for (const info of floorInfos) {
      const cgrp = info.group.getObjectByName('containment');
      const fgrp = info.group.getObjectByName('fittings');
      for (const grp of [cgrp, fgrp]) {
        if (!grp) continue;
        for (const child of grp.children) {
          const sid = child.userData.systemId as SystemId | undefined;
          child.visible = systemId == null || sid === systemId;
        }
      }
    }
  };

  const dispose = (): void => {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose?.();
      } else if (obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.SpriteMaterial | undefined;
        mat?.map?.dispose?.();
        mat?.dispose?.();
      } else if (obj instanceof THREE.Line) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m?.dispose?.();
      }
    });
  };

  return {
    group: root,
    controls: {
      isolateFloor,
      filterSystem,
      setTransparency: setLayerOpacity,
      dispose,
    },
  };
}
