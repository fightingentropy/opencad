import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trailingDebounce } from '../trailing-debounce';

describe('trailingDebounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delivers only the latest value once calls stop', () => {
    const seen: number[] = [];
    const d = trailingDebounce<number>((v) => seen.push(v), 100);
    d.schedule(1);
    vi.advanceTimersByTime(60);
    d.schedule(2);
    vi.advanceTimersByTime(60);
    d.schedule(3);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([3]);
  });

  it('delivers nothing after cancel', () => {
    const seen: number[] = [];
    const d = trailingDebounce<number>((v) => seen.push(v), 100);
    d.schedule(1);
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([]);
  });
});
