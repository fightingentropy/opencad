import React from 'react';
import { useStore } from '../state/store';
import { getSymbol } from '../symbols';
import type { Entity } from '../types';

export function RightPanel() {
  return (
    <div className="right-panel">
      <Properties />
      <ProjectInfo />
    </div>
  );
}

function Properties() {
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const updateEntity = useStore((s) => s.updateEntity);
  const sheet = project.sheets[project.activeSheetId];
  const sel = Array.from(editor.selection);
  const single = sel.length === 1 ? sheet.entities[sel[0]] : null;

  return (
    <div className="panel-section flex">
      <div className="panel-header">
        Properties
        <div className="panel-actions">
          <span className="kbd">{sel.length} sel</span>
        </div>
      </div>
      <div className="panel-body">
        {sel.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-mute)', fontSize: 12, textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>Nothing selected</div>
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              Click an entity to inspect or edit. Drag a selection box to multi-select.
              <br />
              <br />
              Press <span className="kbd">R</span> to rotate symbols 90°.
              <br />
              Press <span className="kbd">Del</span> to delete.
            </div>
          </div>
        )}
        {sel.length > 1 && (
          <div style={{ padding: 12 }}>
            <div className="prop-row">
              <span className="prop-label">Selected</span>
              <span style={{ color: 'var(--accent)' }}>{sel.length} entities</span>
            </div>
            <div className="prop-row">
              <span className="prop-label">Kinds</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {Array.from(new Set(sel.map((id) => sheet.entities[id]?.kind))).join(', ')}
              </span>
            </div>
          </div>
        )}
        {single && <SinglePropertiesEditor entity={single} onUpdate={(p) => updateEntity(single.id, p as any)} />}
      </div>
    </div>
  );
}

