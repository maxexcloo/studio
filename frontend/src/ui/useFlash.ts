import { useRef, useState } from "react";

/** Routine success shown in place for a moment: `flashed` holds the last value `flash` was given. */
export function useFlash<T = true>() {
  const [flashed, setFlashed] = useState<T>();
  const timer = useRef(0);
  const flash = (value: T) => {
    setFlashed(() => value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlashed(undefined), 2000);
  };
  return [flashed, flash] as const;
}
