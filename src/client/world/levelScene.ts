import * as THREE from "three";

// Type-only; maps.ts is import-free — see invariant 1.
import type { LightOptions } from "@/shared/maps";

// Turns a loaded .glb into a scene never collided with and colliders never
// drawn. Free of React so it can be run in Node without a canvas.

// Prefix in Blender chooses collider; the right answer is never derivable from
// the mesh (hull around a ring fills its hole).
export type ColliderKind = "cuboid" | "hull" | "trimesh" | "ball";

// Hulls/trimeshes carry their world transform in vertices; the collider itself
// stays at the origin.
type Placed = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  shell: boolean;
};

export type LevelCollider =
  | (Placed & { kind: "cuboid"; half: [number, number, number] })
  | (Placed & { kind: "ball"; radius: number })
  | (Placed & {
    kind: "hull";
    geometry: THREE.BufferGeometry;
    vertices: Float32Array;
  })
  | (Placed & {
    kind: "trimesh";
    geometry: THREE.BufferGeometry;
    vertices: Float32Array;
    indices: Uint32Array;
  });

const PREFIXES: [string, ColliderKind][] = [
  ["col_", "cuboid"],
  ["colhull_", "hull"],
  ["coltri_", "trimesh"],
  ["colball_", "ball"],
];

const SHELL = /floor|wall|ceiling/i;

// Both the light's name and its parent's: GLTFLoader names the light after the
// data-block; the node under it carries the object name. Renaming a lamp
// produces `shadow_waiting_-3_15` around `light_waiting.001`.
const CASTS = /^shadow_/;
export const castsShadow = (light: THREE.Object3D) =>
  CASTS.test(light.name) || CASTS.test(light.parent?.name ?? "");

export const isShellName = (name: string) => SHELL.test(name);

export function colliderKindOf(name: string): ColliderKind | null {
  for (const [prefix, kind] of PREFIXES) if (name.startsWith(prefix)) return kind;
  return null;
}

export type PreparedLevel = {
  scene: THREE.Object3D;
  colliders: LevelCollider[];
  lamps: THREE.Light[];
  stats: {
    drawn: number;
    instanced: number;
    batches: number;
    lights: number;
    shadowCasters: number;
  };
};

// Not interchangeable with render.exposure: exposure multiplies the whole
// tone-mapped frame; this multiplies lit surfaces only. Folding them would
// darken unlit-but-tone-mapped things (Sky, emissive) 100×.
const LIGHT_SCALE = 0.01;
// Softer than the physical 2 glTF mandates — at 2 corridors between two lamps
// go black in the middle.
const LAMP_DECAY = 1.6;

type PrepareLevelOptions = {
  lights?: LightOptions;
  matte?: boolean;
};

// A highlight is a giveaway paint cannot answer — matte everything. Mutates
// materials the cached glTF owns; the operation is idempotent.
function makeMatte(material: THREE.Material | THREE.Material[], seen: Set<string>) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (seen.has(m.uuid)) continue;
    seen.add(m.uuid);
    const std = m as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) continue;
    std.roughness = 1;
    std.metalness = 0;
    std.roughnessMap = null;
    std.metalnessMap = null;
    std.envMap = null;
    std.envMapIntensity = 0;
    const phys = m as THREE.MeshPhysicalMaterial;
    if (phys.isMeshPhysicalMaterial) {
      phys.specularIntensity = 0;
      phys.clearcoat = 0;
      phys.sheen = 0;
      phys.iridescence = 0;
      phys.transmission = 0;
    }
    std.needsUpdate = true;
  }
}

const SCALE = new THREE.Vector3();
const SIZE = new THREE.Vector3();
const SPARE_V = new THREE.Vector3();
const SPARE_Q = new THREE.Quaternion();

// Exporter's EXT_mesh_gpu_instancing is version-dependent and silently no-ops.
function batch(scene: THREE.Object3D, drawn: THREE.Mesh[]) {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const mesh of drawn) {
    const material = mesh.material as THREE.Material;
    // castShadow is part of the key: an InstancedMesh casts as a whole.
    const key = `${mesh.geometry.uuid}|${material.uuid}|${mesh.castShadow}`;
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }

  let instanced = 0;
  let batches = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const [first] = group;
    const mesh = new THREE.InstancedMesh(
      first.geometry,
      first.material as THREE.Material,
      group.length,
    );
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    group.forEach((source, i) => {
      mesh.setMatrixAt(i, source.matrixWorld);
      source.removeFromParent();
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);

    instanced += group.length;
    batches += 1;
  }

  return { instanced, batches };
}

