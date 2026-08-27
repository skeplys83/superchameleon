import { useSyncExternalStore } from "react";

/**
 * Developer mode: available when the game is served by the vite dev server,
 * absent from the image.
 *
 * `import.meta.env.DEV` is not read at runtime — vite *substitutes* it, so
 * `npm run build` compiles the flag to `false` and everything behind it is dead
 * code the bundler drops. The Dockerfile's build stage runs exactly that build,
 * so the hosted game ships with none of this in it. That is the whole reason
 * the flag is this one and not an env var or a query parameter: a debug overlay
 * that can be switched on in production is a debug overlay somebody will
 * eventually find switched on.
 *
 * What it turns on today: the collision layer (`Scene.tsx` and
 * `world/GltfLevel.tsx`) and the debug readout (`hud/DebugPanel.tsx`).
 *
 * **`DEV` is availability; `devMode` below is the switch.** The build flag
 * decides whether any of this exists at all, and the toggle in the HUD decides
 * whether it is showing — because the green collision layer over every wall is
 * exactly what you want when you are looking for a hole in a map and exactly
 * what you do not want the rest of the time.
 */
export const DEV = import.meta.env.DEV;

/** Off by default, even in a dev build. The green collision layer over every
 *  wall is what you want while hunting a hole in a map and in the way the rest
 *  of the time — and most dev runs are the rest of the time. The DEV chip is
 *  always drawn, so the switch is still one click away. */
let on = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readMode = () => on;

/** Ignored outside a dev build, so nothing can talk its way back in. */
export function setDevMode(next: boolean) {
  if (!DEV || on === next) return;
  on = next;
  for (const listener of listeners) listener();
}

export const toggleDevMode = () => setDevMode(!on);

/** For anything inside the Canvas that must re-render on the flip: the physics
 *  debug lines and the collision wireframes. */
export function useDevMode() {
  return useSyncExternalStore(subscribe, readMode, readMode);
}

/**
 * What the local player is doing this frame, for the readout to display.
 *
 * A module-level snapshot rather than React state, because it is written from
 * inside the frame loop: routing it through props would re-render the whole
 * tree sixty times a second to update a panel that is sampled ten. Nothing
 * decides anything on it — it is a display, and the frame loop's own values
 * stay the truth.
 */
export type PlayerDebug = {
  role: string;
  /** Body centre, which is what `spawn` is too — not the feet. */
  x: number;
  y: number;
  z: number;
  /** Camera yaw and pitch, in radians. */
  yaw: number;
  pitch: number;
  /** Where the figure faces, which Q/E turns independently of the camera. */
  bodyYaw: number;
  /** Vertical speed, integrated here rather than by rapier. */
  vy: number;
  grounded: boolean;
  clinging: boolean;
  /** Third-person camera distance. */
  zoom: number;
  firstPerson: boolean;
  pose: number;
  /** The collider's half extents, which a folded pose changes. */
  half: [number, number, number];
  /** How many `ROOM_SURFACE` meshes the raycasts walk — see `world/`, inv. 25. */
  surfaces: number;
};

let snapshot: PlayerDebug | null = null;
let ticks = 0;
let draws = 0;

/** Called from the player's frame loop, in developer mode only. */
export function reportPlayer(next: PlayerDebug) {
  snapshot = next;
  ticks += 1;
}

/**
 * Called by `Scene.tsx`'s `FrameLimiter` after it draws.
 *
 * **Counted separately from the ticks, because they are different numbers and
 * conflating them makes the cap look broken.** `requestAnimationFrame` runs the
 * frame loop at the display's refresh rate — 120 on a 120 Hz panel — and
 * `MAX_FPS` throttles only the *render*. So a debug readout that counts frame
 * callbacks reports 120 on a game that is deliberately drawing 60, which is
 * exactly the false alarm this split exists to prevent.
 */
export function reportDraw() {
  draws += 1;
}

/** The last frame's snapshot, or null before the first one. */
export const playerDebug = () => snapshot;

/** Draws and frame-loop ticks since the page loaded, for the readout's own
 *  rates. Monotonic counters, so the reader owns the window. */
export const debugDraws = () => draws;
export const debugTicks = () => ticks;

/** Dropped on leaving a room, like everything else that belongs to one. */
export function clearPlayerDebug() {
  snapshot = null;
}
