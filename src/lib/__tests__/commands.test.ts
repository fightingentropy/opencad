import { beforeEach, describe, expect, it } from 'vitest';
import {
  allCommands,
  clearRecentlyUsed,
  dispatchShortcut,
  fuzzyScore,
  markRecentlyUsed,
  searchCommands,
  shortcutHint,
} from '../commands';
import { useStore } from '../../state/store';

// Synthetic keyboard event — matchers only read key + modifier flags, so a
// plain object stands in for a real KeyboardEvent under the node test env.
const evt = (
  key: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {},
): KeyboardEvent =>
  ({
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    code: '',
    preventDefault: () => {},
  } as unknown as KeyboardEvent);

describe('fuzzyScore', () => {
  it('matches subsequences and rejects non-subsequences', () => {
    expect(fuzzyScore('expdf', 'Export PDF…')).not.toBeNull();
    expect(fuzzyScore('xyzq', 'Export PDF…')).toBeNull();
    expect(fuzzyScore('undo', 'Redo')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('PDF', 'export pdf…')).toEqual(fuzzyScore('pdf', 'Export PDF…'));
    expect(fuzzyScore('WIRE', 'Wire Tool')).not.toBeNull();
  });

  it('treats an empty query as a neutral match', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0);
    expect(fuzzyScore('   ', 'Anything')).toBe(0);
  });

  it('skips spaces in the query', () => {
    expect(fuzzyScore('export pdf', 'Export PDF…')).not.toBeNull();
  });

  it('scores consecutive runs above scattered matches', () => {
    const consecutive = fuzzyScore('wire', 'Wire Tool');
    const scattered = fuzzyScore('wre', 'Wire Tool');
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!).toBeGreaterThan(scattered!);
  });

  it('rewards word-start matches over mid-word hits', () => {
    const boundaries = fuzzyScore('cs', 'Cable Schedule');
    const midWord = fuzzyScore('cs', 'across');
    expect(boundaries).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(boundaries!).toBeGreaterThan(midWord!);
  });

  it('prefers the shorter target when matches are otherwise equal', () => {
    expect(fuzzyScore('undo', 'Undo')!).toBeGreaterThan(fuzzyScore('undo', 'Undo Something')!);
  });
});

describe('searchCommands', () => {
  beforeEach(() => clearRecentlyUsed());

  it('lists non-contextual commands in registry order for an empty query', () => {
    const results = searchCommands('');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('file.new');
    expect(results.every((c) => !c.contextual)).toBe(true);
  });

  it('excludes currently-disabled commands', () => {
    // Default store state has an empty selection, so alignment commands
    // (which need >= 2 selected entities) must not surface.
    const ids = searchCommands('').map((c) => c.id);
    expect(ids).not.toContain('edit.align-left');
    expect(ids).not.toContain('edit.delete');
  });

  it('ranks direct title matches first', () => {
    expect(searchCommands('undo')[0].id).toBe('edit.undo');
    expect(searchCommands('palette')[0].id).toBe('help.palette');
    expect(searchCommands('zoom ext')[0].id).toBe('view.zoom-extents');
  });

  it('boosts recently-used commands, newest first', () => {
    markRecentlyUsed('view.zoom-out');
    markRecentlyUsed('edit.undo');
    const results = searchCommands('');
    expect(results[0].id).toBe('edit.undo');
    expect(results[1].id).toBe('view.zoom-out');
  });
});

