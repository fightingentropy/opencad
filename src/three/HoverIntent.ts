export interface HoverPoint {
  clientX: number;
  clientY: number;
}

interface HoverIntentOptions<T> {
  resolve: (point: HoverPoint) => T | null;
  show: (value: T) => void;
  hide: () => void;
  delayMs?: number;
  tolerancePx?: number;
}

/** Resolve expensive hit tests only after the pointer has settled. */
export function createHoverIntent<T>({
  resolve,
  show,
  hide,
  delayMs = 2000,
  tolerancePx = 4,
}: HoverIntentOptions<T>) {
  let anchor: HoverPoint | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;
  let generation = 0;

  const cancel = () => {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    anchor = null;
    if (visible) {
      visible = false;
      hide();
    }
  };

  const move = (point: HoverPoint) => {
    // Compare with the original anchor, so slow cumulative movement also
    // dismisses the tooltip. Tiny hand jitter never moves an open tooltip.
    if (anchor && Math.hypot(point.clientX - anchor.clientX, point.clientY - anchor.clientY) <= tolerancePx) return;
    cancel();
    anchor = { clientX: point.clientX, clientY: point.clientY };
    const stablePoint = anchor;
    const pendingGeneration = generation;
    timer = setTimeout(() => {
      if (pendingGeneration !== generation) return;
      timer = null;
      const value = resolve(stablePoint);
      if (pendingGeneration !== generation || value === null) return;
      visible = true;
      show(value);
    }, delayMs);
  };

  return { move, cancel };
}
