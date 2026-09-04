import { useEffect, useState } from "react";
import { onCaught, selfId } from "@/client/net";
import { useLatestRef } from "./useLatestRef";

const NOTICE_MS = 3500;

export function useCaughtNotice(joined: boolean, onCatch: () => void) {
  const [caughtBy, setCaughtBy] = useState<string | null>(null);
  // Ref, not closed-over — the subscription survives a parent re-render.
  const catchRef = useLatestRef(onCatch);

  useEffect(() => {
    if (!joined) return;
    return onCaught((victimId, by) => {
      if (victimId !== selfId()) return;
      setCaughtBy(by);
      catchRef.current();
    });
  }, [joined, catchRef]);

  useEffect(() => {
    if (!caughtBy) return;
    const t = setTimeout(() => setCaughtBy(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [caughtBy]);

  return { caughtBy };
}