describe('registry integrity', () => {
  const commands = allCommands();
  const dispatchable = commands.filter((c) => !c.contextual && c.shortcut);

  it('has unique command ids', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a title and category on every command', () => {
    for (const cmd of commands) {
      expect(cmd.title.length, cmd.id).toBeGreaterThan(0);
      expect(cmd.category.length, cmd.id).toBeGreaterThan(0);
    }
  });

  it('gives every shortcut a non-empty display string', () => {
    for (const cmd of commands) {
      if (cmd.shortcut) expect(cmd.shortcut.display.length, cmd.id).toBeGreaterThan(0);
    }
  });

  it('has no duplicate display combos among dispatchable shortcuts', () => {
    const displays = dispatchable.map((c) => c.shortcut!.display);
    expect(new Set(displays).size).toBe(displays.length);
  });

  it('never lets two dispatchable commands claim the same key event', () => {
    const keys = [
      'a', 'b', 'c', 'd', 'e', 'f', 'h', 'k', 'l', 'm', 'o', 'p', 'r', 's',
      't', 'v', 'w', 'z', '?', 'Escape', 'Delete', 'Backspace', 'Enter',
      'Tab', 'F3', 'F7', 'F8', 'F9',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    ];
    for (const key of keys) {
      for (let mask = 0; mask < 16; mask++) {
        const mods = {
          meta: Boolean(mask & 1),
          ctrl: Boolean(mask & 2),
          shift: Boolean(mask & 4),
          alt: Boolean(mask & 8),
        };
        // Real events deliver the shifted character for letters.
        const eventKey = mods.shift && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
        const e = evt(eventKey, mods);
        const matching = dispatchable.filter((c) => c.shortcut!.matches(e));
        expect(
          matching.length,
          `${eventKey} ${JSON.stringify(mods)} matched ${matching.map((c) => c.id).join(', ')}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('documents the bindings the old About table missed', () => {
    const byId = new Map(commands.map((c) => [c.id, c]));
    // F-keys + view history are real, dispatchable bindings.
    expect(byId.get('view.toggle-grid')?.shortcut?.display).toBe('F7');
    expect(byId.get('view.toggle-ortho')?.shortcut?.display).toBe('F8');
    expect(byId.get('view.toggle-snap')?.shortcut?.display).toBe('F9');
    expect(byId.get('view.back')?.shortcut).toBeDefined();
    expect(byId.get('view.forward')?.shortcut).toBeDefined();
    // Tab-during-drafting, fast pan, and right-click stay inside the canvas
    // logic but must surface in the shortcuts modal as contextual entries.
    expect(byId.get('ctx.flip-autoroute')?.contextual).toBe(true);
    expect(byId.get('ctx.flip-autoroute')?.shortcut?.display).toBe('Tab');
    expect(byId.get('ctx.arrow-pan-fast')?.contextual).toBe(true);
    expect(byId.get('mouse.right-click')?.contextual).toBe(true);
  });

  it('exposes menu hints through shortcutHint', () => {
    expect(shortcutHint('view.toggle-grid')).toBe('F7');
    expect(shortcutHint('edit.cancel')).toBe('Esc');
    expect(shortcutHint('does.not.exist')).toBe('');
  });
});

describe('dispatchShortcut', () => {
  beforeEach(() => clearRecentlyUsed());

  it('runs the matching command against the store', () => {
    const before = useStore.getState().editor.snap.grid;
    expect(dispatchShortcut(evt('F7'))).toBe(true);
    expect(useStore.getState().editor.snap.grid).toBe(!before);
    // Restore for other tests.
    useStore.getState().setSnap({ grid: before });
  });

  it('consumes each event exactly once across dispatchers', () => {
    const before = useStore.getState().editor.snap.grid;
    const e = evt('F7');
    expect(dispatchShortcut(e)).toBe(true);
    // Second dispatcher (e.g. the app-level listener) sees it as handled
    // without toggling again.
    expect(dispatchShortcut(e, { globalOnly: true })).toBe(true);
    expect(useStore.getState().editor.snap.grid).toBe(!before);
    useStore.getState().setSnap({ grid: before });
  });

  it('restricts globalOnly dispatch to globalKey commands', () => {
    // F8 (ortho) is canvas-scoped: the app-level dispatcher must ignore it.
    const ortho = useStore.getState().editor.ortho;
    expect(dispatchShortcut(evt('F8'), { globalOnly: true })).toBe(false);
    expect(useStore.getState().editor.ortho).toBe(ortho);
  });

  it('skips disabled commands', () => {
    // Empty selection disables edit.delete, so Delete falls through.
    useStore.getState().clearSelection();
    expect(dispatchShortcut(evt('Delete'))).toBe(false);
  });
});
