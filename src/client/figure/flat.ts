import * as THREE from "three";
import { CLING_CEILING, CLING_WALL } from "@/shared/protocol";

/**
 * How a pose lies when it is on a flat surface, per pose.
 *
 * - `none` — never turns. `stand` is upright by definition and `curl` is a ball
 *   that reads the same whichever way up it is.
 * - `back` — lies with its back on the surface and its head pointing the way the
 *   body faces. A body that lies down feet-first slides feet-first when you walk.
 * - `side` — lies on its shoulder, which is what `lie` has always done, and it
 *   never stands up: a pose whose whole idea is being flat against a surface is
 *   flat against every one of them.
 *
 * `back` stands upright to hold a **wall**, because a body on its back cannot
 * grip one. A ceiling it lies against, the same way it lies on a floor.
 */
export type FlatMode = "none" | "back" | "side";

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UPRIGHT = new THREE.Quaternion();

/**
 * How a pose is turned, by which surface it is against.
 *
 * **A ceiling is lain against, exactly as a floor is; only a wall is *held*.**
 * That was not always so — both used to be held upright, because a `back` pose
 * lying on a ceiling is long along its forward axis, you face a wall to climb
 * one, and reaching the ceiling drove a body-length of collider straight into
 * that wall and jammed. What made lying on a ceiling safe is the later rule in
 * `poseExtents`: **the turned box supplies its vertical extent and nothing
 * else**, so the footprint stays the standing one and there is no body-length
 * left to swing into anything. A wall stays upright for a different and
 * permanent reason — a body on its back cannot grip one.
 *
 * The figure faces **−Z** with its head at **+Y**.
 *
 * | mode | on the floor | on a ceiling | holding a wall |
 * | ---- | ------------ | ------------ | -------------- |
 * | `back` | back down, head forward — π about (0, 1, −1) | back **up**, head forward — `Rx(−π/2)` | upright |
 * | `side` | on its shoulder — `Rz(+π/2)` | the same | the same |
 *
 * `back` on the floor is not a rotation about one axis, because it wants two
 * things at once. Tipping about X alone gets the back down and swings the head
 * to +Z, which is backwards; rolling about Z lays the body on its shoulder,
 * which is `side`. On a **ceiling** one axis is enough, and it is the tipping
 * that failed on the floor: with the back going *up* rather than down, `Rx` is
 * exactly the turn that also leaves the head forward. The two differ by a
 * left-right flip, which is what lying on your back rather than your front is.
 *
 * `side` is the same turn on all three: its whole idea is being flat against a
 * surface, its long axis is left-right rather than forward, and `Rz(+π/2)` puts
 * the right shoulder up — which is the shoulder a ceiling is against.
 */
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
    // `side` holds on exactly as it lies: it never stands up at all.
    wall: SIDE_TURN,
  },
};

/**
 * How this pose sits on this surface. Identity when it does not turn at all.
 *
 * **`upright` is the player's own X toggle** and beats everything: a pose that
 * *can* lie flat does not always want to. The same flag reaches `poseExtents`
 * and `poseCentre`, so the collider stands up with the figure rather than the
 * body being drawn on its feet inside a box lying on the floor.
 */
export function flatFor(mode: FlatMode, cling: number, upright = false): THREE.Quaternion {
  if (mode === "none" || upright) return UPRIGHT;
  if (cling === CLING_WALL) return TURNS[mode].wall;
  return cling === CLING_CEILING ? TURNS[mode].ceiling : TURNS[mode].floor;
}

const spun = new THREE.Vector3();

/**
 * Rotating by a quaternion leaves float dust — 0.23 comes back as
 * 0.22999999999999987. Harmless arithmetically, but `Player.tsx` keys the
 * collider on `half.join()`, and a key is nicer without it.
 */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A pose's collider box, turned to match how the body is lying.
 *
 * **Poses state their box standing up**, which is the only way a pose can be
 * flagged as flat without also being re-measured by hand — and the first cut of
 * this got that backwards. `reach` was flagged flat and kept its standing box,
 * so the figure lay down inside a collider 1.1 units tall and hung in mid-air
 * instead of resting on the floor.
 *
 * Half-extents are unsigned, so the rotation is applied and the components
 * taken absolute; a centre is a real offset and keeps its signs.
 */
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
