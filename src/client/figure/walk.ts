// The walk cycle: a swing added on top of the standing pose, never a pose of
// its own. There is still one mesh, one table and one set of joint angles —
// this is the same dial board with a sine on four of the dials.

import type { Angles } from "./rig";

/** Radians of hip swing at full stride, fore and aft. */
const HIP_SWING = 0.5;
/** How far the trailing knee folds as the foot comes up behind it. */
const KNEE_BEND = 0.85;
/** The knee's peak lands *after* the hip's: a leg folds on its way forward,
 *  not at the back of the stride. Zero here gives a stiff, marching leg. */
const KNEE_LAG = 0.7;
/** The arms counter-swing. Smaller than the legs — the legs do the walking. */
const ARM_SWING = 0.34;
const ELBOW_BEND = 0.3;
/** The shoulders turn against the hips. Small enough to read as a body rather
 *  than as a knob being turned. */
const TORSO_TWIST = 0.09;

/** How fast the cycle fades in on setting off and out on stopping. Higher is
 *  snappier; this stays a little quicker than `POSE_DAMP`, because a walk that
 *  lingers after the feet have stopped is the tell described in the doc. */
export const WALK_DAMP = 10;

/** Below this the cycle is off entirely, rather than ticking at 1%. A limb
 *  moving on a body that has stopped is a chameleon giving itself away. */
export const WALK_EPSILON = 1e-3;

/**
 * Add one frame of walk cycle to a set of angles.
 *
 * **`phase` is in radians and one footfall is π of it**, so the two legs are
 * exactly half a cycle apart and the sound and the step land together. The
 * caller owns the conversion from metres, because the stride belongs to the
 * body's height (`sound/footsteps.ts`) and this file knows nothing about roles.
 *
 * `amp` scales the whole thing, 0 to 1, which is what lets a body settle back
 * into its pose on stopping rather than freezing mid-stride.
 */
export function addWalk(a: Angles, phase: number, amp: number, gunArm: boolean) {
  for (let i = 0; i < 2; i++) {
    // `Angles` is indexed [left, right]; the right leg is half a cycle behind.
    const s = phase + (i === 0 ? 0 : Math.PI);
    const swing = Math.sin(s);
    a.hipX[i] += amp * HIP_SWING * swing;
    // A knee only ever folds backwards, so this is a one-sided term: flat
    // through the stance half, lifting the heel through the swing half. A
    // symmetric sine here hyperextends the leg the wrong way on every stride.
    a.kneeX[i] -= amp * KNEE_BEND * Math.max(0, -Math.sin(s + KNEE_LAG));
    // The gun arm is already driven by the aim, and it is what chameleons read
    // to tell where the shotgun is pointed. Left out entirely rather than
    // swung: a barrel that wanders 20° every stride is noise on that signal.
    if (gunArm && i === 1) continue;
    // Against the leg on the same side — a body walks diagonally opposed.
    a.shoulderX[i] -= amp * ARM_SWING * swing;
    a.elbowX[i] += amp * ELBOW_BEND * (0.5 - 0.5 * swing);
  }
  // Same reason as the arm: the torso lean is what carries the arms (see
  // `target` in `rig.ts`), so twisting it while aiming moves the barrel too.
  if (gunArm) return;
  a.torsoY += amp * TORSO_TWIST * Math.sin(phase);
  a.chestY -= amp * TORSO_TWIST * Math.sin(phase);
}
