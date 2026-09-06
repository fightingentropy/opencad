import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverIntent, type HoverPoint } from '../HoverIntent';

const point = (clientX = 100, clientY = 200): HoverPoint => ({ clientX, clientY });
const makeIntent = () => {
  const resolve = vi.fn((_point: HoverPoint): string | null => 'route information');
  const show = vi.fn();
  const hide = vi.fn();
  return { intent: createHoverIntent({ resolve, show, hide }), resolve, show, hide };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('stationary 3D hover intent', () => {
  it('resolves once at exactly two seconds and does not repeat while stationary', () => {
    const { intent, resolve, show, hide } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(1999);
    expect(resolve).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(point());
    expect(show).toHaveBeenCalledExactlyOnceWith('route information');
    vi.advanceTimersByTime(10000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
  });

  it('does not resolve during continuous meaningful pointer movement', () => {
    const { intent, resolve, show } = makeIntent();
    intent.move(point());
    for (let step = 1; step <= 6; step++) {
      vi.advanceTimersByTime(1000);
      intent.move(point(100 + step * 8));
      expect(resolve).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(1999);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(point(148));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('keeps the initial anchor when movement is exactly four pixels', () => {
    const { intent, resolve } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(1000);
    intent.move(point(104));
    vi.advanceTimersByTime(1000);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(point());
  });

  it('measures cumulative jitter against the fixed anchor, not the last event', () => {
    const { intent, resolve } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(500);
    intent.move(point(101.5));
    vi.advanceTimersByTime(500);
    intent.move(point(103));
    vi.advanceTimersByTime(500);
    intent.move(point(104.5));
    // Each individual step is only 1.5 px, but the anchor has moved 4.5 px.
    vi.advanceTimersByTime(1999);
    expect(resolve).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(point(104.5));
  });

  it('keeps a displayed tooltip pinned without further state updates for small jitter', () => {
    const { intent, resolve, show, hide } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(2000);
    for (const next of [point(101, 201), point(103), point(100, 204), point()]) {
      intent.move(next);
      vi.advanceTimersByTime(3000);
    }
    expect(resolve).toHaveBeenCalledExactlyOnceWith(point());
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
  });

  it('hides once on meaningful movement and waits a full dwell from the latest anchor', () => {
    const { intent, resolve, show, hide } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(2000);
    intent.move(point(120));
    expect(hide).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    intent.move(point(140));
    expect(hide).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1999);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(resolve).toHaveBeenLastCalledWith(point(140));
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending tooltip without resolving or hiding anything later', () => {
    const { intent, resolve, show, hide } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(1800);
    intent.cancel();
    vi.advanceTimersByTime(10000);
    expect(resolve).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    // Cancel clears the anchor, so the same coordinates can begin a fresh dwell.
    intent.move(point());
    vi.advanceTimersByTime(1999);
    expect(resolve).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('hides a displayed tooltip only once when cancellation is repeated', () => {
    const { intent, resolve, show, hide } = makeIntent();
    intent.move(point());
    vi.advanceTimersByTime(2000);
    intent.cancel();
    intent.cancel();
    vi.advanceTimersByTime(10000);
    intent.cancel();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('does not publish a resolved result if the hover is invalidated during resolution', () => {
    const { intent, resolve, show, hide } = makeIntent();
    resolve.mockImplementation(() => {
      intent.cancel();
      return 'stale route information';
    });
    intent.move(point());
    vi.advanceTimersByTime(2000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('does not update state or repeatedly resolve an empty hit until meaningful movement', () => {
    const { intent, resolve, show, hide } = makeIntent();
    resolve.mockReturnValue(null);
    intent.move(point());
    vi.advanceTimersByTime(2000);
    intent.move(point(102));
    vi.advanceTimersByTime(10000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    intent.move(point(110));
    vi.advanceTimersByTime(2000);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    intent.cancel();
    expect(hide).not.toHaveBeenCalled();
  });
});
