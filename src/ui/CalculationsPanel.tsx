import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import type { ContainmentEntity, Entity } from '../types';
import type { Cable } from '../models/cable';
import {
  computeContainmentFill,
  computeDeratingFactors,
  computeVoltageDrop,
  polylineLength,
  type InstallationMethod,
} from '../calc';
import {
  AMPACITY_REF_C_PVC_COPPER,
  AMPACITY_REF_C_XLPE_COPPER,
  DEFAULT_STANDARDS,
} from '../models/standards';
import {
  cablesOnContainment,
  estimateCableLength,
  fmtNum,
  fmtPct,
  projectStandardsCode,
} from './whole-site-helpers';

export function CalculationsPanel() {
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const sheet = project.sheets[project.activeSheetId];
  const sel = Array.from(editor.selection);
  const ent: Entity | null = sel.length === 1 ? sheet?.entities[sel[0]] ?? null : null;

  return (
    <div className="panel-section">
      <div className="panel-header">Calculations</div>
      <div className="panel-body" style={{ padding: 8 }}>
        {!ent && (
          <div style={{ color: 'var(--text-mute)', fontSize: 11, padding: 8 }}>
            Select a containment or cable-linked wire to see live calculations.
          </div>
        )}
        {ent && ent.kind === 'containment' && <ContainmentCalcs entity={ent as ContainmentEntity} />}
        {ent && ent.kind === 'wire' && <WireCalcs entity={ent} />}
        {ent && ent.kind !== 'containment' && ent.kind !== 'wire' && (
          <div style={{ color: 'var(--text-mute)', fontSize: 11 }}>
            No calculations for {ent.kind}.
          </div>
        )}
      </div>
    </div>
  );
}

function ContainmentCalcs({ entity }: { entity: ContainmentEntity }) {
  const project = useStore((s) => s.project);
  const sheet = project.sheets[project.activeSheetId];

  const cables = useMemo(() => cablesOnContainment(project, entity.id), [project, entity.id]);
  const standards = project.standardsProfile ?? DEFAULT_STANDARDS.BS7671;
  const fill = useMemo(
    () => computeContainmentFill(entity, cables, standards),
    [entity, cables, standards],
  );

  const lengthM = useMemo(() => polylineLength(entity.points ?? []) / 1000, [entity.points]);

  // Count fittings & supports tied to this containment
  const { fittings, supports } = useMemo(() => {
    let f = 0, s = 0;
    for (const id of sheet?.entityOrder ?? []) {
      const e = sheet.entities[id];
      if (!e) continue;
      if (e.kind === 'fitting' && (e as any).containmentId === entity.id) f++;
      if (e.kind === 'support' && (e as any).supportingContainmentIds?.includes(entity.id)) s++;
    }
    return { fittings: f, supports: s };
  }, [sheet, entity.id]);

  const fillStatus = fill.fillStatus;
  const fillAccent: 'good' | 'fail' | undefined =
    fillStatus === 'over' ? 'fail' : fillStatus === 'ok' ? 'good' : undefined;

  return (
    <div className="calc-section">
      <Row label="Type" value={entity.containmentType} />
      <Row label="Size" value={`${entity.width ?? '?'} × ${entity.height ?? '?'} mm`} />
      <Row label="Length" value={`${fmtNum(lengthM, 2)} m`} />
      <Row
        label="Fill"
        value={`${fmtNum(fill.fillPct, 1)}% / ${fmtPct(fill.limit)}`}
        accent={fillAccent}
      />
      <Row label="Inner area" value={`${fmtNum(fill.innerAreaMm2, 0)} mm²`} />
      <Row label="Cables" value={`${cables.length}`} />
      <Row label="Fittings" value={`${fittings}`} />
      <Row label="Supports" value={`${supports}`} />
    </div>
  );
}

const installationMethodFor = (cable: Cable): InstallationMethod => {
  // The wire might pass through any containment; default to tray which
  // matches the BS 7671 Reference Method C ampacity table we use for Iz.
  return 'tray';
};

function WireCalcs({ entity }: { entity: any }) {
  const project = useStore((s) => s.project);
  const cable = entity.cableId ? project.cableSchedule?.cables[entity.cableId] : null;

  if (!cable) {
    return (
      <div style={{ color: 'var(--text-mute)', fontSize: 11 }}>
        Wire is not linked to a cable in the schedule.
      </div>
    );
  }

  const len = useMemo(
    () => cable.estimatedLength ?? estimateCableLength(cable, project),
    [cable, project],
  );

  const standardsCode = projectStandardsCode(project);
  const isXlpe = cable.construction.startsWith('XLPE');
  const baseTable = isXlpe ? AMPACITY_REF_C_XLPE_COPPER : AMPACITY_REF_C_PVC_COPPER;
  const baseAmp = baseTable[cable.csa] ?? 0;

  // Estimate group size from cables sharing route
  const numCircuits = useMemo(() => {
    if (cable.route.length === 0) return 1;
    const cables = Object.values(project.cableSchedule?.cables ?? {});
    let max = 1;
    for (const cid of cable.route) {
      const shared = cables.filter((c) => c.route.includes(cid)).length;
      if (shared > max) max = shared;
    }
    return max;
  }, [cable, project]);

  const derating = useMemo(() => computeDeratingFactors({
    numCircuits,
    ambientC: 30,
    installationMethod: installationMethodFor(cable),
    insulation: isXlpe ? 'XLPE' : 'PVC',
  }), [cable, numCircuits, isXlpe]);

  const deratedAmp = baseAmp * derating.totalFactor;
  const ib = cable.designCurrent ?? 0;
  const ampacityOk = deratedAmp >= ib;

  const vdrop = useMemo(() => computeVoltageDrop({
    construction: cable.construction,
    csa: cable.csa,
    lengthM: len,
    designCurrentA: ib,
    systemVoltageV: cable.voltage || 230,
    phasing: cable.cores >= 3 ? 'three' : 'single',
    loadCategory: 'other',
    standardsCode,
  }), [cable, len, ib, standardsCode]);

  return (
    <div className="calc-section">
      <Row label="Cable" value={cable.reference} />
      <Row label="From → To" value={`${cable.from} → ${cable.to}`} />
      <Row label="Cores × CSA" value={`${cable.cores} × ${cable.csa} mm²`} />
      <Row label="Length" value={`${fmtNum(len, 2)} m`} />
      <Row label="Base Iz" value={`${fmtNum(baseAmp, 0)} A`} />
      <Row label="Derate factors" value={`Cg ${fmtNum(derating.Cg, 2)} · Ca ${fmtNum(derating.Ca, 2)} · Cc ${fmtNum(derating.Cc, 2)}`} />
      <Row
        label="Derated Iz"
        value={`${fmtNum(deratedAmp, 0)} A · Ib ${fmtNum(ib, 0)} A`}
        accent={ampacityOk ? 'good' : 'fail'}
      />
      <Row
        label="V-drop"
        value={`${fmtNum(vdrop.vdropV, 2)} V · ${fmtNum(vdrop.vdropPct, 2)}% / ${fmtNum(vdrop.limitPct, 1)}%`}
        accent={vdrop.withinLimits ? 'good' : 'fail'}
      />
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'fail' }) {
  return (
    <div className="calc-row">
      <span className="calc-row-label">{label}</span>
      <span className={`calc-row-value${accent ? ` accent-${accent}` : ''}`}>{value}</span>
    </div>
  );
}
