import { useSyncExternalStore } from "react";

// import.meta.env.DEV is substituted by vite — production compiles to `false`
// and everything behind it is dead code the bundler drops. The point of tying
// this to the build is that there is no switch to find in production.
export const DEV = import.meta.env.DEV;

// Off by default even in dev builds — the green collision layer is in the way
// the rest of the time. The DEV chip stays visible so it is one click away.
let on = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readMode = () => on;

export function setDevMode(next: boolean) {
  if (!DEV || on === next) return;
  on = next;
  for (const listener of listeners) listener();
}

export const toggleDevMode = () => setDevMode(!on);

export function useDevMode() {
  return useSyncExternalStore(subscribe, readMode, readMode);
}

export type PlayerDebug = {
  role: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bodyYaw: number;
  vy: number;
  grounded: boolean;
  clinging: boolean;
  zoom: number;
  firstPerson: boolean;
  pose: number;
  half: [number, number, number];
  surfaces: number;
};

let snapshot: PlayerDebug | null = null;
let ticks = 0;
let draws = 0;

// Module-level snapshot — written from the frame loop, sampled by the panel
// at 10 Hz. Routing it through props would re-render the tree 60 times/sec.
export function reportPlayer(next: PlayerDebug) {
  snapshot = next;
  ticks += 1;
}

// Separate from ticks — rAF ticks at the display rate (120), draws are
// throttled to MAX_FPS. Conflating the two makes the cap look broken.
export function reportDraw() {
  draws += 1;
}

export const playerDebug = () => snapshot;

export const debugDraws = () => draws;
export const debugTicks = () => ticks;

export function clearPlayerDebug() {
  snapshot = null;
}
