import * as THREE from "three";

/**
 * Where the hunter's own barrel ends, in world space.
 *
 * **The shot has always started at the camera and it still does.** `shoot.ts`
 * casts from the eye through the centre of the screen and never reads the
 * viewmodel — that is what makes the recoil's muzzle climb safe to look at. But
 * the *tracer* was drawn from that same point, and the camera is behind your
 * eyes: the beam left the middle of your face and the gun in your hands had
 * nothing to do with it.
 *
 * So the drawn origin is separated from the fired one. This is the channel, and
 * it is a module-level vector for the same reason `recoil.ts` is a boolean:
 * `Viewmodel` runs in the frame loop and the trigger is a DOM event in another
 * folder, and threading a prop between them would put a React re-render on
 * every shot.
 *
 * It is at most one frame stale, which at a metre from the eye is nothing.
 */
const point = new THREE.Vector3();
/** False whenever no viewmodel is mounted — a chameleon, or a hunter in paint
 *  mode. Callers fall back to the camera, which is where they started. */
let live = false;

/** Called by `Viewmodel` every frame it draws. */
export function publishMuzzle(world: THREE.Vector3) {
  point.copy(world);
  live = true;
}

/** Called when the viewmodel goes away, so a stale barrel is never fired from. */
export function clearMuzzle() {
  live = false;
}

/** The muzzle, or null if there is no gun on screen to have one. */
export function muzzleAt(): [number, number, number] | null {
  return live ? [point.x, point.y, point.z] : null;
}
