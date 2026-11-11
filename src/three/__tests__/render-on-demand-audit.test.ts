// Source guard for render on demand (audit finding opencad-10). The React
// components are not unit-tested in this repo (node environment, no DOM), so
// this pins the wiring that keeps the 3D views from going stale or from
// returning to a continuous render loop.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(fileURLToPath(new URL('../' + name, import.meta.url)), 'utf8');
const count = (text: string, needle: string | RegExp) =>
  typeof needle === 'string' ? text.split(needle).length - 1 : (text.match(needle) ?? []).length;
const RAF = /\brequestAnimationFrame\s*\(/g;
const CATCH_ALL = /useEffect\(\(\) => \{\s*(?:scheduler\.)?invalidate\(\);\s*\}\);/;

describe('render on demand wiring', () => {
  const panel = source('Panel3D.tsx');
  const site = source('SiteSceneViewer.tsx');
  const selection = source('SceneSelectionOverlay.tsx');
  const clearance = source('SceneClearanceOverlay.tsx');
  const placement = source('ScenePlacement.ts');

  it('has no free-running frame loop', () => {
    expect(count(panel, RAF)).toBe(0);
    // The one allowed call is the deferred focus pose, which invalidates itself.
    expect(count(site, RAF)).toBe(1);
    expect(site).toMatch(/requestAnimationFrame\(\(\) => \{\s*frameObject\(camera, orbit, invalidate,/);
    expect(count(selection, RAF)).toBe(0);
    expect(count(clearance, RAF)).toBe(0);
    // The pointer coalescing frame in placement leads to onSceneChange.
    expect(count(placement, RAF)).toBe(1);
  });

  it('draws only through a scheduler target', () => {
    expect(count(panel, 'renderer.render(')).toBe(1);
    expect(panel).toMatch(/scheduler\.attach\(\{ render: \(\) => renderer\.render\(scene, camera\) \}\)/);
    expect(count(site, 'renderer.render(')).toBe(1);
    expect(site).toMatch(/scheduler\.attach\(\{\s*beforeRender: \(\) => settleOrbitStep\(controls, camera, renderer\.domElement\.height\),\s*render: \(\) => renderer\.render\(scene, camera\),/);
  });

  it('detaches before disposing the renderer', () => {
    for (const text of [panel, site]) {
      const detach = text.indexOf('detachRender();');
      expect(detach).toBeGreaterThan(-1);
      expect(detach).toBeLessThan(text.indexOf('renderer.dispose();'));
    }
  });

  it('keeps a dependency-free catch-all effect in both viewers', () => {
    expect(panel).toMatch(CATCH_ALL);
    expect(site).toMatch(CATCH_ALL);
  });

  it('invalidates on the paths outside React commits', () => {
    expect(site).toContain("controls.addEventListener('change', invalidate)");
    expect(site).toContain('onSceneChange: invalidate');
    expect(site).toContain('useComponentPlacement.subscribe(() => invalidate())');
    expect(site).toContain("withInvalidate(built.controls, invalidate, ['dispose'])");
    for (const text of [panel, site]) {
      expect(text).toContain("addEventListener('webglcontextrestored', invalidate)");
      expect(text).toContain("addEventListener('opencad:invalidate-3d', invalidate)");
      expect(text).toContain("document.addEventListener('visibilitychange', onVisible)");
      expect(text).toContain('scheduler.renderNow();');
    }
    expect(panel).toMatch(/new THREE\.Vector3\(400, 250, 0\),\s*scheduler\.invalidate\s*\)/);
  });

  it('drives both overlays from the viewer scheduler', () => {
    expect(count(site, 'scheduler={scheduler}')).toBe(2);
    expect(selection).toContain('scheduler.onFrame(update)');
    expect(clearance).toContain('scheduler.onFrame(update)');
  });

  it('keeps shadows and antialiasing as they were', () => {
    for (const text of [panel, site]) {
      expect(text).toContain('antialias: true');
      expect(text).toContain('THREE.PCFSoftShadowMap');
      expect(text).not.toContain('preserveDrawingBuffer');
    }
  });
});