// One vertex at a time — .array is the whole buffer when interleaved, and
// rapier would read normals as positions.
function bake(mesh: THREE.Mesh) {
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();

  const position = geometry.attributes.position;
  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    vertices[i * 3] = position.getX(i);
    vertices[i * 3 + 1] = position.getY(i);
    vertices[i * 3 + 2] = position.getZ(i);
  }
  return { geometry, vertices };
}

function colliderFrom(mesh: THREE.Mesh, kind: ColliderKind): LevelCollider | null {
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  if (!bounds) return null;

  // Decomposed — setFromRotationMatrix assumes a pure rotation, and a
  // non-uniformly scaled object's upper 3x3 is not.
  mesh.matrixWorld.decompose(SPARE_V, SPARE_Q, SCALE);

  // Bounding box's centre, not the object's origin.
  const placed: Placed = {
    position: bounds.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
    quaternion: SPARE_Q.clone(),
    shell: isShellName(mesh.name),
  };

  if (kind === "hull") return { ...placed, kind, ...bake(mesh) };

  if (kind === "trimesh") {
    const baked = bake(mesh);
    const index = baked.geometry.index;
    const indices = index
      ? Uint32Array.from(index.array)
      : Uint32Array.from({ length: baked.vertices.length / 3 }, (_, i) => i);
    return { ...placed, kind, ...baked, indices };
  }

  if (kind === "ball") {
    mesh.geometry.computeBoundingSphere();
    const scale = Math.max(Math.abs(SCALE.x), Math.abs(SCALE.y), Math.abs(SCALE.z));
    const radius = (mesh.geometry.boundingSphere?.radius ?? 0) * scale;
    return { ...placed, kind, radius: Math.max(radius, 0.001) };
  }

  bounds.getSize(SIZE).multiply(SCALE).multiplyScalar(0.5);
  return {
    ...placed,
    kind: "cuboid",
    half: [
      Math.max(Math.abs(SIZE.x), 0.001),
      Math.max(Math.abs(SIZE.y), 0.001),
      Math.max(Math.abs(SIZE.z), 0.001),
    ],
  };
}

