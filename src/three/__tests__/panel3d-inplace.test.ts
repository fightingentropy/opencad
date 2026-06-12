import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ContainmentEntity, Vec2, WireEntity } from '../../types';
import {
  buildContainmentGroup,
  buildMaterials,
  buildWireMesh,
  updateContainmentGroupInPlace,
  updateWireGeometryInPlace,
} from '../Panel3D';

const H = 400;

function wire(points: Vec2[]): WireEntity {
  return {
    id: 'w1',
    kind: 'wire',
    layerId: 'wires',
    visible: true,
    locked: false,
    points,
  };
}

function trunking(points: Vec2[]): ContainmentEntity {
  return {
    id: 'c1',
    kind: 'containment',
    layerId: 'containment',
    visible: true,
    locked: false,
    containmentType: 'trunking',
    points,
    width: 50,
    height: 50,
  };
}

describe('updateWireGeometryInPlace', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 50 },
  ];

  it('rewrites positions in the existing geometry on a point drag', () => {
    const mesh = buildWireMesh(wire(pts), H);
    expect(mesh).not.toBeNull();
    const geom = mesh!.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const before = Float32Array.from(posAttr.array as Float32Array);

    const moved = wire([pts[0], { x: 100, y: 25 }, pts[2]]);
    expect(updateWireGeometryInPlace(mesh!, moved, H)).toBe(true);

    // Same geometry + attribute objects — no rebuild happened.
    expect(mesh!.geometry).toBe(geom);
    expect(geom.getAttribute('position')).toBe(posAttr);
    // Positions actually changed and were flagged for re-upload.
    expect(Array.from(posAttr.array as Float32Array)).not.toEqual(
      Array.from(before)
    );
    expect(posAttr.version).toBeGreaterThan(0);
    // Bounds were recomputed.
    expect(geom.boundingBox).not.toBeNull();
    expect(geom.boundingSphere).not.toBeNull();

    // The in-place result must match a from-scratch build exactly.
    const fresh = buildWireMesh(moved, H)!;
    const freshPos = fresh.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    expect(Array.from(posAttr.array as Float32Array)).toEqual(
      Array.from(freshPos.array as Float32Array)
    );
  });

  it('refuses a point-count (topology) change', () => {
    const mesh = buildWireMesh(wire(pts), H)!;
    const grew = wire([...pts, { x: 300, y: 0 }]);
    expect(updateWireGeometryInPlace(mesh, grew, H)).toBe(false);
  });
});

describe('updateContainmentGroupInPlace', () => {
  const basePts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];
  const baseZ = 30;

  it('re-poses per-segment wraps without touching geometry', () => {
    const mats = buildMaterials();
    const grp = buildContainmentGroup(trunking(basePts), H, mats, baseZ);
    expect(grp).not.toBeNull();
    expect(grp!.children.length).toBe(2);
    const wrap0 = grp!.children[0];
    const wrap1 = grp!.children[1];
    const geo0 = (wrap0.children[0] as THREE.Mesh).geometry;

    // Drag the middle point from (100,0) to (120,0).
    const moved = trunking([basePts[0], { x: 120, y: 0 }, basePts[2]]);
    expect(updateContainmentGroupInPlace(grp!, moved, H, baseZ)).toBe(true);

    // Geometry object identity preserved — nothing was rebuilt.
    expect((grp!.children[0].children[0] as THREE.Mesh).geometry).toBe(geo0);

    // Segment 0: (0,0)->(120,0) ⇒ center (60, H), stretched 120/100.
    expect(wrap0.position.x).toBeCloseTo(60);
    expect(wrap0.position.y).toBeCloseTo(H);
    expect(wrap0.position.z).toBeCloseTo(baseZ + 25);
    expect(wrap0.rotation.z).toBeCloseTo(0);
    expect(wrap0.scale.x).toBeCloseTo(1.2);

    // Segment 1: (120,0)->(100,80) in panel coords (y flipped).
    const len1 = Math.hypot(100 - 120, 80 - 0);
    expect(wrap1.position.x).toBeCloseTo(110);
    expect(wrap1.position.y).toBeCloseTo(H - 40);
    expect(wrap1.rotation.z).toBeCloseTo(Math.atan2(-80, -20));
    expect(wrap1.scale.x).toBeCloseTo(len1 / 80);

    mats.dispose();
  });

  it('refuses when a segment collapses below the degeneracy threshold', () => {
    const mats = buildMaterials();
    const grp = buildContainmentGroup(trunking(basePts), H, mats, baseZ)!;
    const collapsed = trunking([basePts[0], { x: 0, y: 0 }, basePts[2]]);
    expect(updateContainmentGroupInPlace(grp, collapsed, H, baseZ)).toBe(
      false
    );
    mats.dispose();
  });

  it('places conduit at baseZ + radius', () => {
    const mats = buildMaterials();
    const conduit: ContainmentEntity = {
      ...trunking([basePts[0], basePts[1]]),
      containmentType: 'conduit',
      width: 20,
    };
    const grp = buildContainmentGroup(conduit, H, mats, baseZ)!;
    const moved = { ...conduit, points: [{ x: 0, y: 0 }, { x: 150, y: 0 }] };
    expect(updateContainmentGroupInPlace(grp, moved, H, baseZ)).toBe(true);
    expect(grp.children[0].position.z).toBeCloseTo(baseZ + 10);
    expect(grp.children[0].scale.x).toBeCloseTo(1.5);
    mats.dispose();
  });
});
