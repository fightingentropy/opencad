// Trailing-edge debounce: `schedule(v)` remembers the latest value and delivers
// it once `ms` have passed with no newer call. Used to hold back whole-scene
// rebuilds while the project changes on every pointer move.
export interface TrailingDebounce<T> {
  schedule: (value: T) => void;
  cancel: () => void;
}

export const trailingDebounce = <T>(deliver: (value: T) => void, ms: number): TrailingDebounce<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: (value) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        deliver(value);
      }, ms);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
