// The poses, in the order of the number keys that select them.

import { CLING_NONE, POSE_COUNT } from "@/shared/protocol";
import { flatFor, turnCentre, turnHalf, type FlatMode } from "./flat";

/**
 * One joint's three angles, in radians. **All three are required**, so every
 * pose states every knob it has, zeros included — the table is a dial board
 * rather than a diff against a default, and a joint nobody has thought about is
 * indistinguishable from one deliberately left at rest. Zero is the rig's bind
 * rotation either way.
 *
 * They mean slightly different things on the two kinds of joint, because the
 * two kinds of bone do (see `rig.ts`):
 *
 * - **A limb** (`shoulder`, `elbow`, `hip`, `knee`) is *aimed*: `x` swings it
 *   forward, `spread` swings it out, and `twist` rolls it about its own length
 *   without moving where it points.
 * - **A lean** (`torso`, `chest`, `neck`, `head`, `clavicle`) is *turned* about
 *   the figure's own axes: `x` pitches, `twist` yaws, `spread` tilts sideways.
 *   Mind the sign — a positive `x` swings a limb forward and leans the spine
 *   *backward*; see invariant 10.
 *
 * **`spread` and `twist` are outward, per side**, so the same number means the
 * same thing on the left and on the right and a mirrored pair is two identical
 * `Joint`s. It is `x` that is not mirrored: forward is forward for both.
 * Crossing a limb over the body is therefore a *negative* spread on that side.
 */
export type Joint = { x: number; spread: number; twist: number };

/** Two sides of one joint, stated separately. */
export type Sides = { left: Joint; right: Joint };

/**
 * Every bone in the 14-bone rig is dialable from here, and every pose fills in
 * all of it.
 *
 * **The three arm joints are per side and the two leg joints are not.** A
 * `clavicle`, `shoulder` or `elbow` carries a `left` and a `right`, so one arm
 * can reach while the other hangs; `hip` and `knee` are still one `Joint`
 * applied to both legs, mirrored. That is not a claim that legs cannot be
 * asymmetric — `rig.ts` has held every joint as `[left, right]` since the
 * skeleton arrived, and the aiming arm already uses it — it is just that
 * nothing has needed it yet. Splitting them is the same change made twice more.
 *
 * The four singles are `torso` (`Spine1`), `chest` (`Spine1.001`), `neck` and
 * `head`; the bones behind the pairs are `Shoulder.L/R`, `UpperArm.L/R`,
 * `LowerArm.L/R`, `UpperLeg.L/R` and `LowerLeg.L/R`.
 *
 * Nothing here is optional. The compiler is what keeps a new pose complete, and
 * what is lost — being able to see at a glance which joints a pose *moves* —
 * comes back in the developer readout, which dims every angle sitting at zero.
 */
export type Pose = {
  key: string;
  label: string;
  /**
   * Collider half-extents, **as the box sits with the body standing up** — `y`
   * is the vertical one. `poseExtents` turns it for a pose that lies flat.
   */
  half: [number, number, number];
  /**
   * Where that box sits relative to the body's origin. **Not `offsetY` /
   * `offsetZ`**, which move the *figure*; this moves the *collider*, and it is
   * what lets a pose whose mass is off to one side get a box that hugs it
   * instead of one grown until a centred box reaches. `x` and `z` turn with the
   * body's yaw, `y` does not.
   */
  centre: [number, number, number];
  /**
   * How this pose lies when it is on a flat surface — see `FlatMode`.
   *
   * Flagging a pose is the whole change: **the box below is stated standing up**
   * and `poseExtents` turns it to match, so nothing has to be re-measured by
   * hand. Getting that backwards is what left `reach` lying down inside its own
   * standing collider, hanging 1.1 units above the floor.
   */
  flat: FlatMode;
  rootX: number;
  /** Shift the whole figure inside its collider — the body's own middle is not
   *  its origin once a pose reaches out. `z` is forward-negative, as ever. */
  offsetY: number;
  offsetZ: number;
  torso: Joint;
  /** `Spine1.001`. It shares `Spine1`'s origin, so it composes with the torso
   *  lean rather than curving the back — see invariant 17. */
  chest: Joint;
  neck: Joint;
  head: Joint;
  /** The collar bones. They move where the arms *start*, not where they point. */
  clavicle: Sides;
  shoulder: Sides;
  elbow: Sides;
  hip: Joint;
  knee: Joint;
};

