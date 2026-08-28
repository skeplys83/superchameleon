import * as THREE from "three";
import type { Character } from "./model";
import type { Joint, Pose } from "./poses";

/** Writing a pose onto the skeleton. Kept apart from `StickFigure` because it
 *  is the one piece of this folder with no React in it, which is what lets it
 *  be run against the real `.glb` outside a browser — see `docs/VERIFYING.md`. */

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Every bone in the rig is drivable — the table decides which ones a given pose
 *  bothers to touch, and a joint left out is exactly its bind rotation. The six
 *  in `LEANS` are turned about the figure's own axes; the eight limb bones are
 *  aimed. */
export type Driven =
  | "Spine1"
  | "Spine1001"
  | "Neck"
  | "Head"
  | "ShoulderL"
  | "ShoulderR"
  | "UpperArmL"
  | "LowerArmL"
  | "UpperArmR"
  | "LowerArmR"
  | "UpperLegL"
  | "LowerLegL"
  | "UpperLegR"
  | "LowerLegR";

/** The bones that lean rather than aim. A lean is identity at zero, so these
 *  cost nothing until a pose asks for one — see invariant 10 for why the spine
 *  and the head cannot be aimed like a limb. */
const LEANS: ReadonlySet<string> = new Set([
  "Spine1",
  "Spine1001",
  "Neck",
  "Head",
  "ShoulderL",
  "ShoulderR",
]);

const DRIVEN: ReadonlySet<string> = new Set<Driven>([
  "Spine1",
  "Spine1001",
  "Neck",
  "Head",
  "ShoulderL",
  "ShoulderR",
  "UpperArmL",
  "LowerArmL",
  "UpperArmR",
  "LowerArmR",
  "UpperLegL",
  "LowerLegL",
  "UpperLegR",
  "LowerLegR",
]);

/** The damped angles a figure is currently holding. Kept per figure and eased
 *  toward the pose every frame, so the table stays a table of angles and the
 *  easing stays where it always was. Every pair is `[left, right]`: the gun arm
 *  leaves the pose entirely while aiming, so the two sides cannot share one
 *  number — and a walk cycle will want the same freedom in the legs.
 *
 *  Every joint carries three numbers, `X` / `Y` / `Z`. On a lean they are pitch,
 *  yaw and sideways tilt about the *figure's* axes; on a limb `X`/`Z` aim the
 *  bone and `Y` twists it about its own length. */
export type Angles = ReturnType<typeof makeAngles>;

export function makeAngles() {
  return {
    torsoX: 0,
    torsoY: 0,
    torsoZ: 0,
    chestX: 0,
    chestY: 0,
    chestZ: 0,
    neckX: 0,
    neckY: 0,
    neckZ: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    rootX: 0,
    roll: 0,
    offsetY: 0,
    offsetZ: 0,
    clavicleX: [0, 0],
    clavicleY: [0, 0],
    clavicleZ: [0, 0],
    shoulderX: [0, 0],
    shoulderY: [0, 0],
    shoulderZ: [0, 0],
    elbowX: [0, 0],
    elbowY: [0, 0],
    elbowZ: [0, 0],
    hipX: [0, 0],
    hipY: [0, 0],
    hipZ: [0, 0],
    kneeX: [0, 0],
    kneeY: [0, 0],
    kneeZ: [0, 0],
  };
}

/**
 * The angles a pose *asks* for — its whole row, spread across both sides, with
 * no damping and no aiming arm.
 *
 * **Kept here rather than inside `StickFigure`'s frame loop** so that anything
 * measuring a posed body — `test/posedBounds.test.ts` fits every pose's
 * collider against the real mesh — poses it exactly the way the game draws it.
 * The two used to be the same code written twice, and a table measured against
 * a different mapping than the one on screen is worse than no measurement.
 *
 * `spread` and `twist` are stated *outward* per side, so they are mirrored;
 * `x` is not, because forward is forward for both.
 */
export function poseTargets(p: Pose, out: Angles) {
  const lean = (j: Joint, of: "torso" | "chest" | "neck" | "head") => {
    out[`${of}X`] = j.x;
    out[`${of}Y`] = j.twist;
    out[`${of}Z`] = j.spread;
  };
  lean(p.torso, "torso");
  lean(p.chest, "chest");
  lean(p.neck, "neck");
  lean(p.head, "head");
  out.rootX = p.rootX;
  out.offsetY = p.offsetY;
  out.offsetZ = p.offsetZ;

  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const of = i === 0 ? "left" : "right";
    const clavicle = p.clavicle[of];
    const shoulder = p.shoulder[of];
    const elbow = p.elbow[of];
    out.clavicleX[i] = clavicle.x;
    out.clavicleY[i] = clavicle.twist * side;
    out.clavicleZ[i] = clavicle.spread * side;
    out.shoulderX[i] = shoulder.x;
    out.shoulderY[i] = shoulder.twist * side;
    out.shoulderZ[i] = shoulder.spread * side;
    out.elbowX[i] = elbow.x;
    out.elbowY[i] = elbow.twist * side;
    out.elbowZ[i] = elbow.spread * side;
    out.hipX[i] = p.hip.x;
    out.hipY[i] = p.hip.twist * side;
    out.hipZ[i] = p.hip.spread * side;
    out.kneeX[i] = p.knee.x;
    out.kneeY[i] = p.knee.twist * side;
    out.kneeZ[i] = p.knee.spread * side;
  }
}

