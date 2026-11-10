import { describe, expect, it } from 'vitest';
import { useStore } from '../../state/store';

// setProject loads a whole project and clears undo history; panel edits must go
// through setProjectPatch instead. The components have no render harness, so the
// panel sources are checked directly.
const PANELS = [
  'CableScheduleModal',
  'RightPanel',
  'SiteNavigator',
  'StandardsProfilePicker',
  'MarkupPanel',
  'ITPChecklistPanel',
  'RevisionHistoryPanel',
];

const sources = import.meta.glob('../*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('panel edits keep undo history', () => {
  it('setProjectPatch keeps and extends history while setProject clears it', () => {
    const s = useStore.getState();
    s.setProject(s.project);
    s.setProjectPatch({ name: 'one' });
    s.setProjectPatch({ name: 'two' });
    expect(useStore.getState().past.length).toBe(2);
    useStore.getState().setProject(useStore.getState().project);
    expect(useStore.getState().past.length).toBe(0);
  });

  it.each(PANELS)('%s does not use setProject', (name) => {
    const src = sources[`../${name}.tsx`];
    expect(src).toBeTypeOf('string');
    expect(src).not.toMatch(/\bsetProject\b/);
  });
});