export const POSES: Pose[] = [
  {
    key: "stand",
    label: "Stand",
    half: [0.12, 1.0, 0.12],
    centre: [0, 0, 0],
    flat: "none",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0, spread: 0.09, twist: 0 },
      right: { x: 0, spread: 0.09, twist: 0 },
    },
    elbow: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    // The rig's two hip bones share one origin, so a leg with no spread lands
    // exactly on top of its twin. Every upright pose has to part them itself.
    hip: { x: 0, spread: 0.38, twist: 0 },
    knee: { x: 0, spread: -0.38, twist: 0 },
  },
  {
    key: "reach",
    label: "Reach up",
    // Fitted to `pose_7_arms_overhead`: straight up, forearms angled in so the
    // hands meet. The fit put the legs together, which on this rig means one
    // leg exactly inside the other, so they keep the standing stance instead.
    // Taller than standing, and lifted to match: the hands reach 1.209 above
    // the body's origin while the feet stay at -1.0, so a centred box would
    // either clip the hands or hold the feet 0.1 off the floor.
    half: [0.12, 1.1, 0.12],
    centre: [0, 0.1, 0],
    flat: "back",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0.02, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0.05, spread: 2.98, twist: 0 },
      right: { x: 0.05, spread: 2.98, twist: 0 },
    },
    elbow: {
      left: { x: 0.06, spread: 0.53, twist: 0 },
      right: { x: 0.06, spread: 0.53, twist: 0 },
    },
    hip: { x: 0, spread: 0.38, twist: 0 },
    knee: { x: 0, spread: -0.38, twist: 0 },
  },
  {
    key: "star",
    label: "Star jump",
    // Arms and legs thrown wide — near the rig's own bind pose, which is why
    // this one needed no fitting.
    // Shorter than standing: the legs are spread, so the feet come up to
    // -0.917 and the head only reaches 0.972.
    half: [0.12, 0.94, 0.12],
    centre: [0, 0.025, 0],
    flat: "back",
    rootX: 0,
    offsetY: -0.07,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0, spread: 2.36, twist: 0 },
      right: { x: 0, spread: 2.36, twist: 0 },
    },
    elbow: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    hip: { x: 0, spread: 0.8, twist: 0 },
    knee: { x: 0, spread: -0.2, twist: 0 },
  },
  {
    key: "lie",
    label: "Lie flat",
    // Fitted to `pose_0_lie_flat`: straight out, arms reaching past the head.
    // The body is upright here and *rolled* onto its side by `roll`, which is
    // why the arms read as overhead rather than as lying beside the body.
    // Long axis horizontal: this is the standing box already tipped over,
    // stated as it lands rather than rolled at runtime — see poseExtents.
    // 0.23 tall because that is the torso lying on its side; the arms
    // reaching past the head sink through it, which is the point.
    // Standing, like every other pose's. On its side this turns into
    // [0.96, 0.23, 0.12], which is the box this pose has always used.
    half: [0.23, 0.96, 0.12],
    centre: [0, 0, 0],
    flat: "side",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: -0.6, twist: 0 },
    head: { x: 0.1, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0.0, spread: 1.0, twist: 0 },
      right: { x: 0.0, spread: 0.0, twist: 0.0 },
    },
    shoulder: {
      left: { x: 0.05, spread: 3.4, twist: 0 },
      right: { x: -0.05, spread: 0.0, twist: 0 },
    },
    elbow: {
      left: { x: 0.13, spread: 1.0, twist: 0 },
      right: { x: 0.13, spread: 0.0, twist: 0 },
    },
    hip: { x: 0, spread: 0.4, twist: 0 },
    knee: { x: 0, spread: -0.4, twist: 0 },
  },
  {
    key: "curl",
    label: "Curl up",
    // A crouch-sized block around the torso, which the curl carries forward
    // and up — hence the centre. Knees, elbows and the back of the head are
    // outside it on purpose; the silhouette is 1.26 x 0.57 x 1.00.
    //
    // **`centre.y` tracks `offsetY`.** The box is 0.56 tall against a 0.57
    // silhouette, so it wraps the ball almost exactly — but only if it is
    // shifted by as much as the figure itself is. It used to sit at half the
    // figure's shift, which hung 0.075 of empty box under the body: the pose
    // change keeps the box's *underside* put (`Player.tsx`), so the body was
    // seated on a floor its own feet were not touching, and a curled chameleon
    // floated.
    half: [0.24, 0.28, 0.24],
    centre: [0, 0.15, 0.18],
    flat: "none",
    rootX: 0,
    offsetY: 0.15,
    offsetZ: 0.3,
    torso: { x: 5.8, spread: 0, twist: 0 },
    chest: { x: -1, spread: 0, twist: 0 },
    neck: { x: -0.3, spread: 0.0, twist: 0 },
    head: { x: -1.57, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 1.0, spread: 0.05, twist: 0 },
      right: { x: 1.0, spread: 0.05, twist: 0 },
    },
    elbow: {
      right: { x: 1.8, spread: -1.05, twist: 0 },
      left: { x: 1.8, spread: -1.6, twist: 0 },
    },
    hip: { x: 1.8, spread: 0.5, twist: 0 },
    knee: { x: -2.8, spread: 0.5, twist: 0 },
  },
];

