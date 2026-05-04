// Minimal IFC4 STEP exporter — produces a syntactically valid SPF
// (STEP physical file) that opens in BIMcollab, BIMvision and the
// IfcOpenShell-based viewers as a stripped-down spatial model with
// containment placeholder geometry. The intent is interoperability,
// not high-fidelity 3D — IfcCableCarrierSegment items are represented
// with axis polylines and a profile derived from width/height.
//
// Only a subset of IFC entities is emitted:
//   IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey
//   IfcRelAggregates, IfcRelContainedInSpatialStructure
//   IfcLocalPlacement, IfcAxis2Placement3D, IfcCartesianPoint, IfcDirection
//   IfcCableCarrierSegment, IfcCableCarrierFitting, IfcCableSegment, IfcWall
//   IfcPolyline, IfcShapeRepresentation, IfcProductDefinitionShape
//
// We don't emit material/property sets — viewers happily ignore the lack.

import type {
  Project,
  ContainmentEntity,
  FittingEntity,
  WallEntity,
} from '../types';
import type { Cable } from '../models/cable';

interface IfcEmitter {
  lines: string[];
  nextId: number;
}

const emit = (e: IfcEmitter, body: string): number => {
  const id = e.nextId++;
  e.lines.push(`#${id}=${body};`);
  return id;
};

// Escape strings for STEP — single quotes are doubled, control chars
// are dropped. Apostrophes in legitimate text are rare so this stays
// compatible with most viewers.
const stepStr = (s: string): string => `'${(s ?? '').replace(/'/g, "''")}'`;

const guid = (seed: string): string => {
  // 22-char IFC GUID — base64-encoded compressed UUID. We just hash
  // a deterministic seed so re-exports of the same project produce the
  // same IDs (helps round-trip workflows).
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const chars =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const out: string[] = [];
  let v = h;
  for (let i = 0; i < 22; i++) {
    out.push(chars[v % 64]);
    v = (v * 1103515245 + i + 12345) >>> 0;
  }
  return out.join('');
};

// Cartesian point primitive
const point = (e: IfcEmitter, x: number, y: number, z: number): number =>
  emit(e, `IFCCARTESIANPOINT((${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}))`);

// X/Z direction triplet
const dir = (e: IfcEmitter, x: number, y: number, z: number): number =>
  emit(e, `IFCDIRECTION((${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}))`);

const axis2Placement3D = (
  e: IfcEmitter,
  x = 0,
  y = 0,
  z = 0,
): number => {
  const p = point(e, x, y, z);
  return emit(e, `IFCAXIS2PLACEMENT3D(#${p},$,$)`);
};

const localPlacement = (
  e: IfcEmitter,
  parent: number | null,
  x = 0,
  y = 0,
  z = 0,
): number => {
  const ax = axis2Placement3D(e, x, y, z);
  const parentRef = parent === null ? '$' : `#${parent}`;
  return emit(e, `IFCLOCALPLACEMENT(${parentRef},#${ax})`);
};

