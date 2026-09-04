import * as THREE from "three";
import { CLING_CEILING, CLING_NONE, CLING_WALL } from "@/shared/protocol";
import { BODY_SCALE } from "./body";

// Tolerance around a chameleon, scaled with the body.
export const CLING_GAP = 0.35 * BODY_SCALE.chameleon;
export const CLIMB_SPEED = 4;
export const STICK_SPEED = 2;
export const RECLING_GRACE = 0.4;
export const RELEASE_PUSH = 2.5;
const WALL_DOT = 0.5;
// ~70° either side of straight into the face.
const INTO_SURFACE = 0.35;

const ray = new THREE.Raycaster();
const worldNormal = new THREE.Vector3();
const quat = new THREE.Quaternion();
const back = new THREE.Vector3();
const dirUnit = new THREE.Vector3();

export function supportFor(dir: THREE.Vector3, half: readonly [number, number, number]) {
  return Math.abs(dir.x) * half[0] + Math.abs(dir.y) * half[1] + Math.abs(dir.z) * half[2];
}

export function reachFor(dir: THREE.Vector3, half: readonly [number, number, number]) {
  return supportFor(dir, half) + CLING_GAP;
}

const SEAT_LOOK = 3;

// Re-seat the body after its box changes shape — wrapping wall→ceiling leaves
// the origin a body-length off the new surface and out of cling reach.
export function seatOn(
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  half: readonly [number, number, number],
  solids: THREE.Object3D[],
): boolean {
  if (!solids.length) return false;
  back.copy(normal).negate();
  ray.set(origin, back);
  ray.far = SEAT_LOOK;
  const hit = ray.intersectObjects(solids, false)[0];
  if (!hit) return false;
  origin.addScaledVector(normal, supportFor(normal, half) - hit.distance);
  return true;
}

export function probe(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  half: readonly [number, number, number],
  solids: THREE.Object3D[],
): THREE.Vector3 | null {
  if (!solids.length || dir.lengthSq() === 0) return null;
  dirUnit.copy(dir).normalize();

  ray.set(origin, dirUnit);
  ray.far = reachFor(dirUnit, half);
  const hit = ray.intersectObjects(solids, false)[0];
  if (!hit?.face) return null;

  worldNormal
    .copy(hit.face.normal)
    .applyQuaternion(hit.object.getWorldQuaternion(quat))
    .normalize();
  back.copy(dirUnit).negate();
  if (worldNormal.dot(back) < 0) worldNormal.negate();
  return worldNormal.clone();
}

export function findCling(
  origin: THREE.Vector3,
  moveDir: THREE.Vector3,
  half: readonly [number, number, number],
  solids: THREE.Object3D[],
): THREE.Vector3 | null {
  if (moveDir.lengthSq() === 0) return null;
  const normal = probe(origin, moveDir, half, solids);
  if (!normal) return null;
  if (Math.abs(normal.y) > WALL_DOT) return null;

  dirUnit.copy(moveDir).normalize();
  return dirUnit.dot(normal) < -INTO_SURFACE ? normal : null;
}

export function holdsCling(
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  half: readonly [number, number, number],
  solids: THREE.Object3D[],
): THREE.Vector3 | null {
  back.copy(normal).negate();
  return probe(origin, back, half, solids);
}

export function wrapCling(
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  climbDir: THREE.Vector3,
  half: readonly [number, number, number],
  solids: THREE.Object3D[],
): THREE.Vector3 | null {
  if (climbDir.lengthSq() === 0) return null;
  const found = probe(origin, climbDir, half, solids);
  // Within a few degrees of the face already held is the same face.
  return found && found.dot(normal) < 0.95 ? found : null;
}

export const isWall = (normal: THREE.Vector3) => Math.abs(normal.y) <= WALL_DOT;

// Normal points back at the player, so a ceiling's points down.
export function clingKind(normal: THREE.Vector3 | null) {
  if (!normal) return CLING_NONE;
  if (isWall(normal)) return CLING_WALL;
  return normal.y < 0 ? CLING_CEILING : CLING_NONE;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function wallTangents(
  normal: THREE.Vector3,
  up: THREE.Vector3,
  right: THREE.Vector3,
) {
  if (!isWall(normal)) return false;
  up.copy(WORLD_UP).addScaledVector(normal, -WORLD_UP.dot(normal));
  if (up.lengthSq() < 1e-6) return false;
  up.normalize();
  right.crossVectors(up, normal).normalize();
  return true;
}