export function prepareLevel(
  source: THREE.Object3D,
  options: PrepareLevelOptions = {},
): PreparedLevel {
  const tuning = options.lights ?? {};
  const lightScale = tuning.scale ?? 1;
  const decay = tuning.decay ?? LAMP_DECAY;
  const shadowTuning = tuning.shadow ?? {};
  const scene = source.clone(true);
  scene.updateMatrixWorld(true);

  const collision: [THREE.Mesh, ColliderKind][] = [];
  const drawn: THREE.Mesh[] = [];
  const matted = new Set<string>();
  const sunShadows: THREE.DirectionalLight[] = [];
  const lamps: THREE.Light[] = [];
  let lights = 0;
  let shadowCasters = 0;

  scene.traverse((child) => {
    const light = child as THREE.Light;
    if (light.isLight) {
      lights += 1;
      if (!(light as THREE.DirectionalLight).isDirectionalLight) lamps.push(light);
      // glTF carries photometric units — Blender lamps arrive in the thousands.
      light.intensity *= LIGHT_SCALE * lightScale;

      const falloff = light as THREE.PointLight;
      if (falloff.isPointLight || (light as THREE.SpotLight).isSpotLight) {
        falloff.decay = decay;
        if (tuning.distance !== undefined) falloff.distance = tuning.distance;
      }

      // Every lamp is configured to cast whether it is casting now — a lamp
      // promoted by ShadowBudget would otherwise carry three's raw defaults.
      const shadow = (light as THREE.DirectionalLight).shadow;
      if (shadow) {
        // Point/spot shadows are cubes: 6 faces packed into one texture.
        const size =
          shadowTuning.mapSize ??
          ((light as THREE.DirectionalLight).isDirectionalLight ? 2048 : 1024);
        shadow.mapSize.set(size, size);
        shadow.bias = shadowTuning.bias ?? -0.0005;
        if (shadowTuning.intensity !== undefined) shadow.intensity = shadowTuning.intensity;
        if (shadowTuning.radius !== undefined) shadow.radius = shadowTuning.radius;
        if (shadowTuning.blurSamples !== undefined) {
          shadow.blurSamples = shadowTuning.blurSamples;
        }
        if ((light as THREE.DirectionalLight).isDirectionalLight) {
          // Sized to the level below, once its extent is known.
          if (castsShadow(light)) sunShadows.push(light as THREE.DirectionalLight);
        } else {
          // Fit the lamp's shadow camera to its distance — three's default 500
          // spends most depth precision on space no light reaches.
          const cam = shadow.camera as THREE.Camera;
          if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
            const lens = cam as THREE.PerspectiveCamera;
            lens.near = 0.2;
            lens.far = falloff.distance || 30;
            lens.updateProjectionMatrix();
          }
        }
      }

      if (castsShadow(light)) {
        shadowCasters += 1;
        light.castShadow = true;
      }

      return;
    }

    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const kind = colliderKindOf(mesh.name);
    if (kind) {
      collision.push([mesh, kind]);
      return;
    }

    // Shell exclusion by name — glTF has no per-object shadow flag.
    mesh.castShadow = !(shadowTuning.exclude ?? []).some((p) => mesh.name.startsWith(p));
    mesh.receiveShadow = true;
    if (options.matte) makeMatte(mesh.material, matted);
    drawn.push(mesh);
  });

  const colliders: LevelCollider[] = [];
  for (const [mesh, kind] of collision) {
    const collider = colliderFrom(mesh, kind);
    if (collider) colliders.push(collider);
    // Invariant 13: collision is instead of being drawn.
    mesh.removeFromParent();
  }

  // Fit every sun's shadow camera to what actually casts (not the colliders —
  // decoration reaches past every collider).
  if (sunShadows.length) {
    const bounds = new THREE.Box3();
    for (const mesh of drawn) if (mesh.castShadow) bounds.expandByObject(mesh);

    let radius = 0;
    if (!bounds.isEmpty()) {
      for (const sx of ["min", "max"] as const) {
        for (const sy of ["min", "max"] as const) {
          for (const sz of ["min", "max"] as const) {
            SPARE_V.set(bounds[sx].x, bounds[sy].y, bounds[sz].z);
            radius = Math.max(radius, SPARE_V.length());
          }
        }
      }
    }
    for (const collider of colliders) radius = Math.max(radius, radiusOf(collider));
    const span = Math.max(radius, 1) * 1.05;
    for (const sun of sunShadows) {
      const camera = sun.shadow.camera;
      camera.left = -span;
      camera.right = span;
      camera.top = span;
      camera.bottom = -span;
      camera.near = 0.5;
      camera.far = span * 6;
      camera.updateProjectionMatrix();

      // normalBias tracks the texel: acne size is texel / tan(elevation).
      const texel = (camera.right - camera.left) / sun.shadow.mapSize.x;
      sun.shadow.normalBias = shadowTuning.normalBias ?? texel * 3;
    }
  }

  // Ambient terms glTF cannot express — added to the scene so they still belong
  // to the map (invariant 15).
  if (tuning.ambient) {
    const { color = "#ffffff", intensity } = tuning.ambient;
    scene.add(new THREE.AmbientLight(new THREE.Color(color), intensity));
    lights += 1;
  }
  if (tuning.hemisphere) {
    const { sky = "#ffffff", ground = "#404040", intensity } = tuning.hemisphere;
    scene.add(
      new THREE.HemisphereLight(new THREE.Color(sky), new THREE.Color(ground), intensity),
    );
    lights += 1;
  }

  const { instanced, batches } = batch(scene, drawn);

  return {
    scene,
    colliders,
    lamps,
    stats: { drawn: drawn.length, instanced, batches, lights, shadowCasters },
  };
}

