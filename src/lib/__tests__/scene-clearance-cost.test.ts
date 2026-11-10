import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeFixture, routeProject } from './route-fixtures';

const calls = vi.hoisted(() => ({ routePath: 0 }));
vi.mock('../route-path', async importOriginal => {
  const actual = await importOriginal<typeof import('../route-path')>();
  return { ...actual, routePath: (...args: Parameters<typeof actual.routePath>) => { calls.routePath++; return actual.routePath(...args); } };
});
const { analyzeSceneClearance } = await import('../scene-clearance');
const { runComplianceChecks } = await import('../../calc/compliance');

describe('clearance analysis cost', () => {
  beforeEach(() => { calls.routePath = 0; });
  const farRoutes = (n: number) => Array.from({ length: n }, (_, i) =>
    routeFixture('r' + i, [{ x: 0, y: i * 5000, z: 2400 }, { x: 3000, y: i * 5000, z: 2400 }]));

  it('does not rebuild route paths for pairs that are far apart', () => {
    const routes = farRoutes(20);
    expect(analyzeSceneClearance(routeProject(...routes), routes[0])).toEqual([]);
    // One path per route box set (20) is acceptable; two per pair (about 760) is not.
    expect(calls.routePath).toBeLessThanOrEqual(routes.length + 1);
  });

  it('builds each route once for a whole-project compliance run', () => {
    const routes = farRoutes(20);
    runComplianceChecks(routeProject(...routes));
    expect(calls.routePath).toBeLessThan(routes.length * 3);
  });
});
