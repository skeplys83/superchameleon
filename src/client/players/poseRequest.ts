/**
 * The one channel between the pose wheel and the body.
 *
 * The pose itself stays React state inside `Player.tsx` — the collider is keyed
 * on the pose's box, so it has to be — and the number keys still reach it
 * through drei's `KeyboardControls`. The wheel is drawn in `hud/`, which is
 * outside the Canvas and may not import this folder at all, so `app/Game.tsx`
 * sits in the middle: the wheel hands it an index, it calls `requestPose`, and
 * the frame loop picks it up.
 *
 * **A request is taken, not read.** One turn of the wheel is one pose change,
 * and a value left sitting here would fight the number keys for the rest of the
 * round. `current` runs the other way, so the wheel can open with the pose you
 * are actually holding already lit.
 */
let requested: number | null = null;
let current = 0;

/** Ask for a pose. The next frame applies it. */
export const requestPose = (index: number) => {
  requested = index;
};

/** Consume the outstanding request, if there is one. */
export const takePoseRequest = () => {
  const wanted = requested;
  requested = null;
  return wanted;
};

/** What the local body is holding. Written by `Player.tsx`. */
export const reportPose = (index: number) => {
  current = index;
};

export const currentPose = () => current;
