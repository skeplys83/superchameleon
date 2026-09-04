import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

// Body model, 14-bone rig. Loaded once, cloned per figure.

const SRC = "/models/player.glb";

// glTF strips dots, so Blender's Spine1.001 arrives as Spine1001. Spine1 is
// the root; no hand bones (shotgun hangs off the forearm).
export const BONES = [
  "Spine1",
  "Spine1001",
  "Neck",
  "Head",
  "ShoulderL",
  "UpperArmL",
  "LowerArmL",
  "ShoulderR",
  "UpperArmR",
  "LowerArmR",
  "UpperLegL",
  "LowerLegL",
  "UpperLegR",
  "LowerLegR",
] as const;

export type BoneName = (typeof BONES)[number];

export type Character = {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  // Bind-pose local rotations — a pose is composed onto these, never over them
  // (the rig is bound in the star pose).
  rest: Map<THREE.Bone, THREE.Quaternion>;
};

let source: THREE.Group | null = null;
let inFlight: Promise<void> | null = null;

// Fetched from the join click. Idempotent.
export function preloadCharacter(): Promise<void> {
  if (source) return Promise.resolve();
  if (!inFlight) {
    inFlight = new GLTFLoader()
      .loadAsync(SRC)
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          mesh.castShadow = true;
          // Grow bound volumes — three computes from the bind pose (star), so a
          // reached-out pose falls outside them and a shot at an arm misses.
          mesh.geometry.computeBoundingSphere();
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius *= 1.6;
          mesh.frustumCulled = false;
        });
        source = gltf.scene;
      })
      .catch((err) => {
        inFlight = null;
        throw err;
      });
  }
  return inFlight;
}

// Bind-space geometry — shared, so every client paints on the same one.
export function characterGeometry(): THREE.BufferGeometry | null {
  if (!source) return null;
  let geometry: THREE.BufferGeometry | null = null;
  source.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) geometry = (o as THREE.SkinnedMesh).geometry;
  });
  return geometry;
}

export function makeCharacter(): Character | null {
  if (!source) return null;
  const root = cloneSkinned(source);

  let mesh: THREE.SkinnedMesh | null = null;
  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = new Map<THREE.Bone, THREE.Quaternion>();

  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    if ((o as THREE.Bone).isBone) {
      const bone = o as THREE.Bone;
      rest.set(bone, bone.quaternion.clone());
      if ((BONES as readonly string[]).includes(bone.name)) {
        bones[bone.name as BoneName] = bone;
      }
    }
  });

  if (!mesh) return null;
  return { root, mesh, bones, rest };
}
