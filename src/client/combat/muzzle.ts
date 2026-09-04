import * as THREE from "three";

// Barrel tip in world space — for drawing the tracer from the gun rather than
// the eye (shoot.ts still casts from the camera). Module-level so publishing
// from the frame loop does not React-render on every shot.
const point = new THREE.Vector3();
let live = false;

export function publishMuzzle(world: THREE.Vector3) {
  point.copy(world);
  live = true;
}

export function clearMuzzle() {
  live = false;
}

// Null when no viewmodel is mounted — callers fall back to the camera.
export function muzzleAt(): [number, number, number] | null {
  return live ? [point.x, point.y, point.z] : null;
}