if (POSES.length !== POSE_COUNT) {
  throw new Error(
    `poses.ts defines ${POSES.length} poses but shared/protocol.mjs says POSE_COUNT is ` +
    `${POSE_COUNT}. Update protocol.mjs — the server clamps against it.`,
  );
}

export { POSE_COUNT };

/** Clamps anything arriving off the network to a real pose index. */
export const safePose = (n: unknown) =>
  Number.isFinite(n) ? Math.min(POSE_COUNT - 1, Math.max(0, Math.trunc(n as number))) : 0;

/**
 * Collider half-extents for a pose, in the frame the collider is finally in —
 * so `[1]` is the vertical one for every pose, which is what lets `Player.tsx`
 * keep the feet put across a change (its invariant 13).
 *
 * Only a chameleon can pose, so `stand` defers to the role's own box: a hunter
 * is always standing and theirs is the bigger one. Every other row is a
 * chameleon's, and is deliberately smaller than the body it carries — that gap
 * is the hiding mechanic, see `players/CLAUDE.md`.
 */
/**
 * The half-height every box and centre below was fitted at — the chameleon's
 * own, before `BODY_SCALE`. Read off the table rather than written down, so the
 * two cannot drift: pose 0 *is* the standing body.
 *
 * The boxes are a fitted table, not something derived from `BODY`, so scaling
 * the body does not scale them. Without this the figure shrank and its lying
 * and curled colliders stayed the size they were — a chameleon lying down
 * inside a box a head taller than it.
 */
const FITTED_HY = POSES[0].half[1];

/** Scaled copies, one set per body scale. Built once: `Player.tsx` asks four
 *  times a frame and the identity is used as a React key. */
type Box = [number, number, number];
const scaledPoses = new Map<number, { half: Box; centre: Box }[]>();

function atScale(scale: number) {
  let table = scaledPoses.get(scale);
  if (table) return table;
  table = POSES.map((p) => ({
    half: [p.half[0] * scale, p.half[1] * scale, p.half[2] * scale] as Box,
    centre: [p.centre[0] * scale, p.centre[1] * scale, p.centre[2] * scale] as Box,
  }));
  scaledPoses.set(scale, table);
  return table;
}

export function poseExtents(
  pose: number,
  role: [hx: number, hy: number, hz: number],
  /** What the body is clinging to, from `shared/protocol`. */
  cling: number = CLING_NONE,
): [number, number, number] {
  const i = safePose(pose);
  // Pose 0 is the standing body, which `BODY` already states at its own scale.
  if (i === 0) return role;
  const half = atScale(role[1] / FITTED_HY)[i].half;
  const turned = turnHalf(half, flatFor(POSES[i].flat, cling));
  // **Only the vertical extent is taken from the turned box.** Horizontally it
  // stays the standing footprint, which is the one shape already known to fit
  // everywhere the body can be.
  //
  // Lying down otherwise swings a body-length of collider out sideways, and it
  // goes wherever the body happens to be facing — which, next to a wall, is
  // into the wall. A kinematic collider that starts a frame penetrating gets no
  // movement back at all, so the player simply stops: stuck in the wall/ceiling
  // corner, stuck on letting go of a wall, stuck lying down beside one. Three
  // separate reports, one cause.
  //
  // The body still *draws* full length and hangs well outside this box. That is
  // the hiding mechanic doing its job — `body.ts` makes the collider smaller
  // than the figure on purpose — and `players/inside.ts` is what stops the
  // overlap ever becoming a way through a wall.
  return [half[0], turned[1], half[2]];
}

/** Where that box sits, relative to the body's origin. `x` and `z` are in the
 *  body's own frame and turn with its yaw; `y` is world-vertical either way,
 *  which is what `Player.tsx` needs to keep the feet put (its invariant 13). */
export function poseCentre(
  pose: number,
  /** The body's half-height, so the offset scales with it. */
  hy: number = FITTED_HY,
  cling: number = CLING_NONE,
): readonly [number, number, number] {
  const i = safePose(pose);
  if (i === 0) return ORIGIN;
  const centre = atScale(hy / FITTED_HY)[i].centre;
  return turnCentre(centre, flatFor(POSES[i].flat, cling));
}

const ORIGIN = [0, 0, 0] as const;
