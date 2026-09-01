import { useEffect, useState } from "react";

/** Checks whether the current device is a mobile phone or tablet. */
export function isMobileOrTabletDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const isMobileUA =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
  const isIPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  const isCoarseTouch =
    window.matchMedia("(pointer: coarse)").matches &&
    window.matchMedia("(max-width: 1024px)").matches;

  return isMobileUA || isIPad || isCoarseTouch;
}

export function useIsMobileOrTablet(): boolean {
  const [isMobile, setIsMobile] = useState(isMobileOrTabletDevice);

  useEffect(() => {
    const check = () => setIsMobile(isMobileOrTabletDevice());
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  return isMobile;
}

/** Full-screen blocker displayed on mobile and tablet devices. */
export function MobileUnsupported() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100 select-none">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-neutral-900/90 p-8 text-center shadow-2xl shadow-black/80 backdrop-blur-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-800 text-2xl text-neutral-300 shadow-inner">
          💻
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
            Desktop Only
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100">
            Not Available on Mobile
          </h1>
        </div>

        <p className="text-xs leading-relaxed text-neutral-400">
          Super Chameleon requires a physical keyboard and mouse for first-person look, character movement, and surface camouflage.
        </p>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-4 py-2.5 text-[0.6875rem] font-mono text-neutral-500">
          Please open on a PC or laptop
        </div>
      </div>
    </div>
  );
}
