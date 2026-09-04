import * as THREE from "three";
import { CLING_CEILING, CLING_WALL } from "@/shared/protocol";

// none: never turns. back: lies with back on the surface, head forward. side:
// on its shoulder — never stands up.
export type FlatMode = "none" | "back" | "side";

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UPRIGHT = new THREE.Quaternion();

// Figure faces -Z, head at +Y.
//                  | floor                    | ceiling      | wall
//   back           | π about (0, 1, -1)       | Rx(-π/2)     | upright
//   side           | Rz(+π/2)                 | same         | same
// back on the floor is two things at once — back down AND head forward — so
// one axis is not enough; on a ceiling one axis IS enough (Rx flip).
// side holds onto walls by lying against them; a body on its back cannot.
type Turns = { floor: THREE.Quaternion; ceiling: THREE.Quaternion; wall: THREE.Quaternion };

const SIDE_TURN = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2);

const TURNS: Record<Exclude<FlatMode, "none">, Turns> = {
  back: {
    floor: new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, -1).normalize(),
      Math.PI,
    ),
    ceiling: new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2),
    wall: UPRIGHT,
  },
  side: {
    floor: SIDE_TURN,
    ceiling: SIDE_TURN,
    wall: SIDE_TURN,
  },
};

// upright (X toggle) beats everything — a pose that CAN lie flat may be held
// on its feet instead.
export function flatFor(mode: FlatMode, cling: number, upright = false): THREE.Quaternion {
  if (mode === "none" || upright) return UPRIGHT;
  if (cling === CLING_WALL) return TURNS[mode].wall;
  return cling === CLING_CEILING ? TURNS[mode].ceiling : TURNS[mode].floor;
}

const spun = new THREE.Vector3();

// Player.tsx keys the collider on half.join() — round out float dust.
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

export function turnHalf(
  half: readonly [number, number, number],
  turn: THREE.Quaternion,
): [number, number, number] {
  spun.set(half[0], half[1], half[2]).applyQuaternion(turn);
  return [tidy(Math.abs(spun.x)), tidy(Math.abs(spun.y)), tidy(Math.abs(spun.z))];
}

export function turnCentre(
  centre: readonly [number, number, number],
  turn: THREE.Quaternion,
): [number, number, number] {
  spun.set(centre[0], centre[1], centre[2]).applyQuaternion(turn);
  return [tidy(spun.x), tidy(spun.y), tidy(spun.z)];
}
