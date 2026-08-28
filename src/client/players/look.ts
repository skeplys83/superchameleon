import * as THREE from "three";

/** Where the third-person camera sits when nothing has zoomed it. */
export const CAMERA_DISTANCE = 7;

/**
 * Everything about where this player is *looking*, in one mutable object.
 *
 * It is one `useRef` rather than seven because every field is written by a
 * pointer handler installed once and read by the frame loop sixty times a
 * second — neither of which may cause a render. Grouping them is what lets the
 * frame loop read `look.yaw` instead of chasing seven separate refs.
 */
export type Look = {
  /** Camera yaw, from the mouse. */
  yaw: number;
  /** Positive looks up. */
  pitch: number;
  zoom: number;
  /** Whether this client currently holds the pointer lock. */
  locked: boolean;
  /** Chameleons never take the lock, so they look around by dragging. */
  orbiting: boolean;
  /** Whether this tab still has the keyboard. */
  focused: boolean;
};

export const newLook = (): Look => ({
  yaw: 0,
  pitch: -0.2,
  zoom: CAMERA_DISTANCE,
  locked: false,
  orbiting: false,
  focused: true,
});

/**
 * The body's own simulation state — none of it on the wire, all of it integrated
 * by the frame loop. Grouped for the same reason as `Look`.
 */
export type Motion = {
  /** The figure's facing, from Q/E. Written by the frame loop rather than by
   *  the mouse, which is why it sits here and not in `Look`. */
  bodyYaw: number;
  /** Vertical velocity, which is ours to integrate. */
  vy: number;
  /** Whether the controller found ground *last* frame. */
  grounded: boolean;
  /** Space last frame, so a jump fires on the press rather than on every frame
   *  the key is held down. */
  jumpHeld: boolean;
  /** X last frame, so the lie-flat toggle flips on the press rather than on
   *  every frame the key is held down. */
  flatHeld: boolean;
  /** The surface a chameleon is stuck to, as a normal pointing back at them. */
  cling: THREE.Vector3 | null;
  /** Seconds left before a surface can be grabbed again after letting go. */
  reclingGrace: number;
  /** What the body was stuck to when its current box was chosen. A box that
   *  turned because the *surface* changed must not be compensated for. */
  surface: number;
  /** Seconds of ground credit left after walking off an edge — coyote time. */
  coyote: number;
  /** Seconds a jump press stays queued while airborne — the landing buffer. */
  buffered: number;
  /** Whether the jump key has been held since take-off. Releasing it early cuts
   *  the rise short, which is what makes a short hop possible. */
  rising: boolean;
  /** How far the collider's underside sits below the body's origin, signed, as
   *  it currently stands — so a pose that moves it can move the body by the
   *  difference and leave the feet where they were. */
  footOffset: number;
  /** Seconds a movement key has been asking to walk. A body already on its feet
   *  goes on the first frame; one folded up has to get out of the pose first,
   *  and this is how long it has been trying. Zeroed the moment the ask stops. */
  unfolding: number;
};

export const newMotion = (footOffset: number): Motion => ({
  bodyYaw: 0,
  vy: 0,
  grounded: false,
  jumpHeld: false,
  flatHeld: false,
  cling: null,
  reclingGrace: 0,
  surface: 0,
  coyote: 0,
  buffered: 0,
  rising: false,
  footOffset,
  unfolding: 0,
});
