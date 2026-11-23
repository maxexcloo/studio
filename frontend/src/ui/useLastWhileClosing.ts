import { useRef } from "react";

/**
 * `value`, or while it is empty the last value it held: a dialog opened by a record keeps showing
 * that record as it fades out after the record clears, rather than emptying mid-fade.
 */
export function useLastWhileClosing<T>(value: T | null | undefined) {
  const last = useRef(value);
  if (value != null) last.current = value;
  return value ?? last.current;
}
