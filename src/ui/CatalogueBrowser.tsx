import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useCatalogues, useSelectedEntity } from '../state/selectors';
import { notify } from '../state/notifications';
import type { CatalogueProduct, CatalogueCategory } from '../models/catalogue';

const TABS: { id: CatalogueCategory; label: string }[] = [
  { id: 'cable-tray', label: 'Cable Tray' },
  { id: 'cable-ladder', label: 'Cable Ladder' },
  { id: 'cable-basket', label: 'Cable Basket' },
  { id: 'trunking', label: 'Trunking' },
  { id: 'conduit', label: 'Conduit' },
  { id: 'fitting', label: 'Fittings' },
  { id: 'support', label: 'Supports' },
  { id: 'fire-stop', label: 'Fire Stops' },
  { id: 'cable', label: 'Cables' },
];

export function CatalogueBrowser({ onClose }: { onClose: () => void }) {
  const catalogues = useCatalogues();
  const selectedEntity = useSelectedEntity();
  const updateEntity = useStore((s) => s.updateEntity);
  const setStatus = useStore((s) => s.setStatus);

  const [activeTab, setActiveTab] = useState<CatalogueCategory>('cable-tray');
  const [search, setSearch] = useState('');
  const [filterMfr, setFilterMfr] = useState<string>('all');
  const [filterMaterial, setFilterMaterial] = useState<string>('all');
  const [filterIp, setFilterIp] = useState<string>('all');
  const [minSize, setMinSize] = useState<string>('');
  const [maxSize, setMaxSize] = useState<string>('');

  const allProducts: CatalogueProduct[] = useMemo(() => {
    const out: CatalogueProduct[] = [];
    const cats = catalogues ?? {};
    for (const k of Object.keys(cats)) {
      const cat = cats[k];
      for (const pid of cat.productOrder) {
        const p = cat.products[pid];
        if (p) out.push(p);
      }
    }
    return out;
  }, [catalogues]);

  const visible = useMemo(() => {
    const lc = search.toLowerCase();
    const sMin = parseFloat(minSize);
    const sMax = parseFloat(maxSize);
    return allProducts.filter((p) => {
      if (p.category !== activeTab) return false;
      if (filterMfr !== 'all' && p.manufacturer !== filterMfr) return false;
      if (filterMaterial !== 'all' && p.material !== filterMaterial) return false;
      if (filterIp !== 'all' && p.ipRating !== filterIp) return false;
      const size = p.width ?? p.diameter ?? 0;
      if (Number.isFinite(sMin) && size < sMin) return false;
      if (Number.isFinite(sMax) && sMax > 0 && size > sMax) return false;
      if (search && !(`${p.partNumber} ${p.description} ${p.manufacturer}`.toLowerCase().includes(lc))) return false;
      return true;
    });
  }, [allProducts, activeTab, filterMfr, filterMaterial, filterIp, minSize, maxSize, search]);

  const manufacturers = useMemo(() => Array.from(new Set(allProducts.map((p) => p.manufacturer))), [allProducts]);
  const materials = useMemo(() => Array.from(new Set(allProducts.map((p) => p.material).filter(Boolean) as string[])), [allProducts]);
  const ipRatings = useMemo(() => Array.from(new Set(allProducts.map((p) => p.ipRating).filter(Boolean) as string[])), [allProducts]);

  const selectedContainment =
    selectedEntity?.kind === 'containment' ? selectedEntity : null;

  const onApply = (p: CatalogueProduct) => {
    if (!selectedContainment) {
      notify('warning', 'Select a containment entity first');
      return;
    }
    updateEntity(selectedContainment.id, {
      manufacturer: p.manufacturer,
      catalogProductId: p.id,
      catalogPartNumber: p.partNumber,
      width: p.width,
      height: p.height,
      innerCsaMm2: p.innerCsaMm2,
      material: p.material as any,
    } as any);
    setStatus(`Applied ${p.partNumber}`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal catalogue-modal"
        style={{ minWidth: '85vw', minHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          Catalogue Browser
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-mute)', fontSize: 12, fontWeight: 'normal' }}>
              {visible.length} / {allProducts.length} products
            </span>
            <span className="close" onClick={onClose} style={{ cursor: 'pointer' }}>×</span>
          </span>
        </div>
        <div className="catalogue-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`catalogue-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="catalogue-toolbar">
          <input
            placeholder="Search part number, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <select value={filterMfr} onChange={(e) => setFilterMfr(e.target.value)}>
            <option value="all">All Mfrs</option>
            {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterMaterial} onChange={(e) => setFilterMaterial(e.target.value)}>
            <option value="all">Any Material</option>
            {materials.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterIp} onChange={(e) => setFilterIp(e.target.value)}>
            <option value="all">Any IP</option>
            {ipRatings.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            type="number"
            placeholder="min size"
            value={minSize}
            onChange={(e) => setMinSize(e.target.value)}
            style={{ width: 80 }}
          />
          <input
            type="number"
            placeholder="max size"
            value={maxSize}
            onChange={(e) => setMaxSize(e.target.value)}
            style={{ width: 80 }}
          />
        </div>
        <div className="catalogue-table-wrap">
          <table className="catalogue-table">
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Description</th>
                <th>Manufacturer</th>
                <th>Dimensions</th>
                <th>Material</th>
                <th>IP</th>
                <th>Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-mute)', padding: 24 }}>
                  No products. Load a catalogue or adjust filters.
                </td></tr>
              )}
              {visible.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{p.partNumber}</td>
                  <td>{p.description}</td>
                  <td>{p.manufacturer}</td>
                  <td>
                    {p.diameter
                      ? `Ø${p.diameter}`
                      : p.width || p.height
                        ? `${p.width ?? '?'} × ${p.height ?? '?'}`
                        : '—'}
                  </td>
                  <td>{p.material ?? '—'}</td>
                  <td>{p.ipRating ?? '—'}</td>
                  <td>
                    {p.unitCost != null ? `${p.unitCost.toFixed(2)} ${p.currency ?? ''}` : '—'}
                  </td>
                  <td>
                    <button
                      className="btn-ghost btn-tiny"
                      disabled={!selectedContainment}
                      onClick={() => onApply(p)}
                      title={selectedContainment ? 'Apply to selected containment' : 'Select a containment first'}
                    >
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          {!selectedContainment && (
            <span style={{ color: 'var(--text-mute)', fontSize: 11, marginRight: 'auto' }}>
              Select a containment to enable “Apply”
            </span>
          )}
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
