import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { settleOrbitStep } from '../orbit-settle';
import { createRenderScheduler } from '../render-scheduler';

// A canvas stand-in good enough for OrbitControls' pointer handlers in node.
function stubCanvas() {
  const element = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(element, {
    style: {}, clientWidth: 1000, clientHeight: 800, height: 800,
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
    getRootNode() { return element; }, ownerDocument: element,
  });
  return element as unknown as HTMLElement;
}

function pointer(type: string, x: number, y: number) {
  return Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, pageX: x, pageY: y, ctrlKey: false, metaKey: false, shiftKey: false });
}

function makeView(target: THREE.Vector3) {
  const canvas = stubCanvas();
  const camera = new THREE.PerspectiveCamera(45, 1000 / 800, 10, 400000);
  camera.up.set(0, 0, 1);
  camera.position.copy(target).add(new THREE.Vector3(8000, -9000, 7000));
  camera.lookAt(target);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.target.copy(target);
  controls.update();
  return { canvas, camera, controls };
}

function drag(canvas: HTMLElement, button: number, dx: number) {
  canvas.dispatchEvent(Object.assign(pointer('pointerdown', 400, 400), { button }));
  for (let i = 1; i <= 5; i++) canvas.dispatchEvent(Object.assign(pointer('pointermove', 400 + dx * i / 5, 400 + dx * i / 10), { button }));
  canvas.dispatchEvent(Object.assign(pointer('pointerup', 400 + dx, 400 + dx / 2), { button }));
}

function glide(view: ReturnType<typeof makeView>) {
  const queue: (() => void)[] = [];
  const scheduler = createRenderScheduler({
    requestFrame: (cb) => { queue.push(cb); return queue.length; },
    cancelFrame: () => {},
  });
  let renders = 0;
  view.controls.addEventListener('change', scheduler.invalidate);
  scheduler.attach({ beforeRender: () => settleOrbitStep(view.controls, view.camera, 800), render: () => { renders++; } });
  let frames = 0;
  while (queue.length && frames < 5000) { queue.shift()!(); frames++; }
  return { frames, renders, scheduler, queue };
}

// Where a damped glide really comes to rest: let a twin run for a long time.
function restingPose(target: THREE.Vector3, button: number, dx: number) {
  const twin = makeView(target);
  drag(twin.canvas, button, dx);
  for (let i = 0; i < 20000; i++) twin.controls.update();
  return { position: twin.camera.position.clone(), target: twin.controls.target.clone() };
}

describe('OrbitControls damping under render on demand', () => {
  // OrbitControls listens for modifier keys on document.
  beforeAll(() => { vi.stubGlobal('document', new EventTarget()); });
  afterAll(() => { vi.unstubAllGlobals(); });

  for (const [name, button, origin] of [
    ['rotate', 0, new THREE.Vector3(12000, 8000, 3000)],
    ['pan', 2, new THREE.Vector3(12000, 8000, 3000)],
    // A target coordinate at 0 is the slow case: the pan remainder never rounds away.
    ['pan near the origin', 2, new THREE.Vector3(0, 0, 0)],
  ] as const) {
    it(`${name}: the glide stops within a couple of seconds and ends at the resting pose`, () => {
      const view = makeView(origin);
      drag(view.canvas, button, 120);
      const { frames, renders, queue } = glide(view);
      expect(queue.length).toBe(0);
      expect(renders).toBe(frames);
      expect(frames).toBeGreaterThan(5);
      expect(frames).toBeLessThan(180);
      const rest = restingPose(origin, button, 120);
      const distance = view.camera.position.distanceTo(view.controls.target);
      // Within a millionth of the viewing distance of the true resting pose.
      expect(view.camera.position.distanceTo(rest.position) / distance).toBeLessThan(1e-6);
      expect(view.controls.target.distanceTo(rest.target) / distance).toBeLessThan(1e-6);
      // Settled: another update reports no motion, so a later frame stays idle.
      expect(view.controls.update()).toBe(false);
    });
  }

  it('a later unrelated invalidate after settling draws one frame and stays idle', () => {
    const view = makeView(new THREE.Vector3(12000, 8000, 3000));
    drag(view.canvas, 2, 120);
    const run = glide(view);
    run.scheduler.invalidate();
    let frames = 0;
    while (run.queue.length && frames < 100) { run.queue.shift()!(); frames++; }
    expect(frames).toBe(1);
  });
});
