import * as THREE from "three";

/**
 * How close a **wall** may push the lens. The ground and the roof overhead are
 * allowed closer than this — see `CRAMPED_DISTANCE` — because a low room is the
 * one place a third-person camera has to give ground or stop turning.
 */
const CAMERA_MIN_DISTANCE = 1.4;
/**
 * The hard stop, and only the ground and the roof caps ever reach it.
 *
 * Looking straight up means the lens is directly *under* the body, and in a
 * room with a floor there is nowhere for it to be except close. Refusing to go
 * closer than a comfortable distance is what stopped the view turning at all —
 * so it is allowed in, and `Player.tsx` hides the figure once the lens is
 * inside it rather than filling the screen with the inside of a head.
 */
const CRAMPED_DISTANCE = 0.3;
/** Keep the lens off the walls. */
const CAMERA_SKIN = 0.5;
/**
 * And off the roof. Smaller for the same reason the floor's is: a ceiling is
 * one of the two surfaces the view runs out of room against, and in a low room
 * a generous skin is most of the headroom there was.
 */
const ROOF_SKIN = 0.3;
/**
 * And off the floor — deliberately the smaller of the two.
 *
 * Every centimetre here is a centimetre the view cannot tip up: the lens swings
 * down as the pitch rises and the floor is what it runs out of room against. A
 * wall is only ever behind you and can afford to be generous.
 */
export const FLOOR_SKIN = 0.3;
/** How far down to look for the ground under the body. Past this there is no
 *  floor worth capping against — a pit, or a body in mid-air. */
const GROUND_REACH = 8;
/**
 * How far above the lens its own ground probe starts. Generous on purpose: a
 * lens that has already slipped under a floor is only recovered if the probe
 * begins above that floor, and one that starts at the lens can only ever find
 * ground the lens is not yet inside.
 */
const PROBE_RISE = 1.5;

const lookAt = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const ray = new THREE.Raycaster();
const hitNormal = new THREE.Vector3();
const settled = new THREE.Vector3();
const toSettled = new THREE.Vector3();
const probe = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Last frame's distance. Only the *distance* is smoothed — the camera itself is
 * rigid on the body, see below. `NaN` means "no previous frame": the first call,
 * and after a room change, which must snap rather than fly in from the old spot.
 */
let held = NaN;
/** A jump this large is a teleport, not a wall — snap. */
const SNAP_JUMP = 3;

/** The ground beneath a point, or `-Infinity` where there is none. */
function groundUnder(x: number, y: number, z: number, shell: THREE.Object3D[]) {
  // **Started from whichever is higher, the lens or the aim.** A lens that has
  // sunk well below the floor — a lying body at a steep up-look puts it metres
  // under — cannot find that floor from a probe anchored to itself, and a floor
  // it cannot find is a floor it does not get lifted out of. The aim is always
  // inside the room, so starting from it always sees the room's own ground.
  probe.set(x, Math.max(y, lookAt.y) + PROBE_RISE, z);
  ray.set(probe, DOWN);
  ray.far = PROBE_RISE + GROUND_REACH;
  const hit = ray.intersectObjects(shell, false)[0];
  return hit ? hit.point.y : -Infinity;
}

/** The ceiling above a point, or `Infinity` where there is none. */
function ceilingOver(x: number, y: number, z: number, shell: THREE.Object3D[]) {
  // Started below the point for the same reason the ground probe starts above
  // it: a lens that has already crossed a surface is only recovered by a ray
  // that begins on the other side of it.
  probe.set(x, Math.min(y, lookAt.y) - PROBE_RISE, z);
  ray.set(probe, UP);
  ray.far = PROBE_RISE + GROUND_REACH;
  const hit = ray.intersectObjects(shell, false)[0];
  return hit ? hit.point.y : Infinity;
}

/**
 * The longest leg that still leaves the lens `clearance` *below* `surfaceY`,
 * and `Infinity` when that is already impossible — see `legBelow`.
 */
function legAbove(surfaceY: number, clearance: number) {
  const rise = surfaceY - clearance - lookAt.y;
  return rise > 0 ? rise / toCamera.y : Infinity;
}

