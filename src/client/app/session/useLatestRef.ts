import { useEffect, useRef, type RefObject } from "react";

// Current value readable from a listener registered once — a closed-over
// prop would read a stale value.
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
