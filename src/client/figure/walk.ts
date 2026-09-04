import type { Angles } from "./rig";

const HIP_SWING = 0.5;
const KNEE_BEND = 0.85;
// Knee peaks after the hip — folds on the way forward, not at the back.
const KNEE_LAG = 0.7;
const ARM_SWING = 0.34;
const ELBOW_BEND = 0.3;
const TORSO_TWIST = 0.09;

export const WALK_DAMP = 10;

// Below this the cycle is off — a 1% limb tick on a still body is a tell.
export const WALK_EPSILON = 1e-3;

// phase is radians; one footfall is π. Caller owns the metres→radians
// conversion (stride belongs to the body's height).
export function addWalk(a: Angles, phase: number, amp: number, gunArm: boolean) {
  for (let i = 0; i < 2; i++) {
    const s = phase + (i === 0 ? 0 : Math.PI);
    const swing = Math.sin(s);
    a.hipX[i] += amp * HIP_SWING * swing;
    // One-sided: a knee only folds backward. A symmetric sine hyperextends.
    a.kneeX[i] -= amp * KNEE_BEND * Math.max(0, -Math.sin(s + KNEE_LAG));
    // Gun arm is left alone — chameleons read the barrel for the aim.
    if (gunArm && i === 1) continue;
    a.shoulderX[i] -= amp * ARM_SWING * swing;
    a.elbowX[i] += amp * ELBOW_BEND * (0.5 - 0.5 * swing);
  }
  // Torso lean carries the arms (see rig.ts:target) — leave still while aiming.
  if (gunArm) return;
  a.torsoY += amp * TORSO_TWIST * Math.sin(phase);
  a.chestY -= amp * TORSO_TWIST * Math.sin(phase);
}