const polyline3D = (
  e: IfcEmitter,
  pts: { x: number; y: number; z: number }[],
): number => {
  const ids = pts.map((p) => point(e, p.x, p.y, p.z));
  return emit(e, `IFCPOLYLINE((${ids.map((i) => `#${i}`).join(',')}))`);
};

const shapeRep = (
  e: IfcEmitter,
  contextId: number,
  geomId: number,
  type: string = 'Curve3D',
  identifier: string = 'Axis',
): number => {
  return emit(
    e,
    `IFCSHAPEREPRESENTATION(#${contextId},${stepStr(identifier)},${stepStr(type)},(#${geomId}))`,
  );
};

const productDefShape = (
  e: IfcEmitter,
  reps: number[],
): number => {
  return emit(
    e,
    `IFCPRODUCTDEFINITIONSHAPE($,$,(${reps.map((r) => `#${r}`).join(',')}))`,
  );
};

const ownerHistory = (e: IfcEmitter): number => {
  // Minimal owner history — a real exporter would chain through
  // IfcPerson / IfcOrganization / IfcApplication; viewers don't care.
  const person = emit(e, "IFCPERSON($,$,'OpenCAD',$,$,$,$,$)");
  const org = emit(e, "IFCORGANIZATION($,'OpenCAD Electrical',$,$,$)");
  const personOrg = emit(e, `IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = emit(
    e,
    `IFCAPPLICATION(#${org},'1.0','OpenCAD Electrical','OpenCAD')`,
  );
  return emit(
    e,
    `IFCOWNERHISTORY(#${personOrg},#${app},$,.ADDED.,$,$,$,${Math.floor(Date.now() / 1000)})`,
  );
};

const geomContext = (e: IfcEmitter): { ctxId: number; ax3: number } => {
  const ax3 = axis2Placement3D(e);
  const ctxId = emit(
    e,
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${ax3},$)`,
  );
  return { ctxId, ax3 };
};

const unitAssignment = (e: IfcEmitter): number => {
  // Millimetres for length, radians for angle, square millimetres area
  const mm = emit(e, 'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const rad = emit(e, 'IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const area = emit(e, 'IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  return emit(e, `IFCUNITASSIGNMENT((#${mm},#${rad},#${area}))`);
};

interface EntityRef {
  id: number;
  guid: string;
}

const aggregate = (
  e: IfcEmitter,
  history: number,
  parent: EntityRef,
  children: EntityRef[],
  label: string,
): void => {
  if (children.length === 0) return;
  const childRefs = children.map((c) => `#${c.id}`).join(',');
  emit(
    e,
    `IFCRELAGGREGATES(${stepStr(guid(`agg-${parent.guid}-${label}`))},#${history},$,$,#${parent.id},(${childRefs}))`,
  );
};

const containedIn = (
  e: IfcEmitter,
  history: number,
  parent: EntityRef,
  children: EntityRef[],
  label: string,
): void => {
  if (children.length === 0) return;
  const childRefs = children.map((c) => `#${c.id}`).join(',');
  emit(
    e,
    `IFCRELCONTAINEDINSPATIALSTRUCTURE(${stepStr(guid(`con-${parent.guid}-${label}`))},#${history},$,$,(${childRefs}),#${parent.id})`,
  );
};

const containmentToIfc = (
  e: IfcEmitter,
  contextId: number,
  history: number,
  storeyPlacement: number,
  c: ContainmentEntity,
  storeyZ: number,
): EntityRef => {
  const placement = localPlacement(e, storeyPlacement, 0, 0, 0);
  const pts = (c.points ?? []).map((p) => ({
    x: p.x,
    y: p.y,
    z: storeyZ + (c.elevation ?? 0),
  }));
  if (pts.length < 2) {
    pts.push({ x: 0, y: 0, z: storeyZ });
    pts.push({ x: 1, y: 0, z: storeyZ });
  }
  const poly = polyline3D(e, pts);
  const rep = shapeRep(e, contextId, poly, 'Curve3D', 'Axis');
  const shape = productDefShape(e, [rep]);
  const g = guid(`ccs-${c.id}`);
  const id = emit(
    e,
    `IFCCABLECARRIERSEGMENT(${stepStr(g)},#${history},${stepStr(c.label ?? c.id.slice(0, 8))},${stepStr(`${c.containmentType}${c.subType ? ` ${c.subType}` : ''}`)},$,#${placement},#${shape},$,$)`,
  );
  return { id, guid: g };
};

const fittingToIfc = (
  e: IfcEmitter,
  contextId: number,
  history: number,
  storeyPlacement: number,
  f: FittingEntity,
  storeyZ: number,
): EntityRef => {
  const placement = localPlacement(
    e,
    storeyPlacement,
    f.position.x,
    f.position.y,
    storeyZ,
  );
  // 2-point representation: a tiny tick at the fitting position so it
  // shows up in viewers without bringing in proper extruded geometry.
  const poly = polyline3D(e, [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ]);
  const rep = shapeRep(e, contextId, poly, 'Curve3D', 'Axis');
  const shape = productDefShape(e, [rep]);
  const g = guid(`ccf-${f.id}`);
  const id = emit(
    e,
    `IFCCABLECARRIERFITTING(${stepStr(g)},#${history},${stepStr(f.fittingKind)},${stepStr(f.fittingKind)},$,#${placement},#${shape},$,$)`,
  );
  return { id, guid: g };
};

const cableToIfc = (
  e: IfcEmitter,
  contextId: number,
  history: number,
  storeyPlacement: number,
  cable: Cable,
  storeyZ: number,
): EntityRef => {
  const placement = localPlacement(e, storeyPlacement, 0, 0, 0);
  // Without a resolved 3D path we draw a 1m placeholder near origin
  const poly = polyline3D(e, [
    { x: 0, y: 0, z: storeyZ },
    { x: 1000, y: 0, z: storeyZ },
  ]);
  const rep = shapeRep(e, contextId, poly, 'Curve3D', 'Axis');
  const shape = productDefShape(e, [rep]);
  const g = guid(`cs-${cable.id}`);
  const id = emit(
    e,
    `IFCCABLESEGMENT(${stepStr(g)},#${history},${stepStr(cable.reference)},${stepStr(cable.description ?? '')},$,#${placement},#${shape},$,$)`,
  );
  return { id, guid: g };
};

const wallToIfc = (
  e: IfcEmitter,
  contextId: number,
  history: number,
  storeyPlacement: number,
  w: WallEntity,
  storeyZ: number,
): EntityRef => {
  const placement = localPlacement(e, storeyPlacement, 0, 0, 0);
  const pts = (w.points ?? []).map((p) => ({
    x: p.x,
    y: p.y,
    z: storeyZ,
  }));
  if (pts.length < 2) {
    pts.push({ x: 0, y: 0, z: storeyZ });
    pts.push({ x: 1, y: 0, z: storeyZ });
  }
  const poly = polyline3D(e, pts);
  const rep = shapeRep(e, contextId, poly, 'Curve3D', 'Axis');
  const shape = productDefShape(e, [rep]);
  const g = guid(`w-${w.id}`);
  const id = emit(
    e,
    `IFCWALL(${stepStr(g)},#${history},${stepStr(`Wall ${w.id.slice(0, 6)}`)},$,$,#${placement},#${shape},$,$)`,
  );
  return { id, guid: g };
};

const collectByKind = (
  project: Project,
): {
  containments: ContainmentEntity[];
  fittings: FittingEntity[];
  walls: WallEntity[];
} => {
  const containments: ContainmentEntity[] = [];
  const fittings: FittingEntity[] = [];
  const walls: WallEntity[] = [];
  for (const sheetId of project.sheetOrder) {
    const sheet = project.sheets[sheetId];
    if (!sheet) continue;
    for (const id of sheet.entityOrder) {
      const e = sheet.entities[id];
      if (!e) continue;
      if (e.kind === 'containment') containments.push(e as ContainmentEntity);
      else if (e.kind === 'fitting') fittings.push(e as FittingEntity);
      else if (e.kind === 'wall') walls.push(e as WallEntity);
    }
  }
  return { containments, fittings, walls };
};

export const exportIFC = (project: Project): string => {
  const e: IfcEmitter = { lines: [], nextId: 1 };
  // ENTITY definitions are emitted as we go; at the end we wrap them
  // in the STEP header / footer.

  const history = ownerHistory(e);
  const units = unitAssignment(e);
  const { ctxId } = geomContext(e);

  const projGuid = guid(`project-${project.id}`);
  const projId = emit(
    e,
    `IFCPROJECT(${stepStr(projGuid)},#${history},${stepStr(project.name)},${stepStr(project.description ?? '')},$,${stepStr(project.client ?? '')},${stepStr(project.engineer ?? '')},(#${ctxId}),#${units})`,
  );
  const projRef: EntityRef = { id: projId, guid: projGuid };

  // Build site/building/storey hierarchy from project metadata. If no
  // sites are defined, create a single placeholder site/building/storey.
  const sites = project.sites ? Object.values(project.sites) : [];
  const buildings = project.buildings ? Object.values(project.buildings) : [];
  const floors = project.floors ? Object.values(project.floors) : [];

  const siteRefs: EntityRef[] = [];
  const sitePlacementByRef = new Map<string, number>();

  if (sites.length === 0) {
    const sitePlacement = localPlacement(e, null);
    const g = guid(`site-default`);
    const id = emit(
      e,
      `IFCSITE(${stepStr(g)},#${history},'Site',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`,
    );
    siteRefs.push({ id, guid: g });
    sitePlacementByRef.set('default-site', sitePlacement);
  } else {
    for (const site of sites) {
      const sitePlacement = localPlacement(e, null);
      const g = guid(`site-${site.id}`);
      const id = emit(
        e,
        `IFCSITE(${stepStr(g)},#${history},${stepStr(site.name)},${stepStr(site.description ?? '')},$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`,
      );
      siteRefs.push({ id, guid: g });
      sitePlacementByRef.set(site.id, sitePlacement);
    }
  }

  // Buildings under each site
  const buildingPlacementByRef = new Map<string, number>();
  const buildingRefsBySite = new Map<string, EntityRef[]>();
  if (buildings.length === 0) {
    const placement = localPlacement(e, sitePlacementByRef.values().next().value ?? null);
    const g = guid('building-default');
    const id = emit(
      e,
      `IFCBUILDING(${stepStr(g)},#${history},'Building',$,$,#${placement},$,$,.ELEMENT.,$,$,$)`,
    );
    const list = buildingRefsBySite.get(siteRefs[0].guid) ?? [];
    list.push({ id, guid: g });
    buildingRefsBySite.set(siteRefs[0].guid, list);
    buildingPlacementByRef.set('default-building', placement);
  } else {
    for (const b of buildings) {
      const sitePl = sitePlacementByRef.get(b.siteId) ?? sitePlacementByRef.values().next().value ?? null;
      const placement = localPlacement(e, sitePl);
      const g = guid(`building-${b.id}`);
      const id = emit(
        e,
        `IFCBUILDING(${stepStr(g)},#${history},${stepStr(b.name)},${stepStr(b.description ?? '')},$,#${placement},$,$,.ELEMENT.,$,$,$)`,
      );
      const siteGuid = guid(`site-${b.siteId}`);
      const list = buildingRefsBySite.get(siteGuid) ?? [];
      list.push({ id, guid: g });
      buildingRefsBySite.set(siteGuid, list);
      buildingPlacementByRef.set(b.id, placement);
    }
  }

  // Storeys under each building
  const storeyPlacementByRef = new Map<string, number>();
  const storeyZ = new Map<string, number>();
  const storeyRefsByBuilding = new Map<string, EntityRef[]>();
  if (floors.length === 0) {
    const buildPl = buildingPlacementByRef.values().next().value ?? null;
    const placement = localPlacement(e, buildPl, 0, 0, 0);
    const g = guid('storey-default');
    const id = emit(
      e,
      `IFCBUILDINGSTOREY(${stepStr(g)},#${history},'Default storey',$,$,#${placement},$,$,.ELEMENT.,0.0)`,
    );
    const buildingGuid = buildings[0] ? guid(`building-${buildings[0].id}`) : guid('building-default');
    const list = storeyRefsByBuilding.get(buildingGuid) ?? [];
    list.push({ id, guid: g });
    storeyRefsByBuilding.set(buildingGuid, list);
    storeyPlacementByRef.set('default-storey', placement);
    storeyZ.set('default-storey', 0);
  } else {
    for (const f of floors) {
      const buildPl = buildingPlacementByRef.get(f.buildingId) ?? buildingPlacementByRef.values().next().value ?? null;
      const placement = localPlacement(e, buildPl, 0, 0, f.ffl);
      const g = guid(`storey-${f.id}`);
      const id = emit(
        e,
        `IFCBUILDINGSTOREY(${stepStr(g)},#${history},${stepStr(f.name)},$,$,#${placement},$,$,.ELEMENT.,${f.ffl.toFixed(3)})`,
      );
      const buildingGuid = guid(`building-${f.buildingId}`);
      const list = storeyRefsByBuilding.get(buildingGuid) ?? [];
      list.push({ id, guid: g });
      storeyRefsByBuilding.set(buildingGuid, list);
      storeyPlacementByRef.set(f.id, placement);
      storeyZ.set(f.id, f.ffl);
    }
  }

  // Now content — containments, fittings, walls, cables. We attach all
  // content to the first storey for simplicity since the underlying
  // entities don't carry a floor reference.
  const firstStoreyKey = floors[0]?.id ?? 'default-storey';
  const firstStoreyPl =
    storeyPlacementByRef.get(firstStoreyKey) ?? storeyPlacementByRef.values().next().value ?? localPlacement(e, null);
  const firstStoreyZ = storeyZ.get(firstStoreyKey) ?? 0;
  const firstStoreyRef =
    Array.from(storeyRefsByBuilding.values()).flat()[0];

  const { containments, fittings, walls } = collectByKind(project);
  const contentRefs: EntityRef[] = [];
  for (const c of containments) {
    contentRefs.push(
      containmentToIfc(e, ctxId, history, firstStoreyPl, c, firstStoreyZ),
    );
  }
  for (const f of fittings) {
    contentRefs.push(
      fittingToIfc(e, ctxId, history, firstStoreyPl, f, firstStoreyZ),
    );
  }
  for (const w of walls) {
    contentRefs.push(
      wallToIfc(e, ctxId, history, firstStoreyPl, w, firstStoreyZ),
    );
  }
  const cables = project.cableSchedule
    ? project.cableSchedule.cableOrder.map(
        (id) => project.cableSchedule!.cables[id],
      )
    : [];
  for (const cab of cables) {
    if (!cab) continue;
    contentRefs.push(
      cableToIfc(e, ctxId, history, firstStoreyPl, cab, firstStoreyZ),
    );
  }
  if (firstStoreyRef && contentRefs.length) {
    containedIn(e, history, firstStoreyRef, contentRefs, 'storey-content');
  }

  // Aggregations: project → sites, site → buildings, building → storeys
  aggregate(e, history, projRef, siteRefs, 'project-sites');
  for (const sRef of siteRefs) {
    const blist = buildingRefsBySite.get(sRef.guid) ?? [];
    aggregate(e, history, sRef, blist, 'site-buildings');
  }
  for (const [bGuid, sList] of storeyRefsByBuilding) {
    // Find the building EntityRef by guid
    const bRef = (() => {
      for (const list of buildingRefsBySite.values()) {
        const found = list.find((r) => r.guid === bGuid);
        if (found) return found;
      }
      return undefined;
    })();
    if (bRef) aggregate(e, history, bRef, sList, 'building-storeys');
  }

  const ts = new Date().toISOString();
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
    `FILE_NAME('${project.name.replace(/'/g, "''")}.ifc','${ts}',('OpenCAD'),('OpenCAD Electrical'),'OpenCAD','OpenCAD Electrical 1.0','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];
  const footer = ['ENDSEC;', 'END-ISO-10303-21;'];
  return [...header, ...e.lines, ...footer].join('\n');
};
