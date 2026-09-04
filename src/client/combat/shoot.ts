import * as THREE from "three";
import { remoteFigures } from "@/client/players/RemotePlayers";

export type Shot =
  | { kind: "player"; id: string; point: [number, number, number] }
  | {
      kind: "wall";
      position: [number, number, number];
      rotation: [number, number, number];
      origin: [number, number, number];
    }
  | null;

const SCREEN_CENTRE = new THREE.Vector2(0, 0);
const SURFACE_OFFSET = 0.02;

// Exact skinned-triangle test — no aim-assist ball (a killable body under an
// empty crosshair is the opposite of what hiding is for). The grown bounding
// volumes in figure/model.ts are the broad phase.

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

  let hitId: string | undefined;
  let hitDistance = Infinity;
  const hitAt = new THREE.Vector3();

  if (person) {
    // Walk to the ancestor carrying the remoteId.
    let owner: THREE.Object3D | null = person.object;
    while (owner && !owner.userData.remoteId) owner = owner.parent;
    const id = owner?.userData.remoteId as string | undefined;
    if (id) {
      hitId = id;
      hitDistance = person.distance;
      hitAt.copy(person.point);
    }
  }

  if (hitId && (!wall || hitDistance < wall.distance)) {
    return { kind: "player", id: hitId, point: [hitAt.x, hitAt.y, hitAt.z] };
  }

  if (!wall || !wall.face) return null;

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
