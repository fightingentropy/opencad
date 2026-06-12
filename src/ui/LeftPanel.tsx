import React, { useState, useMemo } from 'react';
import { useStore } from '../state/store';
import { useActiveLayerId, useLayerOrder, useLayers } from '../state/selectors';
import { CATEGORY_LABELS, searchSymbols, renderSymbolPreview, symbolsByCategory } from '../symbols';
import { CONTAINMENT_DEFAULTS } from '../canvas/tools';
import type { ContainmentType, SymbolCategory, ToolId, Layer } from '../types';

export function LeftPanel({ open = false }: { open?: boolean } = {}) {
  return (
    <div className={`left-panel${open ? ' open' : ''}`}>
      <ContainmentLibrary />
      <SymbolLibrary />
      <Layers />
    </div>
  );
}

type ContainmentTool = Extract<ToolId, ContainmentType>;

const CONTAINMENT_PALETTE: {
  tool: ContainmentTool;
  label: string;
  description: string;
  icon: JSX.Element;
}[] = [
  {
    tool: 'basket',
    label: 'Basket',
    description: 'Wire basket containment',
    icon: (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <path d="M7 22h42v14H7z" />
        <path d="M13 22l9 14M22 22l-9 14M29 22l9 14M38 22l-9 14M47 22l-9 14" />
        <path d="M7 29h42" />
      </svg>
    ),
  },
  {
    tool: 'tray',
    label: 'Tray',
    description: 'Cable tray containment',
    icon: (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <path d="M8 19v17h40V19" />
        <path d="M13 32h30M16 28v-5M24 28v-5M32 28v-5M40 28v-5" />
      </svg>
    ),
  },
  {
    tool: 'trunking',
    label: 'Trunking',
    description: 'Rectangular trunking containment',
    icon: (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <rect x="8" y="21" width="40" height="14" />
        <path d="M10 26h36M10 31h36" />
      </svg>
    ),
  },
  {
    tool: 'conduit',
    label: 'Conduit',
    description: 'Round conduit route',
    icon: (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <path d="M8 28h40" />
        <circle cx="16" cy="28" r="4" />
        <circle cx="40" cy="28" r="4" />
      </svg>
    ),
  },
  {
    tool: 'ladder',
    label: 'Ladder',
    description: 'Cable ladder containment',
    icon: (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <path d="M8 20h40M8 36h40" />
        <path d="M15 20v16M23 20v16M31 20v16M39 20v16" />
      </svg>
    ),
  },
];

function findContainmentLayer(project: ReturnType<typeof useStore.getState>['project']): string | null {
  for (const id of project.layerOrder) {
    const layer = project.layers[id];
    if (layer?.name.toLowerCase() === 'containment') return id;
  }
  return null;
}

function ContainmentLibrary() {
  const tool = useStore((s) => s.editor.tool);
  const viewMode = useStore((s) => s.editor.viewMode);
  const setTool = useStore((s) => s.setTool);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const setViewMode = useStore((s) => s.setViewMode);
  const setStatus = useStore((s) => s.setStatus);
  const activeContainment = CONTAINMENT_PALETTE.find((item) => item.tool === tool);

  const selectTool = (id: ContainmentTool, label: string) => {
    // Layer lookup happens on click only — no project subscription needed.
    const containmentLayer = findContainmentLayer(useStore.getState().project);
    if (containmentLayer) setActiveLayer(containmentLayer);
    if (viewMode === '3d') setViewMode('split');
    setTool(id);
    setStatus(`${label}: pick first point on the plan`);
  };

  return (
    <div className="panel-section containment-library">
      <div className="panel-header">
        Containment
        <div className="panel-actions">
          <span className="kbd">{CONTAINMENT_PALETTE.length}</span>
        </div>
      </div>
      <div className="containment-tool-grid">
        {CONTAINMENT_PALETTE.map((item) => {
          const defaults = CONTAINMENT_DEFAULTS[item.tool];
          const size =
            item.tool === 'conduit'
              ? `Ø${defaults.width} mm`
              : `${defaults.width} × ${defaults.height} mm`;
          return (
            <button
              key={item.tool}
              type="button"
              className={`containment-tool-card${tool === item.tool ? ' active' : ''}`}
              onClick={() => selectTool(item.tool, item.label)}
              title={item.description}
            >
              <span className="containment-tool-icon">{item.icon}</span>
              <span className="containment-tool-meta">
                <span className="containment-tool-name">{item.label}</span>
                <span className="containment-tool-size">{size}</span>
              </span>
            </button>
          );
        })}
      </div>
      {activeContainment && (
        <div className="containment-command-hint">
          <strong>{activeContainment.label}</strong>
          <span>Click points on the plan. Enter or right-click commits the run.</span>
        </div>
      )}
    </div>
  );
}

function SymbolLibrary() {
  const setPendingSymbol = useStore((s) => s.setPendingSymbol);
  const pending = useStore((s) => s.editor.pendingSymbol);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<SymbolCategory | 'all'>('all');
  const [open, setOpen] = useState(false);

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
    <div className={`panel-section extras-library${open ? ' open' : ''}`}>
      <button
        type="button"
        className="panel-header extras-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Extras
        <div className="panel-actions">
          <span className="kbd">{symbols.length}</span>
          <span className="extras-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
        </div>
      </button>
      {open && (
        <>
          <div className="symbol-search">
            <input
              placeholder="Search extras…"
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
        </>
      )}
    </div>
  );
}

function Layers() {
  const layers = useLayers();
  const layerOrder = useLayerOrder();
  const activeLayerId = useActiveLayerId();
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
            onClick={() => removeLayer(activeLayerId)}
          >−</button>
        </div>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {layerOrder.map((id) => {
          const layer = layers[id];
          const active = id === activeLayerId;
          return (
            <div
              key={id}
              className={`layer-row${active ? ' active' : ''}${layer.visible ? '' : ' hidden'}${layer.locked ? ' locked' : ''}`}
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