/** Ease every angle toward a target, in place. One `MathUtils.damp` per number,
 *  which is exactly what the frame loop used to spell out field by field. */
export function dampAngles(a: Angles, target: Angles, lambda: number, delta: number) {
  const dst = a as unknown as Record<string, number | number[]>;
  const src = target as unknown as Record<string, number | number[]>;
  for (const key in dst) {
    const to = src[key];
    if (typeof to === "number") {
      dst[key] = THREE.MathUtils.damp(dst[key] as number, to, lambda, delta);
    } else {
      const pair = dst[key] as number[];
      pair[0] = THREE.MathUtils.damp(pair[0], to[0], lambda, delta);
      pair[1] = THREE.MathUtils.damp(pair[1], to[1], lambda, delta);
    }
  }
}

/**
 * Copy every angle across, in place.
 *
 * The walk cycle is added onto a *copy* of the damped angles, never onto the
 * angles themselves: those are the damper's own state, and a swing written
 * back into them is one the next frame eases away from — which smears the
 * cycle into a slow lean instead of playing it. Two `Angles` per figure and a
 * flat copy each frame is the cheap half of that trade.
 */
export function copyAngles(from: Angles, to: Angles) {
  const src = from as unknown as Record<string, number | number[]>;
  const dst = to as unknown as Record<string, number | number[]>;
  for (const key in src) {
    const v = src[key];
    if (typeof v === "number") {
      dst[key] = v;
    } else {
      const pair = dst[key] as number[];
      pair[0] = v[0];
      pair[1] = v[1];
    }
  }
}

export type Chain = ReturnType<typeof buildChain>;

/** The bone chain in hierarchy order, so a parent's rotation is always known
 *  before its children are placed. */
export function buildChain(character: Character) {
  const order: {
    bone: THREE.Bone;
    rest: THREE.Quaternion;
    parent: number;
    role: Driven | null;
  }[] = [];
  const visit = (bone: THREE.Bone, parent: number) => {
    const i = order.length;
    order.push({
      bone,
      rest: character.rest.get(bone) ?? bone.quaternion.clone(),
      parent,
      role: DRIVEN.has(bone.name) ? (bone.name as Driven) : null,
    });
    for (const child of bone.children) {
      if ((child as THREE.Bone).isBone) visit(child as THREE.Bone, i);
    }
  };
  const root = character.bones.Spine1;
  if (root) visit(root, -1);

  // Everything between the figure's own group and the first bone: the exporter
  // leaves a node there carrying the rotation that stands the model upright.
  const base = new THREE.Quaternion();
  const above: THREE.Object3D[] = [];
  for (let o = root?.parent; o && o !== character.root; o = o.parent) above.push(o);
  for (let i = above.length - 1; i >= 0; i--) base.multiply(above[i].quaternion);

  return { order, accumulated: order.map(() => new THREE.Quaternion()), base };
}

/** Scratch, reused every frame — a figure poses ten bones per frame and every
 *  one of these would otherwise be an allocation. */
const scratch = {
  euler: new THREE.Euler(),
  torso: new THREE.Quaternion(),
  limb: new THREE.Quaternion(),
  joint: new THREE.Quaternion(),
  invParent: new THREE.Quaternion(),
  swing: new THREE.Quaternion(),
  lean: new THREE.Quaternion(),
  twist: new THREE.Quaternion(),
  dir: new THREE.Vector3(),
  restDir: new THREE.Vector3(),
  angles: { x: 0, y: 0, z: 0 },
};

/** A bone's own length axis: Blender points a bone down its local +Y, which is
 *  what `restDir` reads and what a twist turns about. */
const AXIS = new THREE.Vector3(0, 1, 0);

/** The three angles a leaning bone holds, written into scratch rather than
 *  returned, since six bones per figure per frame would otherwise allocate. */
function leanAngles(role: Driven, a: Angles) {
  const out = scratch.angles;
  switch (role) {
    case "Spine1":
      [out.x, out.y, out.z] = [a.torsoX, a.torsoY, a.torsoZ];
      break;
    case "Spine1001":
      [out.x, out.y, out.z] = [a.chestX, a.chestY, a.chestZ];
      break;
    case "Neck":
      [out.x, out.y, out.z] = [a.neckX, a.neckY, a.neckZ];
      break;
    case "Head":
      [out.x, out.y, out.z] = [a.headX, a.headY, a.headZ];
      break;
    default: {
      const i = role === "ShoulderR" ? 1 : 0;
      [out.x, out.y, out.z] = [a.clavicleX[i], a.clavicleY[i], a.clavicleZ[i]];
    }
  }
  return out;
}

