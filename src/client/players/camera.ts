import * as THREE from "three";

const CAMERA_MIN_DISTANCE = 1.4;
// The hard stop. Looking straight up puts the lens directly under the body; a
// generous minimum froze the view.
const CRAMPED_DISTANCE = 0.3;
const CAMERA_SKIN = 0.5;
const ROOF_SKIN = 0.3;
// Smaller than CAMERA_SKIN — every cm here is a cm the view cannot tip up.
export const FLOOR_SKIN = 0.3;
const GROUND_REACH = 8;
// Generous so a lens that has slipped under a floor is still recovered.
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

// NaN forces a snap next frame — used on room change.
let held = NaN;
const SNAP_JUMP = 3;

function groundUnder(x: number, y: number, z: number, shell: THREE.Object3D[]) {
  // Starts above the higher of the lens and the aim: a lens well below the
  // floor cannot find that floor from a probe anchored to itself.
  probe.set(x, Math.max(y, lookAt.y) + PROBE_RISE, z);
  ray.set(probe, DOWN);
  ray.far = PROBE_RISE + GROUND_REACH;
  const hit = ray.intersectObjects(shell, false)[0];
  return hit ? hit.point.y : -Infinity;
}

function ceilingOver(x: number, y: number, z: number, shell: THREE.Object3D[]) {
  probe.set(x, Math.min(y, lookAt.y) - PROBE_RISE, z);
  ray.set(probe, UP);
  ray.far = PROBE_RISE + GROUND_REACH;
  const hit = ray.intersectObjects(shell, false)[0];
  return hit ? hit.point.y : Infinity;
}

function legAbove(surfaceY: number, clearance: number) {
  const rise = surfaceY - clearance - lookAt.y;
  return rise > 0 ? rise / toCamera.y : Infinity;
}

// Infinity when the clearance is already lost — a lying chameleon whose origin
// sits nearer the floor than FLOOR_SKIN. A negative cap read as "as close as
// you are allowed" and slammed the camera into the body.
function legBelow(surfaceY: number, clearance: number) {
  const drop = lookAt.y - (surfaceY + clearance);
  return drop > 0 ? drop / -toCamera.y : Infinity;
}

// shell: floor, walls and ceiling only — furniture is skipped or the camera
// lurches on every crate. Returns the settled distance so the caller can hide
// a figure the camera ended up inside.
export function followThirdPerson(
  camera: THREE.Camera,
  bodyPos: THREE.Vector3,
  lookDir: THREE.Vector3,
  zoom: number,
  shell: THREE.Object3D[],
  delta: number,
) {
  lookAt.copy(bodyPos);
  toCamera.copy(lookDir).negate().normalize();

  const floorY = shell.length
    ? groundUnder(bodyPos.x, bodyPos.y, bodyPos.z, shell)
    : -Infinity;

  let distance = zoom;

  // Walls and roofs back the camera off; the ground never does — pulling in
  // on a level look at a lying player would collapse the shot.
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

  // Floor as a cap on the leg, only when heading downward.
  if (Number.isFinite(floorY) && toCamera.y < -1e-3)
    distance = Math.min(distance, legBelow(floorY, FLOOR_SKIN));

  // Straight up from the body, not along the orbit — the hospital is roofed in
  // patches, and an orbit ray leaves through an open side.
  if (shell.length && toCamera.y > 1e-3) {
    ray.set(lookAt, UP);
    ray.far = zoom + ROOF_SKIN;
    const roof = ray.intersectObjects(shell, false)[0];
    if (roof) distance = Math.min(distance, legAbove(roof.point.y, ROOF_SKIN));
  }

  distance = THREE.MathUtils.clamp(distance, Math.min(zoom, CRAMPED_DISTANCE), zoom);

  // Only the distance is eased, and only outward — pulling in must be immediate
  // or the lens enters the wall it is avoiding.
  if (!Number.isFinite(held) || Math.abs(distance - held) > SNAP_JUMP) held = distance;
  else if (distance < held) held = distance;
  else held += (distance - held) * (1 - Math.pow(0.0001, delta));

  settled.copy(lookAt).addScaledVector(toCamera, held);

  // Ground under the lens, not the body — over a stairwell or a ledge the two
  // are different. Only what is below the aim counts as ground: from above a
  // low ceiling the probe finds the ceiling's top and would lift the lens
  // through the roof.
  if (shell.length) {
    const under = groundUnder(settled.x, settled.y, settled.z, shell);
    if (Number.isFinite(under) && under < lookAt.y && settled.y < under + FLOOR_SKIN) {
      const leg = toCamera.y < -1e-3 ? legBelow(under, FLOOR_SKIN) : Infinity;
      if (Number.isFinite(leg)) {
        held = Math.max(CRAMPED_DISTANCE, Math.min(held, leg));
        settled.copy(lookAt).addScaledVector(toCamera, held);
      } else {
        // Aim itself inside the skin (a lying body): write height only.
        settled.y = under + FLOOR_SKIN;
      }
    }
  }

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

  // Segment test — the caps decide leg length, none of them knows what the leg
  // passes through.
  if (shell.length) {
    toSettled.subVectors(settled, lookAt);
    const reach = toSettled.length();
    if (reach > 1e-4) {
      ray.set(lookAt, toSettled.divideScalar(reach));
      ray.far = reach;
      const through = ray.intersectObjects(shell, false)[0];
      if (through) {
        // Never past the thing just hit — clamping up to CRAMPED_DISTANCE put
        // the lens through a nearer ceiling.
        held = Math.min(held, Math.max(through.distance * 0.5, through.distance - CAMERA_SKIN));
        settled.copy(lookAt).addScaledVector(ray.ray.direction, held);
      }
    }
  }

  camera.position.copy(settled);
  camera.lookAt(lookAt);
  return held;
}

export function resetFollow() {
  held = NaN;
}
