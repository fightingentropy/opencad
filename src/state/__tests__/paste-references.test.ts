import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import type { ContainmentEntity, EquipmentEntity, GroupEntity, SupportEntity } from '../../types';

beforeEach(() => { useStore.getState().resetProject(); });

const layerId = () => useStore.getState().project.layerOrder[0];
const base = (id: string) => ({ id, layerId: layerId(), visible: true, locked: false });

function seed(entities: any[]) {
  const s = useStore.getState();
  const sheet = s.project.sheets[s.project.activeSheetId];
  const map = { ...sheet.entities };
  for (const e of entities) map[e.id] = e;
  useStore.setState({
    project: { ...s.project, sheets: { ...s.project.sheets, [sheet.id]: { ...sheet, entities: map, entityOrder: [...sheet.entityOrder, ...entities.map((e) => e.id)] } } },
  });
}

const run = (ids: string[]) => {
  const s = useStore.getState();
  s.setSelection(ids);
  s.copySelection();
  useStore.getState().pasteFromClipboard();
  const st = useStore.getState();
  const sheet = st.project.sheets[st.project.activeSheetId];
  return [...st.editor.selection].map((id) => sheet.entities[id]);
};

describe('paste does not share references with the originals', () => {
  it('clears cables and joints on pasted containment', () => {
    const c: ContainmentEntity = {
      ...base('c1'), kind: 'containment', containmentType: 'tray', width: 100, height: 50,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], assignedCableIds: ['cab1'],
      connections: [{ id: 'j', entityId: 'other' } as any], connectionsLocked: true,
    } as any;
    seed([c]);
    const [copy] = run(['c1']) as ContainmentEntity[];
    expect(copy.id).not.toBe('c1');
    expect(copy.assignedCableIds).toBeUndefined();
    expect(copy.connections).toBeUndefined();
    expect(copy.connectionsLocked).toBeFalsy();
  });

  it('remaps group and support references and gives equipment new tags', () => {
    const g: GroupEntity = { ...base('g1'), kind: 'group', childIds: ['c1', 'gone'] } as any;
    const c = { ...base('c1'), kind: 'containment', containmentType: 'tray', width: 100, height: 50, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] };
    const sup: SupportEntity = { ...base('s1'), kind: 'support', supportKind: 'trapeze-hanger', position: { x: 1, y: 1 }, rotation: 0, supportingContainmentIds: ['c1', 'outside'] } as any;
    const eq: EquipmentEntity = { ...base('e1'), kind: 'equipment', equipmentKind: 'distribution-board', a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, tag: 'DB-01' } as any;
    const eq2: EquipmentEntity = { ...eq, id: 'e2', tag: 'DB-02' };
    seed([g, c, sup, eq, eq2]);
    const copies = run(['g1', 'c1', 's1', 'e1', 'e2']);
    const [cg, cc, cs, ce, ce2] = copies as any[];
    expect(cg.childIds).toEqual([cc.id]);
    expect(cs.supportingContainmentIds).toEqual([cc.id]);
    const tags = [ce.tag, ce2.tag];
    expect(new Set([...tags, 'DB-01', 'DB-02']).size).toBe(4);
  });
});
