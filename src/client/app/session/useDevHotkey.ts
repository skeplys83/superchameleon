import { useEffect } from "react";
import { DEV, toggleDevMode } from "@/client/app/dev";

// Backquote toggles dev mode — a hunter holds the lock and cannot click the chip.
export function useDevHotkey() {
  useEffect(() => {
    if (!DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      toggleDevMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
