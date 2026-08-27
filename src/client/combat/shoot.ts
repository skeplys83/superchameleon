import * as THREE from "three";
import { remoteFigures } from "@/client/players/RemotePlayers";

/** What a shot from the centre of the screen hit. */
export type Shot =
  | { kind: "player"; id: string; point: [number, number, number] }
  | {
      kind: "wall";
      position: [number, number, number];
      rotation: [number, number, number];
      /** Where the shot started, so the tracer can be drawn along its path. */
      origin: [number, number, number];
    }
  | null;

const SCREEN_CENTRE = new THREE.Vector2(0, 0);
/** Lift the mark off the surface so it does not z-fight with it. */
const SURFACE_OFFSET = 0.02;

/**
 * A shot's hit volume is a **ball around the whole body**, not the body.
 *
 * The figure is a stick: arms and legs a few centimetres across, and a shot
 * resolved against the mesh itself has to land on one of them. That reads as a
 * gun that misses what it is pointed at — worst of all against a chameleon
 * standing side-on or folded into a pose, where the mesh under the crosshair
 * may be nothing at all. So the mesh test stays as the exact answer and a
 * sphere is tried alongside it, whichever is nearer.
 *
 * **It only ever helps the hunter**, which is the point: hiding is meant to be
 * won by not being *found*, not by being found and then survived because the
 * hitbox was the width of a wrist.
 *
 * Sized from the figure's own world bounds, so it follows the pose and the
 * body scale rather than assuming a standing chameleon.
 */
const HIT_INFLATE = 1.4;
/** Floor for that, so a curled body is still a target worth pointing at. */
const HIT_MIN_RADIUS = 0.6;

const hitBox = new THREE.Box3();
const hitSphere = new THREE.Sphere();
const hitPoint = new THREE.Vector3();

const worldNormal = new THREE.Vector3();
const quat = new THREE.Quaternion();
const facing = new THREE.Vector3();
const orient = new THREE.Object3D();

export function resolveShot(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  solids: THREE.Object3D[],
): Shot {
  raycaster.setFromCamera(SCREEN_CENTRE, camera);

  const figures = [...remoteFigures.values()];
  const person = figures.length ? raycaster.intersectObjects(figures, true)[0] : null;
  const wall = raycaster.intersectObjects(solids, false)[0];

  /** The nearest body the shot touches, by mesh or by ball. */
  let hitId: string | undefined;
  let hitDistance = Infinity;
  const hitAt = new THREE.Vector3();

  if (person) {
    // The hit is a limb mesh; its owner is whichever ancestor carries the id.
    let owner: THREE.Object3D | null = person.object;
    while (owner && !owner.userData.remoteId) owner = owner.parent;
    const id = owner?.userData.remoteId as string | undefined;
    // An unowned figure mesh is not a person, and falls through to the wall.
    if (id) {
      hitId = id;
      hitDistance = person.distance;
      hitAt.copy(person.point);
    }
  }

  // The ball, for everything the mesh test is too exact to catch.
  for (const fig of figures) {
    const id = fig.userData.remoteId as string | undefined;
    if (!id || id === hitId) continue;
    hitBox.setFromObject(fig);
    if (hitBox.isEmpty()) continue;
    hitBox.getBoundingSphere(hitSphere);
    hitSphere.radius = Math.max(hitSphere.radius * HIT_INFLATE, HIT_MIN_RADIUS);
    if (!raycaster.ray.intersectSphere(hitSphere, hitPoint)) continue;
    const distance = raycaster.ray.origin.distanceTo(hitPoint);
    if (distance >= hitDistance) continue;
    hitId = id;
    hitDistance = distance;
    // The mark belongs on the body, not on the shell of the ball around it.
    hitAt.copy(hitSphere.center);
  }

  if (hitId && (!wall || hitDistance < wall.distance)) {
    return { kind: "player", id: hitId, point: [hitAt.x, hitAt.y, hitAt.z] };
  }

  if (!wall || !wall.face) return null;

  // Room surfaces are unrotated, so the face normal only needs the object's
  // world rotation applied to become a world-space normal.
  worldNormal
    .copy(wall.face.normal)
    .applyQuaternion(wall.object.getWorldQuaternion(quat))
    .normalize();

  orient.position.copy(wall.point).addScaledVector(worldNormal, SURFACE_OFFSET);
  orient.lookAt(facing.copy(orient.position).add(worldNormal));

  return {
    kind: "wall",
    position: [orient.position.x, orient.position.y, orient.position.z],
    rotation: [orient.rotation.x, orient.rotation.y, orient.rotation.z],
    origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
  };
}
