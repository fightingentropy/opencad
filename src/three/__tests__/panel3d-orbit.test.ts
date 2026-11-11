import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { makeOrbitControls } from '../Panel3D';

function mouse(type: string, init: Record<string, number>) {
  return Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: 0, clientY: 0, ...init });
}

function setup() {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const dom = new EventTarget() as unknown as HTMLElement;
  const camera = new THREE.PerspectiveCamera(45, 1.5, 1, 100000);
  camera.position.set(1200, 900, 1500);
  camera.lookAt(400, 250, 0);
  camera.updateMatrixWorld(true);
  const onChange = vi.fn();
  const orbit = makeOrbitControls(camera, dom, new THREE.Vector3(400, 250, 0), onChange);
  return { win, dom, camera, onChange, orbit };
}

describe('Panel3D orbit controls request a frame on every camera move', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rotate, pan and wheel each call onChange and move the camera', () => {
    const { win, dom, camera, onChange } = setup();
    const start = camera.position.clone();

    dom.dispatchEvent(mouse('mousedown', { button: 0 }));
    win.dispatchEvent(mouse('mousemove', { clientX: 30, clientY: 10 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(camera.position.distanceTo(start)).toBeGreaterThan(1);
    win.dispatchEvent(mouse('mouseup', {}));

    const afterRotate = camera.position.clone();
    dom.dispatchEvent(mouse('mousedown', { button: 2, clientX: 0, clientY: 0 }));
    win.dispatchEvent(mouse('mousemove', { clientX: 20, clientY: 15 }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(camera.position.distanceTo(afterRotate)).toBeGreaterThan(1);
    win.dispatchEvent(mouse('mouseup', {}));

    const afterPan = camera.position.clone();
    dom.dispatchEvent(mouse('wheel', { deltaY: 100, deltaMode: 0 }));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(camera.position.distanceTo(afterPan)).toBeGreaterThan(1);
  });

  it('a mouse move with no button down does not request a frame', () => {
    const { win, onChange } = setup();
    win.dispatchEvent(mouse('mousemove', { clientX: 50, clientY: 50 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('after dispose no event requests a frame', () => {
    const { win, dom, onChange, orbit } = setup();
    orbit.dispose();
    dom.dispatchEvent(mouse('mousedown', { button: 0 }));
    win.dispatchEvent(mouse('mousemove', { clientX: 30, clientY: 10 }));
    dom.dispatchEvent(mouse('wheel', { deltaY: 100, deltaMode: 0 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
