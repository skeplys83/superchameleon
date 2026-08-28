import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { POSES, poseCentre, poseExtents } from "../poses.ts";
import { flatFor } from "../flat.ts";
import { CLING_NONE, CLING_WALL } from "@/shared/protocol";
import { applyPose, buildChain, makeAngles, poseTargets } from "../rig.ts";
import { BONES, type BoneName, type Character } from "../model.ts";

/**
 * The pose table, measured against the body it is supposed to fit.
 *
 * **`figure/poses.ts` is a *fitted* table** — every `half` and `centre` in it
 * was arrived at by eye — and the failures that come of that do not look like
 * bad numbers. They look like a chameleon lying down and sinking into the floor
 * (`curl` sat at half its figure's shift and floated one 0.07 above it), or a
 * pose hanging out of the collider on the side that meets a wall.
 *
 * So this poses the **real `player.glb`** the way the game poses it — through
 * `poseTargets` and `applyPose`, the same two functions `StickFigure` calls —
 * skins it on the CPU, and measures where the body actually is. `rig.ts` has no
 * React and no WebGL in it, which is the whole reason this can run in Node; see
 * `docs/VERIFYING.md`.
 *
 * **It does not assert that the boxes are tight.** They are deliberately far
 * smaller than the body — that gap is the hiding mechanic, see
 * `players/body.ts`. What it pins is the two things a box can be *wrong* about:
 * where its underside is, and whether it has grown past the body.
 */

const GLB = path.resolve(import.meta.dirname, "../../../../public/models/player.glb");

/** The loader reaches for two browser globals on its way to a texture nobody
 *  here is going to look at. Both are stubs; the geometry is what matters. */
function shimBrowserGlobals() {
  const g = globalThis as unknown as Record<string, unknown>;
  g.self ??= globalThis;
  g.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
}

/** `makeCharacter` without the fetch — the same walk over the same scene. */
function characterFrom(scene: THREE.Object3D): Character {
  let mesh: THREE.SkinnedMesh | null = null;
  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = new Map<THREE.Bone, THREE.Quaternion>();
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    if ((o as THREE.Bone).isBone) {
      const bone = o as THREE.Bone;
      rest.set(bone, bone.quaternion.clone());
      if ((BONES as readonly string[]).includes(bone.name)) bones[bone.name as BoneName] = bone;
    }
  });
  if (!mesh) throw new Error("player.glb has no skinned mesh");
  return { root: scene, mesh, bones, rest };
}

type Box = { min: number[]; max: number[]; half: number[]; centre: number[] };

let character: Character;
let chain: ReturnType<typeof buildChain>;

beforeAll(async () => {
  shimBrowserGlobals();
  const file = fs.readFileSync(GLB);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().parse(buffer as ArrayBuffer, "", resolve, reject);
  });
  character = characterFrom(gltf.scene);
  chain = buildChain(character);
});

const CRUMPLE_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Where the body ends up in pose `i` on surface `cling`, in the body's own
 * frame — exactly the transform `StickFigure` builds: the posed skeleton, the
 * flat orientation with the crumple under it, then `offsetY`/`offsetZ`, which
 * move the *figure* inside its collider.
 *
 * Order matters and is the easy thing to get backwards: the offset is a
 * translation of the whole group, so it is applied *after* the rotation, not
 * to the vertices going into it.
 */
function measure(i: number, cling = CLING_NONE, upright = false): Box {
  const angles = makeAngles();
  poseTargets(POSES[i], angles);
  applyPose(chain, angles);
  character.root.updateMatrixWorld(true);
  character.mesh.skeleton.update();

  const turn = flatFor(POSES[i].flat, cling, upright)
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(CRUMPLE_AXIS, angles.rootX));

  const v = new THREE.Vector3();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const count = character.mesh.geometry.attributes.position.count;
  for (let n = 0; n < count; n++) {
    character.mesh.getVertexPosition(n, v);
    v.applyMatrix4(character.mesh.matrixWorld).applyQuaternion(turn);
    v.y += angles.offsetY;
    v.z += angles.offsetZ;
    for (const [k, n2] of [v.x, v.y, v.z].entries()) {
      if (n2 < min[k]) min[k] = n2;
      if (n2 > max[k]) max[k] = n2;
    }
  }
  return {
    min,
    max,
    half: [0, 1, 2].map((k) => (max[k] - min[k]) / 2),
    centre: [0, 1, 2].map((k) => (max[k] + min[k]) / 2),
  };
}

/** The body at the scale the table was fitted at, so measured and stated numbers
 *  are directly comparable. `poseExtents` is asked for pose 0's own height. */
const FITTED: [number, number, number] = [POSES[0].half[0], POSES[0].half[1], POSES[0].half[2]];

describe("the pose table, against the body it fits", () => {
  it("reports every pose", () => {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    for (let i = 0; i < POSES.length; i++) {
      const body = measure(i);
      const half = poseExtents(i, FITTED);
      const centre = poseCentre(i, FITTED[1]);
      const foot = centre[1] - half[1];
      console.log(
        `${i} ${POSES[i].key.padEnd(6)}` +
          ` stated ${POSES[i].half.map(round).join(",").padEnd(18)}` +
          ` @ ${POSES[i].centre.map(round).join(",").padEnd(16)}` +
          ` | on the floor: box ${[...half].map(round).join(",").padEnd(18)}` +
          ` @ ${[...centre].map(round).join(",").padEnd(18)}` +
          ` body ${body.half.map(round).join(",").padEnd(20)}` +
          ` @ ${body.centre.map(round).join(",").padEnd(22)}` +
          ` | foot box ${round(foot)} body ${round(body.min[1])} off ${round(foot - body.min[1])}`,
      );
    }
    expect(POSES.length).toBeGreaterThan(0);
  });

  it("never states a box bigger than the body it wraps", () => {
    // The gap between the two is the hiding mechanic (`players/body.ts`). Its
    // *size* is a judgement and is not asserted here; that it exists at all is
    // not — a box wider than the figure is a pose you cannot hide in, and it
    // would push the player off every wall instead of letting them meet it.
    for (let i = 0; i < POSES.length; i++) {
      // Upright on a wall is the one case where nothing is turned, which is the
      // frame `half` is stated in.
      const body = measure(i, CLING_WALL, true);
      for (const k of [0, 1, 2]) {
        expect(POSES[i].half[k], `${POSES[i].key} axis ${k}`).toBeLessThanOrEqual(
          body.half[k] + 1e-3,
        );
      }
    }
  });

  it("puts an upright pose's box on the body, not beside it", () => {
    // Only the poses that stay on their feet. A pose that lies down sinks into
    // the floor on purpose — that is the same mechanic seen from the side — but
    // one standing up has nothing to sink into, so a box that misses the body
    // is simply a box in the wrong place. `curl` was 0.08 above and 0.19 behind
    // the ball it wraps, because its centre repeated the figure's own offset
    // instead of measuring where that offset had put it.
    for (let i = 0; i < POSES.length; i++) {
      if (POSES[i].flat !== "none") continue;
      const body = measure(i);
      const centre = poseCentre(i, FITTED[1]);
      for (const k of [0, 1, 2]) {
        expect(Math.abs(centre[k] - body.centre[k]), `${POSES[i].key} axis ${k}`).toBeLessThan(0.02);
      }
    }
  });
});
