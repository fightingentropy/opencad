// Sanity-snapshot the canonical BS 7671 / NEC reference tables. These
// values come straight out of the standards — accidental edits could
// produce silently-wrong calculations elsewhere in the engine.

import { describe, it, expect } from 'vitest';
import {
  FILL_LIMITS,
  GROUPING_FACTORS_ENCLOSED,
  GROUPING_FACTORS_TRAY,
  AMBIENT_FACTORS_PVC,
  AMBIENT_FACTORS_XLPE,
  AMPACITY_REF_C_PVC_COPPER,
  AMPACITY_REF_C_XLPE_COPPER,
  VDROP_MV_A_M_PVC_SP,
  VDROP_MV_A_M_XLPE_3P,
  SUPPORT_SPANS_HORIZONTAL_MM,
  SEGREGATION_MIN_MM,
  VDROP_LIMITS,
} from '../standards';

describe('FILL_LIMITS', () => {
  it('BS 7671 trunking = 0.45, conduit = 0.40', () => {
    expect(FILL_LIMITS.BS7671.trunking).toBe(0.45);
    expect(FILL_LIMITS.BS7671.conduit).toBe(0.40);
  });

  it('NEC tier limits are 53 / 31 / 40 percent', () => {
    expect(FILL_LIMITS.NEC.nec1Conductor).toBe(0.53);
    expect(FILL_LIMITS.NEC.nec2Conductor).toBe(0.31);
    expect(FILL_LIMITS.NEC.nec3PlusConductor).toBe(0.40);
  });

  it('all profiles allow up to 100% on cable trays / ladders / baskets (single layer)', () => {
    for (const code of ['BS7671', 'NEC', 'IEC', 'AS-NZS'] as const) {
      expect(FILL_LIMITS[code].cableTray).toBe(1.0);
      expect(FILL_LIMITS[code].cableLadder).toBe(1.0);
      expect(FILL_LIMITS[code].cableBasket).toBe(1.0);
    }
  });
});

describe('grouping factors', () => {
  it('Table 4C1 enclosed: 1=1.00, 2=0.80, 4=0.65, 6=0.57', () => {
    expect(GROUPING_FACTORS_ENCLOSED[1]).toBe(1.0);
    expect(GROUPING_FACTORS_ENCLOSED[2]).toBe(0.80);
    expect(GROUPING_FACTORS_ENCLOSED[4]).toBe(0.65);
    expect(GROUPING_FACTORS_ENCLOSED[6]).toBe(0.57);
  });

  it('Table 4C3 tray (touching): 1=1.00, 2=0.85, 4=0.75', () => {
    expect(GROUPING_FACTORS_TRAY[1]).toBe(1.0);
    expect(GROUPING_FACTORS_TRAY[2]).toBe(0.85);
    expect(GROUPING_FACTORS_TRAY[4]).toBe(0.75);
  });
});

describe('ambient correction tables', () => {
  it('PVC at 30°C = 1.00, 40°C = 0.87, 50°C = 0.71', () => {
    expect(AMBIENT_FACTORS_PVC[30]).toBe(1.0);
    expect(AMBIENT_FACTORS_PVC[40]).toBe(0.87);
    expect(AMBIENT_FACTORS_PVC[50]).toBe(0.71);
  });

  it('XLPE at 30°C = 1.00, 40°C = 0.91, 50°C = 0.82', () => {
    expect(AMBIENT_FACTORS_XLPE[30]).toBe(1.0);
    expect(AMBIENT_FACTORS_XLPE[40]).toBe(0.91);
    expect(AMBIENT_FACTORS_XLPE[50]).toBe(0.82);
  });
});

describe('reference ampacities (Method C, copper)', () => {
  it('PVC 2.5mm² = 24A, 16mm² = 76A', () => {
    expect(AMPACITY_REF_C_PVC_COPPER[2.5]).toBe(24);
    expect(AMPACITY_REF_C_PVC_COPPER[16]).toBe(76);
  });

  it('XLPE 2.5mm² = 30A, 16mm² = 94A, 50mm² = 180A', () => {
    expect(AMPACITY_REF_C_XLPE_COPPER[2.5]).toBe(30);
    expect(AMPACITY_REF_C_XLPE_COPPER[16]).toBe(94);
    expect(AMPACITY_REF_C_XLPE_COPPER[50]).toBe(180);
  });
});

describe('voltage drop tables', () => {
  it('PVC single-phase 2.5mm² = 18 mV/A/m', () => {
    expect(VDROP_MV_A_M_PVC_SP[2.5]).toBe(18);
  });

  it('PVC single-phase 1.5mm² = 29 mV/A/m', () => {
    expect(VDROP_MV_A_M_PVC_SP[1.5]).toBe(29);
  });

  it('XLPE three-phase 16mm² = 2.4 mV/A/m', () => {
    expect(VDROP_MV_A_M_XLPE_3P[16]).toBe(2.4);
  });

  it('VDROP_LIMITS lighting = 3%, other = 5% (BS 7671)', () => {
    expect(VDROP_LIMITS.BS7671.lighting).toBe(0.03);
    expect(VDROP_LIMITS.BS7671.other).toBe(0.05);
  });
});

describe('support span tables', () => {
  it('200mm tray = 1800mm, 300mm tray = 1500mm', () => {
    expect(SUPPORT_SPANS_HORIZONTAL_MM.tray[200]).toBe(1800);
    expect(SUPPORT_SPANS_HORIZONTAL_MM.tray[300]).toBe(1500);
  });

  it('25mm steel conduit = 2000mm, 25mm PVC conduit = 900mm', () => {
    expect(SUPPORT_SPANS_HORIZONTAL_MM.conduit_steel[25]).toBe(2000);
    expect(SUPPORT_SPANS_HORIZONTAL_MM.conduit_pvc[25]).toBe(900);
  });

  it('150mm ladder = 3000mm, 900mm ladder = 2500mm', () => {
    expect(SUPPORT_SPANS_HORIZONTAL_MM.ladder[150]).toBe(3000);
    expect(SUPPORT_SPANS_HORIZONTAL_MM.ladder[900]).toBe(2500);
  });
});

describe('segregation distances', () => {
  it('power vs data = 50mm minimum', () => {
    expect(SEGREGATION_MIN_MM.power.data).toBe(50);
    expect(SEGREGATION_MIN_MM.data.power).toBe(50);
  });

  it('data vs fire-alarm = 25mm minimum', () => {
    expect(SEGREGATION_MIN_MM.data['fire-alarm']).toBe(25);
  });
});