function SinglePropertiesEditor({ entity, onUpdate }: { entity: Entity; onUpdate: (p: Partial<Entity>) => void }) {
  const project = useStore((s) => s.project);
  const layers = project.layerOrder.map((id) => project.layers[id]);
  const symbolDef = entity.kind === 'symbol' ? getSymbol(entity.symbolId) : null;

  return (
    <div style={{ padding: '8px 0' }}>
      <Section title="General">
        <Row label="Type">
          <span style={{ color: 'var(--accent)', textTransform: 'uppercase', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {entity.kind}
          </span>
        </Row>
        <Row label="ID">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mute)' }}>{entity.id}</span>
        </Row>
        <Row label="Layer">
          <select
            value={entity.layerId}
            onChange={(e) => onUpdate({ layerId: e.target.value } as any)}
          >
            {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Row>
        <Row label="Color">
          <input type="color" value={entity.color ?? project.layers[entity.layerId].color}
            onChange={(e) => onUpdate({ color: e.target.value } as any)} />
        </Row>
        <Row label="Line Width">
          <input type="number" step="0.1" min="0.1" max="5" value={entity.lineWidth ?? project.layers[entity.layerId].lineWidth}
            onChange={(e) => onUpdate({ lineWidth: parseFloat(e.target.value) } as any)} />
        </Row>
        <Row label="Locked">
          <input type="checkbox" checked={entity.locked} onChange={(e) => onUpdate({ locked: e.target.checked } as any)} />
        </Row>
      </Section>

      {entity.kind === 'symbol' && (
        <>
          <Section title={symbolDef ? symbolDef.name : 'Symbol'}>
            <Row label="Tag">
              <input value={entity.tag ?? ''} placeholder={symbolDef?.tagPrefix ? `${symbolDef.tagPrefix}…` : ''}
                onChange={(e) => onUpdate({ tag: e.target.value } as any)} />
            </Row>
            <Row label="Description">
              <input value={entity.description ?? ''}
                onChange={(e) => onUpdate({ description: e.target.value } as any)} />
            </Row>
            <Row label="Manufacturer">
              <input value={entity.manufacturer ?? ''}
                onChange={(e) => onUpdate({ manufacturer: e.target.value } as any)} />
            </Row>
            <Row label="Part Number">
              <input value={entity.partNumber ?? ''}
                onChange={(e) => onUpdate({ partNumber: e.target.value } as any)} />
            </Row>
            <Row label="Rating">
              <input value={entity.rating ?? ''}
                onChange={(e) => onUpdate({ rating: e.target.value } as any)} />
            </Row>
          </Section>
          <Section title="Geometry">
            <Row label="X (mm)">
              <input type="number" step="1" value={entity.position.x.toFixed(2)}
                onChange={(e) => onUpdate({ position: { ...entity.position, x: parseFloat(e.target.value) } } as any)} />
            </Row>
            <Row label="Y (mm)">
              <input type="number" step="1" value={entity.position.y.toFixed(2)}
                onChange={(e) => onUpdate({ position: { ...entity.position, y: parseFloat(e.target.value) } } as any)} />
            </Row>
            <Row label="Rotation">
              <input type="number" step="15" value={(entity.rotation * 180 / Math.PI).toFixed(1)}
                onChange={(e) => onUpdate({ rotation: parseFloat(e.target.value) * Math.PI / 180 } as any)} />
            </Row>
            <Row label="Scale">
              <input type="number" step="0.1" min="0.1" value={entity.scale}
                onChange={(e) => onUpdate({ scale: parseFloat(e.target.value) } as any)} />
            </Row>
            <Row label="Mirror">
              <input type="checkbox" checked={!!entity.mirror}
                onChange={(e) => onUpdate({ mirror: e.target.checked } as any)} />
            </Row>
          </Section>
        </>
      )}

      {entity.kind === 'wire' && (
        <Section title="Wire">
          <Row label="Wire Number">
            <input value={entity.wireNumber ?? ''}
              onChange={(e) => onUpdate({ wireNumber: e.target.value } as any)} />
          </Row>
          <Row label="Wire Type">
            <select value={entity.wireType ?? ''}
              onChange={(e) => onUpdate({ wireType: e.target.value } as any)}>
              <option value="">—</option>
              <option value="L1">L1 (Black)</option>
              <option value="L2">L2 (Red)</option>
              <option value="L3">L3 (Blue)</option>
              <option value="N">N (White)</option>
              <option value="PE">PE (Green)</option>
              <option value="24VDC+">24VDC +</option>
              <option value="24VDC-">24VDC −</option>
              <option value="120VAC">120VAC</option>
              <option value="Control">Control</option>
            </select>
          </Row>
          <Row label="Gauge">
            <select value={entity.gauge ?? ''}
              onChange={(e) => onUpdate({ gauge: e.target.value } as any)}>
              <option value="">—</option>
              <option value="22 AWG">22 AWG</option>
              <option value="18 AWG">18 AWG</option>
              <option value="16 AWG">16 AWG</option>
              <option value="14 AWG">14 AWG</option>
              <option value="12 AWG">12 AWG</option>
              <option value="10 AWG">10 AWG</option>
              <option value="8 AWG">8 AWG</option>
              <option value="6 AWG">6 AWG</option>
              <option value="2.5 mm²">2.5 mm²</option>
              <option value="4 mm²">4 mm²</option>
              <option value="6 mm²">6 mm²</option>
              <option value="10 mm²">10 mm²</option>
            </select>
          </Row>
        </Section>
      )}

      {entity.kind === 'text' && (
        <Section title="Text">
          <Row label="Text">
            <input value={entity.text} onChange={(e) => onUpdate({ text: e.target.value } as any)} />
          </Row>
          <Row label="Font Size">
            <input type="number" step="0.5" min="1" value={entity.fontSize}
              onChange={(e) => onUpdate({ fontSize: parseFloat(e.target.value) } as any)} />
          </Row>
          <Row label="Rotation">
            <input type="number" step="15" value={(entity.rotation * 180 / Math.PI).toFixed(1)}
              onChange={(e) => onUpdate({ rotation: parseFloat(e.target.value) * Math.PI / 180 } as any)} />
          </Row>
        </Section>
      )}
    </div>
  );
}

function ProjectInfo() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const upd = (patch: Partial<typeof project>) => setProject({ ...project, ...patch, modified: Date.now() });

  return (
    <div className="panel-section">
      <div className="panel-header">Project</div>
      <div style={{ padding: '4px 0' }}>
        <Row label="Name">
          <input value={project.name} onChange={(e) => upd({ name: e.target.value })} />
        </Row>
        <Row label="Client">
          <input value={project.client ?? ''} onChange={(e) => upd({ client: e.target.value })} />
        </Row>
        <Row label="Engineer">
          <input value={project.engineer ?? ''} onChange={(e) => upd({ engineer: e.target.value })} />
        </Row>
        <Row label="Standard">
          <select value={project.standard} onChange={(e) => upd({ standard: e.target.value as any })}>
            <option value="IEEE">IEEE / JIC</option>
            <option value="IEC">IEC</option>
          </select>
        </Row>
        <Row label="Units">
          <select value={project.units} onChange={(e) => upd({ units: e.target.value as any })}>
            <option value="mm">mm</option>
            <option value="in">inch</option>
          </select>
        </Row>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        padding: '4px 10px', fontSize: 10, color: 'var(--text-mute)',
        textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600,
        background: 'var(--bg-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)'
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-value">{children}</span>
    </div>
  );
}
