// Render on demand for the 3D viewers (audit finding opencad-10).
//
// The viewers used to call renderer.render on every animation frame, forever,
// with a 2048 PCFSoft shadow map, even when nothing on screen changed. A
// RenderScheduler instead draws a frame only after something asks for one
// with invalidate(): a camera move, a resize, a scene mutation, a selection or
// appearance change. Several requests inside one frame coalesce into a
// single render.
//
// The rule for any code that changes what the 3D view shows (scene graph,
// materials, visibility, camera, renderer size) outside a React commit:
// call invalidate() afterwards. When in doubt, invalidate: an extra frame is
// cheap, a stale view is the failure to avoid.
//
// This module is plain TypeScript (apart from the tiny hook) so the
// scheduling contract is unit-tested in node.

import { useState } from 'react';

export interface RenderTarget {
  /** Draw the frame. */
  render(): void;
  /**
   * Runs before render on every frame. Return true to ask for another frame
   * after this one ("still animating", for example OrbitControls damping).
   * invalidate() calls raised while it runs are ignored, so a 'change' event
   * fired from inside it cannot override its answer.
   */
  beforeRender?(): boolean;
}

export interface RenderScheduler {
  /** Request one frame. Coalesces; a no-op while no target is attached. */
  invalidate(): void;
  /**
   * Cancel any pending frame and draw now, synchronously. Used after
   * renderer.setSize, which clears the drawing buffer, so the browser never
   * paints a blank canvas for a frame.
   */
  renderNow(): void;
  /** Attach the view to draw. Always schedules a first frame. Returns detach. */
  attach(target: RenderTarget): () => void;
  /** Called after every successful render, in subscription order. Returns unsubscribe. */
  onFrame(listener: () => void): () => void;
}

export interface RenderSchedulerDeps {
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
  logError?: (error: unknown) => void;
}

export function createRenderScheduler(deps: RenderSchedulerDeps = {}): RenderScheduler {
  // Resolved lazily so the module can be imported where no window exists.
  const requestFrame = deps.requestFrame ?? ((cb: () => void) => globalThis.requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((id: number) => globalThis.cancelAnimationFrame(id));
  const logError = deps.logError ?? ((error: unknown) => console.error('[3D render]', error));

  let target: RenderTarget | null = null;
  let frame: number | null = null;
  const listeners = new Set<() => void>();
  let renderFailing = false;
  let beforeRenderFailing = false;
  let inBeforeRender = false;
  let ticking = false;

  const invalidate = (): void => {
    if (!target || frame !== null || inBeforeRender) return;
    frame = requestFrame(tick);
  };

  function tick(): void {
    frame = null;
    const current = target;
    if (!current) return;
    ticking = true;
    try {
      let again = false;
      if (current.beforeRender) {
        inBeforeRender = true;
        try {
          again = current.beforeRender() === true;
          beforeRenderFailing = false;
        } catch (error) {
          if (!beforeRenderFailing) logError(error);
          beforeRenderFailing = true;
        } finally {
          inBeforeRender = false;
        }
      }
      try {
        current.render();
        renderFailing = false;
      } catch (error) {
        // Do not reschedule: a broken scene must not spin the GPU or flood
        // the console. The next invalidate tries again.
        if (!renderFailing) logError(error);
        renderFailing = true;
        return;
      }
      for (const listener of [...listeners]) {
        // A listener removed by an earlier listener must not run with a stale closure.
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch (error) {
          logError(error);
        }
      }
      if (again) invalidate();
    } finally {
      ticking = false;
    }
  }

  const renderNow = (): void => {
    if (!target) return;
    if (ticking) {
      // Re-entrant call from inside a frame: draw on the next one instead.
      invalidate();
      return;
    }
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    tick();
  };

  const attach = (next: RenderTarget): (() => void) => {
    target = next;
    // A newly attached view has never been drawn.
    invalidate();
    return () => {
      // A stale detach (StrictMode attach, detach, attach) must not detach a newer target.
      if (target !== next) return;
      target = null;
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
    };
  };

  const onFrame = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return { invalidate, renderNow, attach, onFrame };
}

/** One scheduler per component instance, created during render so child effects can use it. */
export function useRenderScheduler(): RenderScheduler {
  const [scheduler] = useState(() => createRenderScheduler());
  return scheduler;
}

/**
 * Wrap an object of imperative scene mutators so every method call (except
 * those in `skip`) is followed by invalidate(), even if the method throws.
 * Used for the SceneControls of the site viewer, so current and future
 * callers cannot forget to request a frame.
 */
export function withInvalidate<T extends object>(
  target: T,
  invalidate: () => void,
  skip: ReadonlyArray<keyof T> = [],
): T {
  const skipped = new Set<PropertyKey>(skip as ReadonlyArray<PropertyKey>);
  return new Proxy(target, {
    get(obj, key, receiver) {
      const value: unknown = Reflect.get(obj, key, receiver);
      if (typeof value !== 'function' || skipped.has(key)) return value;
      return (...args: unknown[]) => {
        try {
          return (value as (...a: unknown[]) => unknown).apply(obj, args);
        } finally {
          invalidate();
        }
      };
    },
  });
}
