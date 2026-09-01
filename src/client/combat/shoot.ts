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
 * **A shot hits the figure or it hits nothing.** The raycast is resolved
 * against the mesh's own triangles, with the skinning applied, so what counts
 * is what is under the crosshair — a pixel off a wrist is a miss.
 *
 * This replaced an aim-assist ball: the body's world bounds inflated by 1.4 and
 * floored at 0.6 m, tried alongside the mesh and taken whenever it was nearer.
 * The reasoning was that a stick figure's limbs are a few centimetres across
 * and a gun that misses what it is pointed at feels broken — but it made a
 * chameleon killable while nothing of them was visible under the crosshair,
 * which is the opposite of what hiding is for. **A hunter now has to actually
 * hit what they are aiming at.**
 *
 * The bounding volumes grown in `figure/model.ts` are still load-bearing, and
 * more so than before: they are the broad phase this exact test sits behind, and
 * a volume that does not cover a reached-out arm rejects the shot before any
 * triangle is looked at.
 */
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

  /** The body the shot landed on, if it landed on one at all. */
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
      // The exact point on the body, which is where the grave belongs.
      hitAt.copy(person.point);
    }
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
