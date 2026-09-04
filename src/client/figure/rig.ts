import * as THREE from "three";
import type { Character } from "./model";
import type { Joint, Pose } from "./poses";

// Free of React so this can be run against the real .glb outside a browser.

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

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

// Leans turn about the figure's axes; limbs are aimed.
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

// Kept outside StickFigure's frame loop so tests measuring a posed body see
// the same mapping the game draws with. spread/twist are outward per side.
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

// The walk cycle is added onto a COPY — writing back into the damper's own
// state smears the cycle into a slow lean.
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

  // Between the figure's group and the first bone: the exporter's stand-up node.
  const base = new THREE.Quaternion();
  const above: THREE.Object3D[] = [];
  for (let o = root?.parent; o && o !== character.root; o = o.parent) above.push(o);
  for (let i = above.length - 1; i >= 0; i--) base.multiply(above[i].quaternion);

  return { order, accumulated: order.map(() => new THREE.Quaternion()), base };
}

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

// Blender points a bone down its local +Y.
const AXIS = new THREE.Vector3(0, 1, 0);

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

function twistOf(role: Driven, a: Angles): number {
  const i = role.endsWith("R") ? 1 : 0;
  if (role.startsWith("UpperLeg")) return a.hipY[i];
  if (role.startsWith("LowerLeg")) return a.kneeY[i];
  if (role.startsWith("UpperArm")) return a.shoulderY[i];
  if (role.startsWith("LowerArm")) return a.elbowY[i];
  return 0;
}

// Arms ride the torso's lean, legs do not. A target is stated in the figure's
// frame and divided back through the parent, so the spine's lean is cancelled
// unless it is added back here.
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
  out.applyQuaternion(torso.setFromEuler(euler.set(a.torsoX, a.torsoY, a.torsoZ)));
  return out.applyQuaternion(joint.setFromEuler(euler.set(a.chestX, a.chestY, a.chestZ)));
}

// Composes each swing onto the rest rotation — never written over, which
// folds the body inside out.
export function applyPose(chain: Chain, a: Angles) {
  const { euler, invParent, swing, lean, twist, dir, restDir } = scratch;
  for (let i = 0; i < chain.order.length; i++) {
    const link = chain.order[i];
    const parentQ = link.parent >= 0 ? chain.accumulated[link.parent] : chain.base;
    if (!link.role) {
      chain.accumulated[i].copy(parentQ).multiply(link.bone.quaternion);
      continue;
    }

    if (LEANS.has(link.role)) {
      // Conjugating by the parent states the turn in the figure's own frame.
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
      // Twist goes inside the rest rotation, about the bone's local +Y.
      const t = twistOf(link.role, a);
      if (t) link.bone.quaternion.multiply(twist.setFromAxisAngle(AXIS, t));
    }
    chain.accumulated[i].copy(parentQ).multiply(link.bone.quaternion);
  }
}
