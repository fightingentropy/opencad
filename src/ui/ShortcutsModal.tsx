import React, { useMemo } from 'react';
import type { CommandDef } from '../lib/commands';
import { allCommands, shortcutHint } from '../lib/commands';

/**
 * Keyboard-shortcuts reference. The table is generated from the command
 * registry — including contextual entries that are handled inside the
 * canvas tool logic — so it can never drift from the real bindings.
 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  // Group every command that carries a shortcut by category, preserving
  // registry declaration order for both groups and rows.
  const groups = useMemo(() => {
    const map = new Map<string, CommandDef[]>();
    for (const cmd of allCommands()) {
      if (!cmd.shortcut) continue;
      const list = map.get(cmd.category);
      if (list) list.push(cmd);
      else map.set(cmd.category, [cmd]);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Keyboard Shortcuts
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto' }}>×</span>
        </div>
        <div className="modal-body shortcuts-body">
          {groups.map(([category, cmds]) => (
            <div className="shortcut-group" key={category}>
              <h4>{category}</h4>
              {cmds.map((cmd) => (
                <div className="shortcut-row" key={cmd.id}>
                  <span className="kbd">{cmd.shortcut!.display}</span>
                  <span className="shortcut-desc">{cmd.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <span className="shortcuts-tip">
            Tip: press <span className="kbd">{shortcutHint('help.palette')}</span> to search every command.
          </span>
          <button className="btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
