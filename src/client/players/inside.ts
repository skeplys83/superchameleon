import * as THREE from "three";

const SKIN = 0.02;

const ray = new THREE.Raycaster();
const step = new THREE.Vector3();

// Backstop for the three things the character controller misses: the foot
// compensation, seatOn, and collider rebuilds on a pose change. Guarantees the
// centre stays on the room's side of every wall; does not stop the body
// overlapping (the collider is narrower than the figure on purpose).
export function keepInside(
  from: THREE.Vector3,
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

// A hair above the foot so a body resting on the floor does not hit the floor.
const LIFT = 0.02;
const REACH = 6;
const up = new THREE.Vector3(0, 1, 0);
const from = new THREE.Vector3();

// Single upward ray — will miss a beam that clears the centre and clips a
// shoulder. The alternative is a per-frame shape cast.
export function headroom(
  body: THREE.Vector3,
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

// Below this, an overlap is float dust — a box resting on the floor would
// otherwise be pushed up every frame.
const TOLERANCE = 0.005;

const axis = [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3()];
const boxCentre = new THREE.Vector3();
const push = new THREE.Vector3();

// Push the whole collider (not just its centre) out of the shell. Along the
// box's own axes because the collider turns with the body's yaw. Shell only —
// sinking into furniture is the hiding mechanic. Never along the surface being
// held: seatOn owns that distance, and shoving a climber off it drops them out
// of reach of their own cling probe.
export function pushInside(
  position: THREE.Vector3,
  half: readonly [number, number, number],
  centre: readonly [number, number, number],
  yaw: number,
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

    // Pinched: sit in the middle rather than pick a wall to be inside of.
    const shift = outAhead > 0 && outBehind > 0
      ? (outBehind - outAhead) / 2
      : outBehind - outAhead;

    push.addScaledVector(direction, shift);
    moved = true;
  }

  if (moved) position.add(push);
  return moved;
}