/**
 * The longest leg that still leaves the lens `clearance` above `surfaceY`,
 * measured **along the direction it is already pointing**.
 *
 * This is the whole of the rework. Every height clamp used to slide the lens
 * around its sphere at a fixed distance, which looks right and is not: on the
 * floor, the seat that comes out depends only on the *horizontal* direction, so
 * pitching further up moved the camera nowhere at all. The view froze, and it
 * took enough mouse travel to swing the unclamped seat back above the floor
 * before anything happened again — worse the closer the camera was, because a
 * short leg crosses the floor at a shallower angle. Solving for the distance
 * instead keeps the lens exactly on the line the pitch describes, so every
 * fraction of a degree moves it and the camera slides down to the floor and
 * along it continuously.
 *
 * **`Infinity` when the clearance is already lost**, which is not a rounding
 * case — it is a lying chameleon, whose origin sits nearer the floor than
 * `FLOOR_SKIN`. There is no length of leg that clears a surface the aim point
 * is already inside, so the honest answer is that this surface cannot cap
 * anything. Returning the negative number instead made the clamp below read it
 * as "as close as you are allowed", and the camera slammed into the body at
 * 2° of up-look.
 */
function legBelow(surfaceY: number, clearance: number) {
  const drop = lookAt.y - (surfaceY + clearance);
  return drop > 0 ? drop / -toCamera.y : Infinity;
}

/**
 * @param shell Floor, walls and ceiling only — never the furniture. A camera
 *   that backed away from every barrel and table spent a hunt lurching in and
 *   out, and in a furnished map that is most of what is behind you. Clipping
 *   through a crate for a frame is cheaper than the lurch. `world/levelScene.ts`
 *   decides what counts, from the collision object's name.
 * @returns the distance the lens actually settled at, so the caller can hide a
 *   figure the camera has ended up inside.
 */
