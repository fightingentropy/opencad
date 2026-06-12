import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandDef } from '../lib/commands';
import { runCommand, searchCommands } from '../lib/commands';

const MAX_RESULTS = 50;

/**
 * ⌘K command palette. Fuzzy-searches the command registry, keeps focus
 * trapped in its input while open, and restores focus to the previously
 * focused element on close. The list follows the ARIA combobox/listbox
 * pattern (options are announced via aria-activedescendant rather than
 * receiving DOM focus).
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const results = useMemo(() => searchCommands(query).slice(0, MAX_RESULTS), [query]);
  // Clamp instead of resetting in an effect so a shrinking result list never
  // leaves the highlight on a row that no longer exists.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeCmd: CommandDef | undefined = results[activeIndex];

  // Focus trap bookkeeping: remember where focus was, take it, give it back.
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      prevFocusRef.current?.focus?.();
    };
  }, []);

  // Keep the highlighted option visible while arrowing through the list.
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  const exec = (cmd: CommandDef) => {
    onClose();
    runCommand(cmd.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Nothing here should fall through to the canvas / app-level shortcut
    // dispatchers while the palette is open.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      onClose(); // ⌘K toggles
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setActive((activeIndex + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) setActive((activeIndex - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeCmd) exec(activeCmd);
    } else if (e.key === 'Tab') {
      // The input is the only tab stop — swallow Tab to trap focus.
      e.preventDefault();
    }
  };

  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeCmd ? `cmdk-opt-${activeCmd.id}` : undefined}
          placeholder="Type a command…"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list" id="cmdk-listbox" role="listbox" ref={listRef}>
          {results.map((cmd, i) => (
            <div
              key={cmd.id}
              id={`cmdk-opt-${cmd.id}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`cmdk-item${i === activeIndex ? ' active' : ''}`}
              // preventDefault keeps focus in the input (the trap) so a
              // click runs the command without first blurring the palette.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(cmd)}
              onMouseMove={() => setActive(i)}
            >
              <span className="cmdk-title">{cmd.title}</span>
              <span className="cmdk-cat">{cmd.category}</span>
              {cmd.shortcut && <span className="kbd cmdk-key">{cmd.shortcut.display}</span>}
            </div>
          ))}
          {results.length === 0 && <div className="cmdk-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
