import React, { useState, useMemo } from 'react';
import { useStore } from '../state/store';
import { CATEGORY_LABELS, searchSymbols, renderSymbolPreview, symbolsByCategory } from '../symbols';
import type { SymbolCategory, Layer } from '../types';

export function LeftPanel() {
  return (
    <div className="left-panel">
      <SymbolLibrary />
      <Layers />
    </div>
  );
}

function SymbolLibrary() {
  const setPendingSymbol = useStore((s) => s.setPendingSymbol);
  const pending = useStore((s) => s.editor.pendingSymbol);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<SymbolCategory | 'all'>('all');

  const symbols = useMemo(() => {
    const all = searchSymbols(query);
    if (activeCat === 'all') return all;
    return all.filter((s) => s.category === activeCat);
  }, [query, activeCat]);

  const categories = useMemo(() => {
    const c = symbolsByCategory();
    return Object.keys(c) as SymbolCategory[];
  }, []);

  return (
    <div className="panel-section flex">
      <div className="panel-header">
        Symbols
        <div className="panel-actions">
          <span className="kbd">{symbols.length}</span>
        </div>
      </div>
      <div className="symbol-search">
        <input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="symbol-categories">
        <span
          className={`cat-pill${activeCat === 'all' ? ' active' : ''}`}
          onClick={() => setActiveCat('all')}
        >
          All
        </span>
        {categories.map((c) => (
          <span
            key={c}
            className={`cat-pill${activeCat === c ? ' active' : ''}`}
            onClick={() => setActiveCat(c)}
            title={CATEGORY_LABELS[c]}
          >
            {CATEGORY_LABELS[c]}
          </span>
        ))}
      </div>
      <div className="panel-body">
        <div className="symbol-grid">
          {symbols.map((s) => (
            <div
              key={s.id}
              className={`symbol-tile${pending === s.id ? ' active' : ''}`}
              onClick={() => setPendingSymbol(pending === s.id ? null : s.id)}
              title={s.description ?? s.name}
            >
              <div
                className="symbol-tile-preview"
                style={{ color: '#e6e6e6' }}
                dangerouslySetInnerHTML={{ __html: renderSymbolPreview(s, 56) }}
              />
              <div className="symbol-tile-name">{s.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Layers() {
  const project = useStore((s) => s.project);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const toggleLayerVisible = useStore((s) => s.toggleLayerVisible);
  const toggleLayerLocked = useStore((s) => s.toggleLayerLocked);
  const updateLayer = useStore((s) => s.updateLayer);
  const addLayer = useStore((s) => s.addLayer);
  const removeLayer = useStore((s) => s.removeLayer);

  return (
    <div className="panel-section">
      <div className="panel-header">
        Layers
        <div className="panel-actions">
          <button
            className="tool-btn-small"
            title="Add layer"
            onClick={() => addLayer({ name: 'New Layer', color: '#e6e6e6' })}
          >+</button>
          <button
            className="tool-btn-small"
            title="Remove active layer"
            onClick={() => removeLayer(project.activeLayerId)}
          >−</button>
        </div>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {project.layerOrder.map((id) => {
          const layer = project.layers[id];
          const active = id === project.activeLayerId;
          return (
            <div
              key={id}
              className={`layer-row${active ? ' active' : ''}`}
              style={{ position: 'relative' }}
              onClick={() => setActiveLayer(id)}
            >
              <input
                type="color"
                className="layer-color"
                value={layer.color}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateLayer(id, { color: e.target.value })}
              />
              <span
                className={`layer-toggle${layer.visible ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLayerVisible(id); }}
                title={layer.visible ? 'Visible' : 'Hidden'}
              >
                {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
              </span>
              <span
                className={`layer-toggle${layer.locked ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLayerLocked(id); }}
                title={layer.locked ? 'Locked' : 'Unlocked'}
              >
                {layer.locked ? <LockIcon /> : <UnlockIcon />}
              </span>
              <input
                className="layer-name"
                value={layer.name}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateLayer(id, { name: e.target.value })}
                style={{ background: 'transparent', border: 'none', flex: 1, padding: 0 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const EyeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
);
const EyeOffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>
);
const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const UnlockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
);
