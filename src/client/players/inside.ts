import * as THREE from "three";

/** How far short of a surface the centre is stopped. */
const SKIN = 0.02;

const ray = new THREE.Raycaster();
const step = new THREE.Vector3();

/**
 * The body's centre may never cross a surface.
 *
 * **A backstop, not the collision system.** Rapier's character controller
 * resolves *movement*, from where the body already is — so it never sees the
 * three places this file exists for:
 *
 * - the foot compensation, which shifts the body outright when a pose changes
 *   the shape of its box;
 * - `seatOn`, which shifts it outright when the surface changes;
 * - the collider being **rebuilt** with new extents when the pose box changes,
 *   which can bring it into existence already overlapping a wall.
 *
 * None of those is a movement, so none of them is checked, and a pose change
 * against a wall could put the body on the far side of it.
 *
 * This sweeps the centre from where it provably was to where it is about to be
 * and stops it short of anything in the way. **It does not stop the body
 * overlapping** — the collider is deliberately narrower than the figure and
 * that gap is the hiding mechanic (`body.ts`). What it guarantees is that the
 * *centre* is always on the room's side of every wall, so a chameleon can sink
 * into scenery and never end up behind it.
 */
export function keepInside(
  /** Where the centre provably was — last frame's position. */
  from: THREE.Vector3,
  /** Where it is about to be. Clamped in place. */
  to: THREE.Vector3,
  solids: THREE.Object3D[],
): boolean {
  if (!solids.length) return false;
  step.subVectors(to, from);
  const distance = step.length();
  if (distance < 1e-6) return false;

  ray.set(from, step.divideScalar(distance));
  ray.far = distance;
  const blocked = ray.intersectObjects(solids, false)[0];
  if (!blocked) return false;

  to.copy(from).addScaledVector(ray.ray.direction, Math.max(0, blocked.distance - SKIN));
  return true;
}

/** Started a hair above the foot line, so a body resting exactly on the floor
 *  does not have its first hit be the floor it is standing on. */
const LIFT = 0.02;
/** No ceiling further than this is worth knowing about — nothing a player can
 *  hold is taller, and an unbounded ray is one more thing for every frame to
 *  walk the whole room for. */
const REACH = 6;
const up = new THREE.Vector3(0, 1, 0);
const from = new THREE.Vector3();

/**
 * How much clear height there is above the body's feet, or `Infinity` under an
 * open sky.
 *
 * **What it is for: a pose is not always something you can leave.** A chameleon
 * lying under a bed or curled into a cupboard has a box a fraction of their
 * standing height, and standing back up would put the rest of them through the
 * furniture above. `players/Player.tsx` measures against this before it lets a
 * pose change — or the walk that forces one — happen at all.
 *
 * One ray, straight up from the middle of the feet. It will not notice a beam
 * that clears the centre and clips a shoulder; the alternative is a shape cast
 * per frame per pose, and the cheap version is what a player reads as "there is
 * a bed over me".
 */
export function headroom(
  /** The body's centre — only its x and z are read. */
  body: THREE.Vector3,
  /** World height of the underside of the body's box. */
  footY: number,
  solids: THREE.Object3D[],
): number {
  if (!solids.length) return Infinity;
  from.set(body.x, footY + LIFT, body.z);
  ray.set(from, up);
  ray.far = REACH;
  const above = ray.intersectObjects(solids, false)[0];
  return above ? above.distance + LIFT : Infinity;
}

/** Below this, an overlap is float dust rather than a body in a wall. Without
 *  it a box resting exactly on the floor is pushed up every frame and floats. */
const TOLERANCE = 0.005;

/** The box's own axes in world space, rebuilt per call rather than allocated. */
const axis = [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3()];
const boxCentre = new THREE.Vector3();
const push = new THREE.Vector3();

/**
 * Keep the whole collider inside the room, not just its centre.
 *
 * `keepInside` above guarantees the *centre* never crosses a surface, which is
 * what stops a chameleon ending up behind a wall. It says nothing about the
 * box around that centre, and the same three moments put the box through one:
 * the foot compensation and `seatOn` shift the body outright, and a pose change
 * **rebuilds the collider at a new size** around a centre that never moved. The
 * character controller sees none of them, because none of them is a movement.
 *
 * So each of the box's three axes is measured against the shell and the body is
 * pushed back out of whatever it is sticking into.
 *
 * **Shell only** — floor, walls and ceiling. The furniture is what a chameleon
 * hides *in*, and a collider deliberately smaller than the figure sinking into
 * a barrel is the hiding mechanic working (`body.ts`). What this is for is the
 * room itself.
 *
 * **Along the box's own axes, not the world's.** The collider turns with the
 * body's yaw, so a box pressed against a wall at an angle overlaps along a
 * direction no world axis names.
 *
 * **Never along the surface being held.** A clinging chameleon is against their
 * wall on purpose and `seatOn` put them there; pushing them off it drops them
 * out of reach of their own cling probe, which is the bug that made wrapping
 * onto a ceiling fall off. The other two axes are still corrected, so a climber
 * meeting the ceiling is still let out of it.
 *
 * **It only measures from the centre outward**, so it needs the centre already
 * in the room — call it after `keepInside`, never instead of it. A ray starting
 * inside geometry leaves through a back face and reports nothing.
 */
export function pushInside(
  /** The body's position. Moved in place. */
  position: THREE.Vector3,
  /** The collider's half-extents, in the frame it is finally in. */
  half: readonly [number, number, number],
  /** Where the box sits relative to the body, before the body's yaw. */
  centre: readonly [number, number, number],
  yaw: number,
  /** What the body is holding, if anything — its surface normal. */
  cling: THREE.Vector3 | null,
  shell: THREE.Object3D[],
): boolean {
  if (!shell.length) return false;

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  axis[0].set(cos, 0, -sin);
  axis[2].set(sin, 0, cos);

  boxCentre
    .set(centre[0] * cos + centre[2] * sin, centre[1], -centre[0] * sin + centre[2] * cos)
    .add(position);

  push.set(0, 0, 0);
  let moved = false;

  for (let i = 0; i < 3; i++) {
    const direction = axis[i];
    // The surface this body is holding. `seatOn` owns that distance.
    if (cling && Math.abs(direction.dot(cling)) > 0.7) continue;

    const reach = half[i];
    if (reach <= 0) continue;

    ray.far = reach;
    ray.set(boxCentre, direction);
    const ahead = ray.intersectObjects(shell, false)[0];
    ray.set(boxCentre, step.copy(direction).negate());
    const behind = ray.intersectObjects(shell, false)[0];

    const outAhead = ahead ? reach - ahead.distance : 0;
    const outBehind = behind ? reach - behind.distance : 0;
    if (outAhead <= TOLERANCE && outBehind <= TOLERANCE) continue;

    // Pinched: the gap is narrower than the box, so there is no position that
    // satisfies both sides. Sit in the middle of it rather than picking a wall
    // to be inside of.
    const shift = outAhead > 0 && outBehind > 0
      ? (outBehind - outAhead) / 2
      : outBehind - outAhead;

    push.addScaledVector(direction, shift);
    moved = true;
  }

  if (moved) position.add(push);
  return moved;
}
