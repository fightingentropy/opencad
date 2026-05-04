import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { nanoid } from 'nanoid';
import { SheetTabs } from './SheetTabs';
import type { Building, Floor, Site, Zone, BuildingId, FloorId, ZoneId } from '../models/site';

// SiteNavigator replaces SheetTabs when project hierarchy exists. Otherwise
// falls back to plain SheetTabs.
export function SiteNavigator() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const setActiveSheet = useStore((s) => s.setActiveSheet);

  const sites = project.sites ?? {};
  const buildings = project.buildings ?? {};
  const floors = project.floors ?? {};
  const zones = project.zones ?? {};
  const hasHierarchy = Object.keys(sites).length > 0;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([
    ...Object.keys(sites),
    ...Object.keys(buildings),
    ...Object.keys(floors),
  ]));

  const toggle = (id: string) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  const navigateToFloor = (f: Floor) => {
    if (f.sheetIds.length > 0) setActiveSheet(f.sheetIds[0]);
    setProject({ ...project, activeFloorId: f.id, activeBuildingId: f.buildingId, modified: Date.now() });
  };

  const updateProject = (patch: Partial<typeof project>) => {
    setProject({ ...project, ...patch, modified: Date.now() });
  };

  const addBuilding = (siteId: string) => {
    const name = window.prompt('Building name?', 'Building 1');
    if (!name) return;
    const id = nanoid(10);
    const b: Building = {
      id,
      siteId,
      name,
      floorOrder: [],
    };
    const site = sites[siteId];
    updateProject({
      buildings: { ...buildings, [id]: b },
      sites: { ...sites, [siteId]: { ...site, buildingOrder: [...site.buildingOrder, id] } },
      activeBuildingId: id,
    });
    setExpanded(new Set([...expanded, id]));
  };

  const addFloor = (buildingId: string) => {
    const name = window.prompt('Floor name?', 'Ground Floor');
    if (!name) return;
    const id = nanoid(10);
    const b = buildings[buildingId];
    const level = b.floorOrder.length;
    const f: Floor = {
      id,
      buildingId,
      name,
      level,
      ffl: level * 3500,
      floorHeight: 3500,
      zoneOrder: [],
      sheetIds: [],
    };
    updateProject({
      floors: { ...floors, [id]: f },
      buildings: { ...buildings, [buildingId]: { ...b, floorOrder: [...b.floorOrder, id] } },
      activeFloorId: id,
    });
    setExpanded(new Set([...expanded, id]));
  };

  const addZone = (floorId: string) => {
    const name = window.prompt('Zone name?', 'Plant Room');
    if (!name) return;
    const id = nanoid(10);
    const f = floors[floorId];
    const z: Zone = {
      id,
      floorId,
      name,
      classification: 'other',
    };
    updateProject({
      zones: { ...zones, [id]: z },
      floors: { ...floors, [floorId]: { ...f, zoneOrder: [...f.zoneOrder, id] } },
    });
  };

  const addSite = () => {
    const name = window.prompt('Site name?', 'Main Site');
    if (!name) return;
    const id = nanoid(10);
    const s: Site = { id, name, buildingOrder: [] };
    updateProject({
      sites: { ...sites, [id]: s },
      activeSiteId: id,
    });
    setExpanded(new Set([...expanded, id]));
  };

  if (!hasHierarchy) {
    return (
      <div className="site-navigator-fallback">
        <button className="btn-ghost site-init-btn" onClick={addSite}>
          + Configure Sites
        </button>
        <SheetTabs />
      </div>
    );
  }

  return (
    <div className="site-navigator">
      <div className="site-navigator-header">
        Sites
        <button className="btn-ghost btn-tiny" onClick={addSite}>+ Site</button>
      </div>
      <div className="site-tree">
        {Object.values(sites).map((site) => (
          <SiteNode
            key={site.id}
            site={site}
            buildings={buildings}
            floors={floors}
            zones={zones}
            expanded={expanded}
            onToggle={toggle}
            onAddBuilding={() => addBuilding(site.id)}
            onAddFloor={addFloor}
            onAddZone={addZone}
            onSelectFloor={navigateToFloor}
            activeFloorId={project.activeFloorId}
          />
        ))}
      </div>
    </div>
  );
}

function SiteNode({
  site, buildings, floors, zones,
  expanded, onToggle, onAddBuilding, onAddFloor, onAddZone, onSelectFloor, activeFloorId,
}: {
  site: Site;
  buildings: Record<BuildingId, Building>;
  floors: Record<FloorId, Floor>;
  zones: Record<ZoneId, Zone>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onAddBuilding: () => void;
  onAddFloor: (id: string) => void;
  onAddZone: (id: string) => void;
  onSelectFloor: (f: Floor) => void;
  activeFloorId?: string;
}) {
  const open = expanded.has(site.id);
  return (
    <div className="tree-node site-tree-node">
      <div className="tree-row" onClick={() => onToggle(site.id)}>
        <span className="tree-twist">{open ? '▾' : '▸'}</span>
        <span className="tree-icon">▣</span>
        <span className="tree-label">{site.name}</span>
        <button className="btn-ghost btn-tiny" onClick={(e) => { e.stopPropagation(); onAddBuilding(); }}>+ Building</button>
      </div>
      {open && site.buildingOrder.map((bid) => {
        const b = buildings[bid];
        if (!b) return null;
        const bopen = expanded.has(b.id);
        return (
          <div key={b.id} className="tree-node">
            <div className="tree-row level-1" onClick={() => onToggle(b.id)}>
              <span className="tree-twist">{bopen ? '▾' : '▸'}</span>
              <span className="tree-icon">▤</span>
              <span className="tree-label">{b.name}</span>
              <button className="btn-ghost btn-tiny" onClick={(e) => { e.stopPropagation(); onAddFloor(b.id); }}>+ Floor</button>
            </div>
            {bopen && b.floorOrder.map((fid) => {
              const f = floors[fid];
              if (!f) return null;
              const fopen = expanded.has(f.id);
              return (
                <div key={f.id} className="tree-node">
                  <div
                    className={`tree-row level-2${activeFloorId === f.id ? ' active' : ''}`}
                    onClick={() => onSelectFloor(f)}
                  >
                    <span
                      className="tree-twist"
                      onClick={(e) => { e.stopPropagation(); onToggle(f.id); }}
                    >{fopen ? '▾' : '▸'}</span>
                    <span className="tree-icon">▦</span>
                    <span className="tree-label">{f.name}</span>
                    <span className="tree-meta">L{f.level}</span>
                    <button
                      className="btn-ghost btn-tiny"
                      onClick={(e) => { e.stopPropagation(); onAddZone(f.id); }}
                    >+ Zone</button>
                  </div>
                  {fopen && f.zoneOrder.map((zid) => {
                    const z = zones[zid];
                    if (!z) return null;
                    return (
                      <div key={z.id} className="tree-row level-3">
                        <span className="tree-twist" />
                        <span className="tree-icon">·</span>
                        <span className="tree-label">{z.name}</span>
                        <span className="tree-meta">{z.classification}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
