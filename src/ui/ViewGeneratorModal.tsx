import React, { useState } from 'react';
import { useStore } from '../state/store';
import { useBuildings } from '../state/selectors';
import { notify } from '../state/notifications';
import {
  generateCrossSection,
  generateElevationView,
  generateRiserDiagram,
  generateIsometric,
} from '../views';
import {
  createCrossSectionSheet,
  createElevationSheet,
  createRiserDiagramSheet,
  createDetailSheet,
} from '../drawing/templates';

export type ViewGeneratorKind = 'cross-section' | 'elevation' | 'riser' | 'isometric';

interface ViewGeneratorModalProps {
  kind: ViewGeneratorKind;
  onClose: () => void;
}

// A single number-input row used by every generator dialog. We keep the
// markup intentionally small — the modal is a one-shot prompt, so heavy
// form widgets would only get in the way of a quick generate.
function NumberField({
  label,
  value,
  onChange,
  step = 100,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="vg-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function ViewGeneratorModal({ kind, onClose }: ViewGeneratorModalProps) {
  const buildingsMap = useBuildings();
  const addSheet = useStore((s) => s.addSheet);
  const addEntities = useStore((s) => s.addEntities);
  const setStatus = useStore((s) => s.setStatus);

  // Common inputs across multiple generators
  const [name, setName] = useState<string>(() => {
    if (kind === 'cross-section') return 'Section A-A';
    if (kind === 'elevation') return 'North Elevation';
    if (kind === 'riser') return 'Riser Diagram';
    return 'Isometric View';
  });
  const [ref, setRef] = useState<string>(() => {
    if (kind === 'cross-section') return 'A-A';
    if (kind === 'elevation') return 'N';
    return 'ISO-1';
  });

  // Cross-section / elevation inputs (cut line / view line)
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [endX, setEndX] = useState(10000);
  const [endY, setEndY] = useState(0);
  const [depth, setDepth] = useState(2000);

  // Riser inputs
  const buildings = Object.values(buildingsMap ?? {});
  const [buildingId, setBuildingId] = useState<string>(buildings[0]?.id ?? '');

  // Isometric inputs
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [scale, setScale] = useState(0.5);

  const titleByKind: Record<ViewGeneratorKind, string> = {
    'cross-section': 'Generate Cross-Section',
    elevation: 'Generate Elevation View',
    riser: 'Generate Riser Diagram',
    isometric: 'Generate Isometric View',
  };

  const onGenerate = () => {
    // Snapshot before addSheet — matches the previous closure-over-render
    // value: generators receive the project as it was when the user clicked.
    const project = useStore.getState().project;
    let entities: ReturnType<typeof generateCrossSection> = [];
    let newSheet;

    if (kind === 'cross-section') {
      newSheet = createCrossSectionSheet(name, ref);
      addSheet(newSheet);
      // After addSheet the new sheet is active; pull its assigned id from
      // the store so view generators (which are passed a sheetId) can use
      // a real one even though they currently don't depend on it.
      const activeId = useStore.getState().project.activeSheetId;
      entities = generateCrossSection({
        project,
        sheetId: activeId,
        cutA: { x: startX, y: startY },
        cutB: { x: endX, y: endY },
        viewName: name,
      });
    } else if (kind === 'elevation') {
      newSheet = createElevationSheet(name, ref);
      addSheet(newSheet);
      const activeId = useStore.getState().project.activeSheetId;
      entities = generateElevationView({
        project,
        sheetId: activeId,
        viewLine: {
          from: { x: startX, y: startY },
          to: { x: endX, y: endY },
          depth,
        },
        viewName: name,
      });
    } else if (kind === 'riser') {
      if (!buildingId) {
        notify('warning', 'Select a building before generating a riser diagram.');
        return;
      }
      newSheet = createRiserDiagramSheet(name);
      addSheet(newSheet);
      entities = generateRiserDiagram({ project, buildingId });
    } else if (kind === 'isometric') {
      newSheet = createDetailSheet(name, ref);
      addSheet(newSheet);
      const activeId = useStore.getState().project.activeSheetId;
      entities = generateIsometric({
        project,
        sheetId: activeId,
        originX,
        originY,
        scale,
      });
    }

    if (entities.length === 0) {
      setStatus(`${name}: no entities generated (check inputs)`);
    } else {
      addEntities(entities);
      setStatus(`Generated ${entities.length} entities on ${name}`);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 420, maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {titleByKind[kind]}
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto' }}>
            ×
          </span>
        </div>
        <div className="modal-body" style={{ padding: 16 }}>
          <div className="vg-grid">
            <label className="vg-field">
              <span>Sheet name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {(kind === 'cross-section' || kind === 'elevation' || kind === 'isometric') && (
              <label className="vg-field">
                <span>Reference</span>
                <input
                  type="text"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                />
              </label>
            )}

            {(kind === 'cross-section' || kind === 'elevation') && (
              <>
                <NumberField label="Start X (mm)" value={startX} onChange={setStartX} />
                <NumberField label="Start Y (mm)" value={startY} onChange={setStartY} />
                <NumberField label="End X (mm)" value={endX} onChange={setEndX} />
                <NumberField label="End Y (mm)" value={endY} onChange={setEndY} />
              </>
            )}
            {kind === 'elevation' && (
              <NumberField label="Depth (mm)" value={depth} onChange={setDepth} />
            )}

            {kind === 'riser' && (
              <label className="vg-field">
                <span>Building</span>
                <select
                  value={buildingId}
                  onChange={(e) => setBuildingId(e.target.value)}
                >
                  {buildings.length === 0 && <option value="">— no buildings —</option>}
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {kind === 'isometric' && (
              <>
                <NumberField label="Origin X (mm)" value={originX} onChange={setOriginX} />
                <NumberField label="Origin Y (mm)" value={originY} onChange={setOriginY} />
                <NumberField
                  label="Scale"
                  value={scale}
                  step={0.1}
                  onChange={setScale}
                />
              </>
            )}
          </div>
          <p className="vg-hint">
            Coordinates are in world millimetres. The new sheet is created and
            switched to automatically.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onGenerate}>
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
