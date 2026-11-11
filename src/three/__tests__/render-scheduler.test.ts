import { describe, expect, it, vi } from 'vitest';
import { createRenderScheduler, withInvalidate, type RenderTarget } from '../render-scheduler';

function fakeFrames() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    requestFrame: (cb: () => void) => { const id = next++; queue.set(id, cb); return id; },
    cancelFrame: (id: number) => { queue.delete(id); },
    /** Run the callbacks queued before this call, as one browser frame does. */
    flush() {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, cb] of due) cb();
    },
    get size() { return queue.size; },
  };
}

function setup(target: Partial<RenderTarget> = {}) {
  const frames = fakeFrames();
  const logError = vi.fn();
  const scheduler = createRenderScheduler({ requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, logError });
  const render = vi.fn(target.render ?? (() => {}));
  const full: RenderTarget = { ...target, render };
  return { frames, logError, scheduler, render, target: full };
}

describe('render scheduler', () => {
  it('renders once on attach and then stays idle', () => {
    const { frames, scheduler, render, target } = setup();
    scheduler.attach(target);
    for (let i = 0; i < 10; i++) frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('coalesces invalidates into one render per frame', () => {
    const { frames, scheduler, render, target } = setup();
    scheduler.attach(target);
    frames.flush();
    for (let i = 0; i < 5; i++) scheduler.invalidate();
    expect(frames.size).toBe(1);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('invalidate before attach still renders on attach', () => {
    const { frames, scheduler, render, target } = setup();
    scheduler.invalidate();
    expect(frames.size).toBe(0);
    scheduler.attach(target);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('invalidate while detached schedules nothing', () => {
    const { frames, scheduler, render, target } = setup();
    const detach = scheduler.attach(target);
    frames.flush();
    detach();
    scheduler.invalidate();
    scheduler.renderNow();
    expect(frames.size).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('beforeRender true keeps frames coming until it returns false (damping)', () => {
    let remaining = 3;
    const { frames, scheduler, render, target } = setup({ beforeRender: () => remaining-- > 0 });
    scheduler.attach(target);
    for (let i = 0; i < 20; i++) frames.flush();
    expect(render).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(0);
  });

  it('an invalidate raised inside beforeRender does not schedule a frame when it returns false', () => {
    const holder: { scheduler?: ReturnType<typeof createRenderScheduler> } = {};
    const { frames, scheduler, render, target } = setup({
      // Models OrbitControls.update() firing 'change' into an invalidate listener.
      beforeRender: () => { holder.scheduler!.invalidate(); return false; },
    });
    holder.scheduler = scheduler;
    scheduler.attach(target);
    for (let i = 0; i < 5; i++) frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('invalidate from inside render or a frame listener schedules the next frame', () => {
    const holder: { scheduler?: ReturnType<typeof createRenderScheduler> } = {};
    let fromRender = true;
    const { frames, scheduler, render, target } = setup({
      render: () => { if (fromRender) { fromRender = false; holder.scheduler!.invalidate(); } },
    });
    holder.scheduler = scheduler;
    scheduler.attach(target);
    frames.flush();
    expect(frames.size).toBe(1);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(2);

    let fromListener = true;
    scheduler.onFrame(() => { if (fromListener) { fromListener = false; scheduler.invalidate(); } });
    scheduler.invalidate();
    frames.flush();
    expect(frames.size).toBe(1);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(0);
  });

  it('onFrame runs after render, in order, and unsubscribe stops it', () => {
    const calls: string[] = [];
    const { frames, scheduler, target } = setup({ render: () => { calls.push('render'); } });
    const offA = scheduler.onFrame(() => calls.push('a'));
    scheduler.onFrame(() => calls.push('b'));
    scheduler.attach(target);
    frames.flush();
    expect(calls).toEqual(['render', 'a', 'b']);
    offA();
    scheduler.invalidate();
    frames.flush();
    expect(calls).toEqual(['render', 'a', 'b', 'render', 'b']);
  });

  it('skips a listener that an earlier listener removed during the same frame', () => {
    const { frames, scheduler, target } = setup();
    const second = vi.fn();
    let offSecond = () => {};
    scheduler.onFrame(() => offSecond());
    offSecond = scheduler.onFrame(second);
    scheduler.attach(target);
    frames.flush();
    expect(second).not.toHaveBeenCalled();
  });

  it('detach cancels the pending frame; a stale detach after re-attach keeps the new target', () => {
    const { frames, scheduler, target } = setup();
    const first = scheduler.attach(target);
    expect(frames.size).toBe(1);
    first();
    expect(frames.size).toBe(0);
    // StrictMode: attach, detach, attach. The first effect's cleanup may run again late.
    const render2 = vi.fn();
    scheduler.attach({ render: render2 });
    first();
    frames.flush();
    expect(render2).toHaveBeenCalledTimes(1);
    scheduler.invalidate();
    frames.flush();
    expect(render2).toHaveBeenCalledTimes(2);
  });

  it('a render error is logged once, does not reschedule, and the next invalidate renders again', () => {
    let fail = true;
    const { frames, scheduler, render, target, logError } = setup({
      render: () => { if (fail) throw new Error('lost'); },
      beforeRender: () => true,
    });
    const listener = vi.fn();
    scheduler.onFrame(listener);
    scheduler.attach(target);
    frames.flush();
    expect(frames.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    scheduler.invalidate();
    frames.flush();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    fail = false;
    scheduler.invalidate();
    frames.flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a beforeRender error is logged once per failing streak and the frame still renders', () => {
    const { frames, scheduler, render, target, logError } = setup({ beforeRender: () => { throw new Error('controls'); } });
    scheduler.attach(target);
    frames.flush();
    scheduler.invalidate();
    frames.flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('a throwing listener does not block the other listeners', () => {
    const { frames, scheduler, target, logError } = setup();
    const after = vi.fn();
    scheduler.onFrame(() => { throw new Error('overlay'); });
    scheduler.onFrame(after);
    scheduler.attach(target);
    frames.flush();
    expect(after).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('renderNow draws synchronously, cancels the pending frame and runs listeners', () => {
    const { frames, scheduler, render, target } = setup();
    const listener = vi.fn();
    scheduler.onFrame(listener);
    scheduler.attach(target);
    expect(frames.size).toBe(1);
    scheduler.renderNow();
    expect(render).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renderNow from inside a frame defers to the next frame instead of re-entering', () => {
    const holder: { scheduler?: ReturnType<typeof createRenderScheduler> } = {};
    let depth = 0;
    let first = true;
    const { frames, scheduler, render, target } = setup({
      render: () => {
        depth++;
        expect(depth).toBe(1);
        if (first) { first = false; holder.scheduler!.renderNow(); }
        depth--;
      },
    });
    holder.scheduler = scheduler;
    scheduler.attach(target);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe('withInvalidate', () => {
  it('invalidates after every method except the skipped ones, even when a method throws', () => {
    const invalidate = vi.fn();
    const calls: string[] = [];
    const controls = {
      isolateFloor(id: string | null) { calls.push('floor:' + id); },
      setCoversOpen() { throw new Error('bad'); },
      dispose() { calls.push('dispose'); },
    };
    const wrapped = withInvalidate(controls, invalidate, ['dispose']);
    wrapped.isolateFloor('f1');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(() => wrapped.setCoversOpen()).toThrow('bad');
    expect(invalidate).toHaveBeenCalledTimes(2);
    wrapped.dispose();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['floor:f1', 'dispose']);
  });

  it('keeps this bound to the wrapped object', () => {
    const invalidate = vi.fn();
    const target = { value: 1, read() { return this.value; } };
    expect(withInvalidate(target, invalidate).read()).toBe(1);
  });
});