/** How far a bone is twisted about its own length. Zero for anything leaning —
 *  a lean's yaw is already one of its three axes. */
function twistOf(role: Driven, a: Angles): number {
  const i = role.endsWith("R") ? 1 : 0;
  if (role.startsWith("UpperLeg")) return a.hipY[i];
  if (role.startsWith("LowerLeg")) return a.kneeY[i];
  if (role.startsWith("UpperArm")) return a.shoulderY[i];
  if (role.startsWith("LowerArm")) return a.elbowY[i];
  return 0;
}

/**
 * Where a limb bone's own axis should point, in the figure's own frame.
 *
 * Arms ride the torso's lean and the legs deliberately do not, which is the one
 * thing the old jointed rig said out loud. It survives the move to a skeleton
 * where the legs hang off the same spine bone the lean is written onto, because
 * a target is stated in the figure's frame and then divided back through the
 * parent's rotation — so whatever the spine did is cancelled unless it is asked
 * for here.
 */
function target(role: Driven, a: Angles, out: THREE.Vector3): THREE.Vector3 {
  const { euler, torso, limb, joint } = scratch;
  const i = role.endsWith("R") ? 1 : 0;
  if (role.startsWith("UpperLeg") || role.startsWith("LowerLeg")) {
    limb.setFromEuler(euler.set(a.hipX[i], 0, a.hipZ[i]));
    if (role.startsWith("LowerLeg")) {
      limb.multiply(joint.setFromEuler(euler.set(a.kneeX[i], 0, a.kneeZ[i])));
    }
    return out.copy(DOWN).applyQuaternion(limb);
  }
  limb.setFromEuler(euler.set(a.shoulderX[i], 0, a.shoulderZ[i]));
  if (role.startsWith("LowerArm")) {
    limb.multiply(joint.setFromEuler(euler.set(a.elbowX[i], 0, a.elbowZ[i])));
  }
  out.copy(DOWN).applyQuaternion(limb);
  // The arms ride the two spine leans, in the order the chain composes them —
  // and only those. A collar bone moves where an arm starts, never where it
  // points, which is the same cancelling that keeps the legs out of the lean.
  out.applyQuaternion(torso.setFromEuler(euler.set(a.torsoX, a.torsoY, a.torsoZ)));
  return out.applyQuaternion(joint.setFromEuler(euler.set(a.chestX, a.chestY, a.chestZ)));
}

/**
 * Write the angles onto the bones.
 *
 * The rig is bound in the star pose, so a bone's rest rotation is most of where
 * its limb already points. Each driven bone is solved for the *swing* that
 * takes its rest direction to the target and that swing is composed onto the
 * rest — never written over it, which is the mistake that folds the body
 * inside out.
 */
export function applyPose(chain: Chain, a: Angles) {
  const { euler, invParent, swing, lean, twist, dir, restDir } = scratch;
  for (let i = 0; i < chain.order.length; i++) {
    const link = chain.order[i];
    // The skeleton sits inside a node the exporter rotated to stand the model
    // up, so the chain starts from that rather than from nothing — miss it and
    // every target is solved in a frame tipped on its side.
    const parentQ = link.parent >= 0 ? chain.accumulated[link.parent] : chain.base;
    if (!link.role) {
      chain.accumulated[i].copy(parentQ).multiply(link.bone.quaternion);
      continue;
    }

    if (LEANS.has(link.role)) {
      // A lean, not an aim. `Spine1` runs *downward* from the waist, so asking
      // it to point at the sky folds the body in half; the head already points
      // where it should, and a collar bone points sideways. All six turn about
      // the figure's own axes, each stacked on whatever the one below it did.
      // Conjugating by the parent is what states the turn in the figure's frame
      // rather than in the frame it inherited.
      const { x, y, z } = leanAngles(link.role, a);
      lean.setFromEuler(euler.set(x, y, z));
      invParent.copy(parentQ).invert();
      swing.copy(invParent).multiply(lean).multiply(parentQ);
      link.bone.quaternion.copy(swing).multiply(link.rest);
    } else {
      target(link.role, a, dir).normalize();
      dir.applyQuaternion(invParent.copy(parentQ).invert());
      restDir.copy(UP).applyQuaternion(link.rest).normalize();
      swing.setFromUnitVectors(restDir, dir);
      link.bone.quaternion.copy(swing).multiply(link.rest);
      // A twist turns the bone about its own length, so it goes on the *inside*
      // of the rest rotation, where the bone's axis is local +Y. It leaves the
      // limb pointing exactly where the aim put it and rolls what hangs off it.
      const t = twistOf(link.role, a);
      if (t) link.bone.quaternion.multiply(twist.setFromAxisAngle(AXIS, t));
    }
    chain.accumulated[i].copy(parentQ).multiply(link.bone.quaternion);
  }
}