// The 3D radius a sun's shadow camera has to cover — not just the ground reach.
function radiusOf(collider: LevelCollider) {
  if (collider.kind === "hull" || collider.kind === "trimesh") {
    const bounds = collider.geometry.boundingBox;
    if (!bounds) return 0;
    return Math.max(bounds.min.length(), bounds.max.length());
  }
  if (collider.kind === "ball") return collider.position.length() + collider.radius;

  const [hx, hy, hz] = collider.half;
  let farthest = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        SPARE_V.set(sx * hx, sy * hy, sz * hz)
          .applyQuaternion(collider.quaternion)
          .add(collider.position);
        farthest = Math.max(farthest, SPARE_V.length());
      }
    }
  }
  return farthest;
}

function reachOf(collider: LevelCollider) {
  if (collider.kind === "hull" || collider.kind === "trimesh") {
    const bounds = collider.geometry.boundingBox;
    if (!bounds) return 0;
    return Math.max(
      Math.abs(bounds.min.x),
      Math.abs(bounds.max.x),
      Math.abs(bounds.min.z),
      Math.abs(bounds.max.z),
    );
  }
  const { x, z } = collider.position;
  const [ex, ez] =
    collider.kind === "ball"
      ? [collider.radius, collider.radius]
      : [collider.half[0], collider.half[2]];
  return Math.max(Math.abs(x) + ex, Math.abs(z) + ez);
}

// Warns on drift between maps.ts and the .blend — the only cost of having no
// build step. Dev only.
export function checkLevel(
  level: { id: string; bound: number; spawn: [number, number, number] },
  prepared: PreparedLevel,
) {
  const { colliders, scene, stats } = prepared;
  const say = (message: string) => console.warn(`level "${level.id}": ${message}`);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  console.info(
    `level "${level.id}": ${stats.drawn} meshes → ` +
    `${stats.drawn - stats.instanced + stats.batches} draw calls, ` +
    `${plural(colliders.length, "collider")}, ` +
    `${plural(stats.lights, "light")} (${stats.shadowCasters} casting shadows)`,
  );

  // Every link in the shadow chain, so the broken one is whichever number is 0.
  {
    let casting = 0;
    let receiving = 0;
    const casters: string[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
        if (mesh.castShadow) casting += 1;
        if (mesh.receiveShadow) receiving += 1;
      }
      const light = o as THREE.Light;
      if (light.isLight && light.castShadow) {
        const at = light.getWorldPosition(new THREE.Vector3());
        casters.push(
          `${light.parent?.name || light.name} (${light.type}, ` +
          `${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)})`,
        );
      }
    });
    console.info(
      `level "${level.id}": shadows — ${casters.length} casting lights, ` +
      `${casting} meshes cast, ${receiving} receive` +
      (casters.length ? `\n  casters: ${casters.join("; ")}` : ""),
    );
  }

  // Each point light costs 6 render passes.
  if (stats.shadowCasters > 4) {
    say(`${stats.shadowCasters} lights cast shadows — drop the shadow_ prefix on some`);
  }
  if (!stats.lights) {
    say("no lights in the file — the map will be black. The game adds none.");
  }

  if (!colliders.length) {
    say("no collision objects — nothing to stand on. Is anything named col_*?");
    return;
  }

  let reach = 0;
  for (const collider of colliders) reach = Math.max(reach, reachOf(collider));

  // Perimeter walls always overshoot bound by their thickness.
  const SHELL_SLACK = 1.5;
  if (reach > level.bound + SHELL_SLACK) {
    say(
      `collision reaches ${reach.toFixed(2)} but bound is ${level.bound} — ` +
      `players past ${level.bound} will be clamped. Raise it in maps.ts.`,
    );
  }

  const marker = scene.getObjectByName("spawn");
  if (!marker) {
    say("no `spawn` empty in the file — nothing is checking maps.ts's spawn any more");
  }
  if (marker) {
    const at = new THREE.Vector3().setFromMatrixPosition(marker.matrixWorld);
    if (at.distanceTo(SPARE_V.set(...level.spawn)) > 0.05) {
      say(
        `the spawn empty is at [${at.toArray().map((n) => n.toFixed(2))}] ` +
        `but maps.ts says [${level.spawn.join(", ")}]`,
      );
    }
  }
}
