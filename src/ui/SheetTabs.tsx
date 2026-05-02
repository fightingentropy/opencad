import React from 'react';
import { useStore } from '../state/store';
import type { SheetKind } from '../types';

export function SheetTabs() {
  const project = useStore((s) => s.project);
  const setActiveSheet = useStore((s) => s.setActiveSheet);
  const addSheet = useStore((s) => s.addSheet);
  const removeSheet = useStore((s) => s.removeSheet);
  const renameSheet = useStore((s) => s.renameSheet);

  const onAdd = () => {
    const kindStr = window.prompt('Sheet type? (schematic, panel-layout, one-line, wiring, plc-io)', 'schematic');
    if (!kindStr) return;
    const kind = kindStr as SheetKind;
    const name = window.prompt('Sheet name?', 'New Sheet') ?? 'New Sheet';
    addSheet({ kind, name });
  };

  return (
    <div className="sheet-tabs">
      {project.sheetOrder.map((id) => {
        const sheet = project.sheets[id];
        const active = id === project.activeSheetId;
        return (
          <div
            key={id}
            className={`sheet-tab${active ? ' active' : ''}`}
            onClick={() => setActiveSheet(id)}
            onDoubleClick={() => {
              const newName = window.prompt('Sheet name', sheet.name);
              if (newName) renameSheet(id, newName);
            }}
          >
            <span className="num">{sheet.number}</span>
            <span>{sheet.name}</span>
            <span style={{ fontSize: 9, color: 'var(--text-mute)' }}>({sheet.kind})</span>
            {project.sheetOrder.length > 1 && active && (
              <span
                style={{ marginLeft: 6, opacity: 0.6, cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); if (confirm('Delete sheet?')) removeSheet(id); }}
                title="Close sheet"
              >×</span>
            )}
          </div>
        );
      })}
      <div className="sheet-tab-add" onClick={onAdd} title="New sheet">+</div>
    </div>
  );
}
