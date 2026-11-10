import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/math', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/math')>();
  return { ...actual, entityBounds: vi.fn(actual.entityBounds) };
});

import { render2d } from '../render2d';
import * as math from '../../lib/math';
import { createContainmentSampleProject } from '../../sample-containment';
import { useStore } from '../../state/store';
import { getSymbol } from '../../symbols';

beforeAll(() => vi.stubGlobal('Path2D', class {
  moveTo = () => undefined;
  lineTo = () => undefined;
}));
afterAll(() => vi.unstubAllGlobals());

const ctx = new Proxy({ globalAlpha: 1, font: '10px sans-serif', measureText: () => ({ width: 10 }) } as Record<string, unknown>, {
  get: (t, p: string) => t[p] ?? (() => undefined),
  set: (t, p: string, v) => { t[p] = v; return true; },
}) as unknown as CanvasRenderingContext2D;

describe('render2d entity bounds cache', () => {
  it('does not recompute bounds for unchanged entities on the next frame', () => {
    const project = createContainmentSampleProject();
    const editor = {
      ...useStore.getState().editor,
      viewport: { x: 2500, y: 2500, zoom: 0.1 },
      selection: new Set<string>(), hover: null, drafting: null, pendingSymbol: null,
    };
    const frame = () => render2d(ctx, project, editor, { width: 900, height: 700, dpr: 1, symbolLookup: getSymbol });
    const spy = vi.mocked(math.entityBounds);
    spy.mockClear();
    frame();
    const first = spy.mock.calls.length;
    spy.mockClear();
    frame();
    expect(first).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