export function followThirdPerson(
  camera: THREE.Camera,
  bodyPos: THREE.Vector3,
  lookDir: THREE.Vector3,
  zoom: number,
  shell: THREE.Object3D[],
  delta: number,
) {
  // The body's origin is the middle of the figure in every pose — measured, it
  // is within 0.05 of the posed mesh's own centre — so aiming there frames the
  // player centred whether they are standing, lying or curled up.
  lookAt.copy(bodyPos);
  toCamera.copy(lookDir).negate().normalize();

  // The ground under the *body*, which is what the height caps below are
  // measured against. Taken once: it does not depend on where the lens is, so
  // it cannot flicker as the camera moves, and a cap that flickers is a camera
  // that shakes.
  const floorY = shell.length
    ? groundUnder(bodyPos.x, bodyPos.y, bodyPos.z, shell)
    : -Infinity;

  let distance = zoom;

  // **Walls and roofs back the camera off; the ground never does.** A floor hit
  // on this ray is ignored outright: the aim point of a lying player sits a
  // hand's breadth above the ground, so any look from below the horizon crosses
  // the floor within a metre and pulling in would collapse the shot to nothing
  // the moment they lay down. The ground is handled by height instead, below,
  // where the distance it costs is proportional to how far up you are looking.
  if (shell.length) {
    ray.set(lookAt, toCamera);
    ray.far = zoom;
    const blocked = ray.intersectObjects(shell, false)[0];
    if (blocked?.face) {
      hitNormal.copy(blocked.face.normal).transformDirection(blocked.object.matrixWorld);
      if (hitNormal.y <= 0.5)
        distance = Math.max(CAMERA_MIN_DISTANCE, blocked.distance - CAMERA_SKIN);
    } else if (blocked) {
      distance = Math.max(CAMERA_MIN_DISTANCE, blocked.distance - CAMERA_SKIN);
    }
  }

  // **The floor, as a cap on the leg rather than a lift of the seat.** Only
  // when the lens is actually heading downwards; at a level view the leg is
  // parallel to the floor and there is nothing to solve for, which is exactly
  // when the camera should keep its whole zoom and glide.
  if (Number.isFinite(floorY) && toCamera.y < -1e-3)
    distance = Math.min(distance, legBelow(floorY, FLOOR_SKIN));

  // **The lens never rises above the roof over the player.** Measured straight
  // up from the body rather than along the orbit, because the hospital is
  // roofed in patches: a camera swinging up and back can leave a room through
  // an open side and come down on top of the roof next door with clear line of
  // sight the whole way. Nothing is clipped, and the shot is still of a
  // rooftop. No roof overhead, no cap — outdoors the camera is as free as ever.
  if (shell.length && toCamera.y > 1e-3) {
    ray.set(lookAt, UP);
    ray.far = zoom + ROOF_SKIN;
    const roof = ray.intersectObjects(shell, false)[0];
    // Positive only, for the reason `legBelow` returns `Infinity`: under a low
    // ceiling — or clung to one — the roof is already inside the skin, and a
    // negative cap is not a short leg but no leg at all.
    if (roof) distance = Math.min(distance, legAbove(roof.point.y, ROOF_SKIN));
  }

  distance = THREE.MathUtils.clamp(distance, Math.min(zoom, CRAMPED_DISTANCE), zoom);

  // **The camera is rigid on the body.** Lerping its *position* made it trail
  // and swim behind the player on every direction change, which reads as the
  // view wobbling rather than as smoothing. Only how far back it sits is eased,
  // and only outwards: pulling in has to be immediate or the lens enters the
  // wall it is avoiding.
  if (!Number.isFinite(held) || Math.abs(distance - held) > SNAP_JUMP) held = distance;
  else if (distance < held) held = distance;
  else held += (distance - held) * (1 - Math.pow(0.0001, delta));

  settled.copy(lookAt).addScaledVector(toCamera, held);

  // **The ground under the lens, which is not always the ground under the
  // body.** The cap above is measured where the player is standing; over a
  // stairwell, a ledge or a pit the floor beside them is somewhere else
  // entirely. This catches that, and takes its correction out of the leg for
  // the same reason — a seat written straight into `settled.y` leaves the lens
  // off the line the pitch describes, which is the camera that no amount of
  // mouse movement could budge.
  if (shell.length) {
    const under = groundUnder(settled.x, settled.y, settled.z, shell);
    // **Only what is below the aim counts as ground.** The probe starts
    // `PROBE_RISE` above the lens and looks down, so under a low ceiling the
    // first thing it finds is the *top* of that ceiling — and treating it as
    // floor lifted the lens through the roof, where the segment test then
    // slammed it to `CRAMPED_DISTANCE`. That was the camera jamming into the
    // body at any downward look in a low room.
    if (Number.isFinite(under) && under < lookAt.y && settled.y < under + FLOOR_SKIN) {
      const leg = toCamera.y < -1e-3 ? legBelow(under, FLOOR_SKIN) : Infinity;
      if (Number.isFinite(leg)) {
        held = Math.max(CRAMPED_DISTANCE, Math.min(held, leg));
        settled.copy(lookAt).addScaledVector(toCamera, held);
      } else {
        // Nothing along this line clears the floor: the leg is level or rising,
        // or the aim point is itself inside the skin — a body lying flat, whose
        // origin is a hand's breadth off the ground. Only the height is written
        // here, and only in that case. It costs the orbit, but `x` and `z` are
        // still taken from the pitch line, so the seat keeps moving as the view
        // turns and there is nothing here for a camera to freeze against.
        settled.y = under + FLOOR_SKIN;
      }
    }
  }

  // **The ceiling over the lens, which is not the ceiling over the body.** The
  // mirror of the floor correction above, and the reason a chameleon clinging
  // to a ceiling did not end up looking down at the roof from outside: the cap
  // taken from the body cannot help when the body is *already* within a skin of
  // the ceiling, so the seat has to be caught after the fact.
  if (shell.length) {
    const over = ceilingOver(settled.x, settled.y, settled.z, shell);
    if (Number.isFinite(over) && over > lookAt.y && settled.y > over - ROOF_SKIN) {
      const leg = toCamera.y > 1e-3 ? legAbove(over, ROOF_SKIN) : Infinity;
      if (Number.isFinite(leg)) {
        held = Math.max(CRAMPED_DISTANCE, Math.min(held, leg));
        settled.copy(lookAt).addScaledVector(toCamera, held);
      } else {
        settled.y = Math.min(settled.y, over - ROOF_SKIN);
      }
    }
  }

  // **Second pass, because a cap is not a clearance.** Everything above decides
  // how long the leg is; none of it knows what the leg passes *through*. A seat
  // that is the right distance and the right height can still be on the far
  // side of a wall it went through on the way, so the segment the lens actually
  // ended up on is tested, and can only ever shorten it further.
  if (shell.length) {
    toSettled.subVectors(settled, lookAt);
    const reach = toSettled.length();
    if (reach > 1e-4) {
      ray.set(lookAt, toSettled.divideScalar(reach));
      ray.far = reach;
      const through = ray.intersectObjects(shell, false)[0];
      if (through) {
        // **Never past the thing it just hit, whatever the minimum says.** This
        // used to clamp up to `CRAMPED_DISTANCE`, and on a near-vertical leg a
        // third of a metre is *through* a ceiling the ray had detected at a
        // tenth — which is a camera clinging to the roof from above, looking
        // down at a building it is supposed to be inside. Where the skin does
        // not fit, half the distance to the surface does, and a seat inside the
        // body is always better than a seat outside the room.
        held = Math.min(held, Math.max(through.distance * 0.5, through.distance - CAMERA_SKIN));
        settled.copy(lookAt).addScaledVector(ray.ray.direction, held);
      }
    }
  }

  camera.position.copy(settled);
  camera.lookAt(lookAt);
  return held;
}

/** Forget the eased distance, so the next frame places the camera outright. */
export function resetFollow() {
  held = NaN;
}
