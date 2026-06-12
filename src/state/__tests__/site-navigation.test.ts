import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, useStore } from '../store';
import { addBuilding, addFloor, addSite, setActiveFloor } from '../site-actions';
import type { Project } from '../../types';

// The store is a module-level singleton, so every test starts from a fresh
// empty project with cleared undo/redo stacks.
beforeEach(() => {
  useStore.setState({
    project: createEmptyProject(),
    past: [],
    future: [],
  });
});

// Build a site → building → two-floors chain on the given project, attaching
// the provided sheet ids to each floor.
const withHierarchy = (
  project: Project,
  floor1Sheets: string[],
  floor2Sheets: string[],
): Project => {
  let p = addSite(project, { id: 'site-1', name: 'Main Site' });
  p = addBuilding(p, 'site-1', { id: 'bldg-1', name: 'Building A' });
  p = addFloor(p, 'bldg-1', {
    id: 'floor-1', name: 'Ground', level: 0, ffl: 0, floorHeight: 3500,
    sheetIds: floor1Sheets,
  });
  p = addFloor(p, 'bldg-1', {
    id: 'floor-2', name: 'First', level: 1, ffl: 3500, floorHeight: 3500,
    sheetIds: floor2Sheets,
  });
  return p;
};

describe('setActiveFloor', () => {
  it('activates the floor, its building, and its first sheet', () => {
    const base = useStore.getState().project;
    const [, sheet2, sheet3] = base.sheetOrder;
    const p = withHierarchy(base, [sheet2], [sheet3]);

    const next = setActiveFloor(p, 'floor-2');
    expect(next.activeFloorId).toBe('floor-2');
    expect(next.activeBuildingId).toBe('bldg-1');
    expect(next.activeSheetId).toBe(sheet3);
  });

  it('keeps the current sheet when the floor has no sheets', () => {
    const base = useStore.getState().project;
    const p = withHierarchy(base, [], []);

    const next = setActiveFloor(p, 'floor-2');
    expect(next.activeFloorId).toBe('floor-2');
    expect(next.activeSheetId).toBe(base.activeSheetId);
  });

  it('skips sheet ids that no longer exist', () => {
    const base = useStore.getState().project;
    const [, sheet2] = base.sheetOrder;
    const p = withHierarchy(base, [], ['deleted-sheet', sheet2]);

    const next = setActiveFloor(p, 'floor-2');
    expect(next.activeSheetId).toBe(sheet2);
  });
});

describe('floor navigation through the store', () => {
  // Regression: SiteNavigator.navigateToFloor used to snapshot the project,
  // call setActiveSheet, then setProject with the stale snapshot — the old
  // activeSheetId in the spread reverted the sheet switch, so clicking a
  // floor in the site tree never showed the floor's sheet. The handler now
  // applies setActiveFloor to the live project in a single setProject call.
  it('navigating to a floor makes its first sheet active', () => {
    const base = useStore.getState().project;
    const [sheet1, sheet2, sheet3] = base.sheetOrder;
    useStore.getState().setProject(withHierarchy(base, [sheet2], [sheet3]));
    expect(useStore.getState().project.activeSheetId).toBe(sheet1);

    // Same sequence as SiteNavigator.navigateToFloor.
    useStore.getState().setProject(
      setActiveFloor(useStore.getState().project, 'floor-2'),
    );

    const after = useStore.getState().project;
    expect(after.activeFloorId).toBe('floor-2');
    expect(after.activeBuildingId).toBe('bldg-1');
    expect(after.activeSheetId).toBe(sheet3);
  });
});
