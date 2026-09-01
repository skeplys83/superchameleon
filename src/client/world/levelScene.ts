import * as THREE from "three";

// Type-only, and `maps.ts` is import-free by design — see invariant 1.
import type { LightOptions } from "@/shared/maps";

/**
 * Turns a loaded level `.glb` into the two things the game wants from it: a
 * visual scene that is never collided with, and a set of colliders that are
 * never drawn.
 *
 * Deliberately **not** a component and deliberately free of React, so it can be
 * run outside a browser — parse a `.glb` with `GLTFLoader.parse` in Node, hand
 * the scene to this, and every claim in `world/CLAUDE.md`'s conventions table
 * is checkable without a canvas.
 */

/**
 * One collision object, reduced to exactly what rapier and the raycaster need
 * for its shape — and nothing more, so a field that is meaningless for a kind
 * cannot be read by mistake.
 *
 * Which shape you get is chosen by the object's prefix in Blender, because the
 * right answer is never derivable from the mesh: a hull around a ring fills its
 * hole in, and a box around a dome is a box.
 *
 * | prefix | collider | for |
 * | --- | --- | --- |
 * | `col_` | cuboid | walls, floors, crates — almost everything |
 * | `colhull_` | convex hull | cylinders, cones, ramps, anything sloped |
 * | `coltri_` | trimesh | only shapes with a **hole** through them |
 * | `colball_` | ball | spheres and domes |®
 *
 * Prefer `col_`. A cuboid is one comparison; a trimesh is the most expensive
 * collider rapier has, and using one where a hull would do is the classic way
 * to make a map that stutters.
 */
export type ColliderKind = "cuboid" | "hull" | "trimesh" | "ball";

/**
 * Where the collider sits. Hulls and trimeshes carry their world transform in
 * their *vertices*, so for those this is the raycast proxy's transform only and
 * the collider itself stays at the origin.
 */
type Placed = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Part of the room's shell — the only thing the follow camera stops on. */
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

// The prefixes are mutually exclusive — `colhull_` does not start with `col_`,
// because the fourth character is `h` rather than `_` — so the order here is
// presentation, not precedence.
const PREFIXES: [string, ColliderKind][] = [
  ["col_", "cuboid"],
  ["colhull_", "hull"],
  ["coltri_", "trimesh"],
  ["colball_", "ball"],
];

/**
 * The room's shell: the floor you stand on, the walls that hold the room in,
 * and the ceiling over it. Matched on the collision object's own name, after
 * its `col*_` prefix.
 *
 * **Only these stop the follow camera.** Everything else a map is furnished
 * with — barrels, tables, crates, the lobby's boulders — is passed straight
 * through, because a camera that backs away from every barrel spends a hunt
 * lurching in and out. `world/CLAUDE.md` has the rule and the one judgement
 * call in it.
 */
const SHELL = /floor|wall|ceiling/i;

/**
 * Whether a lamp has opted into casting, by name.
 *
 * **Both the light's name and its parent's, because only one of them is the one
 * you renamed.** three's `GLTFLoader` names a light object after the glTF *light
 * definition*, which Blender fills from the light's **data-block**, and hangs it
 * as a child of the node — and the node is what carries the **object** name. So
 * renaming a lamp in the outliner, which is the obvious thing to do and what
 * `levels/AUTHORING.md` asks for, produces a node called `shadow_waiting_-3_15`
 * with a light inside it still called `light_waiting.001`.
 *
 * Testing the light alone therefore never fired, silently, for every lamp
 * anybody renamed — no error, no warning, just a map with no shadows in it and
 * nothing to suggest why. Either name counts now.
 */
const CASTS = /^shadow_/;
export const castsShadow = (light: THREE.Object3D) =>
  CASTS.test(light.name) || CASTS.test(light.parent?.name ?? "");

/** Whether a collision object is part of the shell rather than the furniture. */
export const isShellName = (name: string) => SHELL.test(name);

/** Which collider a name asks for, or null if it is not a collision object. */
export function colliderKindOf(name: string): ColliderKind | null {
  for (const [prefix, kind] of PREFIXES) if (name.startsWith(prefix)) return kind;
  return null;
}

export type PreparedLevel = {
  scene: THREE.Object3D;
  colliders: LevelCollider[];
  /**
   * Every lamp in the level, for `ShadowBudget` to move casting between.
   * Collected here because this is the one traverse of the file.
   */
  lamps: THREE.Light[];
  /** Reported by `checkLevel` in development. Nothing decides anything on it. */
  stats: {
    drawn: number;
    instanced: number;
    batches: number;
    lights: number;
    shadowCasters: number;
  };
};

/** Scratch, so preparing a level does not allocate a vector per piece. */
/**
 * The two numbers that decide how a `.blend`'s lighting reads in game. Both are
 * deliberate departures from physical correctness, and the energies in every
 * `.blend` are chosen against them — change either and every map re-lights.
 *
 * `LIGHT_SCALE` brings glTF's photometric units down to the range this game's
 * materials and exposure are built for. **It is not interchangeable with
 * `render.exposure` in `maps.ts`, however much it looks like it.** Exposure
 * multiplies the whole tone-mapped frame; this multiplies *lit surfaces only*.
 * Folding one into the other darkens everything that is tone-mapped but not
 * lit — drei's `Sky` (a `ShaderMaterial`, and `toneMapped` defaults to true)
 * and the shot mark's `emissive` — by a hundred times. A plain background
 * `Color` is safe either way; it goes through `setClear` and is never
 * tone-mapped at all.
 *
 * `LAMP_DECAY` is softer than the physical 2 that glTF mandates and the loader
 * sets. At 2 a lamp reads as a bright ring with a hard edge and a corridor
 * between two of them goes black in the middle; 1.6 reaches further and lets
 * the pools overlap. The map is lit to be *played* in.
 */
const LIGHT_SCALE = 0.01;
const LAMP_DECAY = 1.6;

type PrepareLevelOptions = {
  lights?: LightOptions;
  matte?: boolean;
};

/**
 * Strip every specular response out of a map's materials.
 *
 * **A highlight is a giveaway the paint cannot answer.** A chameleon hides by
 * matching the colour of what it lies against, and a glossy surface does not
 * *have* one colour — it has a sheen that moves with the viewer, so the same
 * body reads as matching from one side of the room and as a silhouette from the
 * other. Rough everything to 1 and the surface's appearance is its albedo,
 * which is the one thing a brush can copy.
 *
 * The maps and the metalness go with it: a `metalnessMap` puts the sheen back
 * per-texel, and glTF's default metallic factor is 1, so a kit that ships an MR
 * texture is trusting that texture completely.
 *
 * **As matte as `MeshStandardMaterial` gets.** A dielectric keeps a fixed 4%
 * Fresnel term that no parameter removes; at roughness 1 it is spread across
 * the whole hemisphere rather than gathered into a highlight. Killing it
 * outright would mean swapping the material type, which costs the normal maps
 * the kit is largely made of.
 *
 * Mutates the materials the loaded glTF owns, rather than cloning: the cache
 * hands the same parsed file to every mount of this map, and the operation is
 * idempotent.
 */
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

/**
 * The exporter is *asked* for `EXT_mesh_gpu_instancing` and does not always
 * give it — the flag is version-dependent and silently does nothing when it
 * declines. So the batching is done here instead, where it depends on nothing
 * but the file having repeated geometry.
 *
 * A level built from a kit is almost entirely repeats: dozens of floor tiles
 * drawn from a handful of meshes. Left as they are exported, that is one draw
 * call per tile.
 */
function batch(scene: THREE.Object3D, drawn: THREE.Mesh[]) {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const mesh of drawn) {
    const material = mesh.material as THREE.Material;
    // `castShadow` is part of the key: an InstancedMesh casts or does not as a
    // whole, so mixing an excluded piece into a batch would put its shadow back.
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
    // Every piece of a level is static, so the matrices are written once.
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    group.forEach((source, i) => {
      mesh.setMatrixAt(i, source.matrixWorld);
      source.removeFromParent();
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Placed at the root with world matrices baked in, so it does not matter
    // what the originals were parented to.
    scene.add(mesh);

    instanced += group.length;
    batches += 1;
  }

  return { instanced, batches };
}

/**
 * The world-space geometry a hull or trimesh collider is built from.
 *
 * **Positions are copied out one vertex at a time rather than handed over as
 * `attributes.position.array`.** That shortcut is only correct while the
 * attribute is tightly packed: an `InterleavedBufferAttribute` shares its buffer
 * with the normals and UVs, so `.array` is *everything*, and rapier reads
 * normals as if they were positions. It cost the old arena every one of its hull and
 * trimesh colliders — a capsule's 1056 vertices arrived as 2112, the ring's 3072
 * as 8192 — and a player embedded in the resulting garbage cannot move at all.
 * Interleaving is a packing choice a glTF is free to make, so the loader must
 * not depend on it either way.
 */
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

  // Decomposed rather than read off the matrix: `setFromRotationMatrix` assumes
  // the upper 3x3 is a pure rotation, and a non-uniformly scaled object's is
  // not. The old arena's ramp was scaled [4.5, 0.5, 9.5] and turned 18.3 degrees, and
  // that shortcut read it as **66.9** — a slab standing on end where a gentle
  // ramp is drawn, which is an invisible wall you cannot see in Blender because
  // Blender is not doing the reading. Only rotated *and* scaled pieces show it.
  mesh.matrixWorld.decompose(SPARE_V, SPARE_Q, SCALE);

  // The collider sits at the bounding box's *centre*, which is not the object's
  // origin — a wall modelled standing up from y = 0 has its origin on the floor.
  const placed: Placed = {
    position: bounds.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
    quaternion: SPARE_Q.clone(),
    shell: isShellName(mesh.name),
  };

  if (kind === "hull") return { ...placed, kind, ...bake(mesh) };

  if (kind === "trimesh") {
    const baked = bake(mesh);
    const index = baked.geometry.index;
    // Rapier wants indices; an unindexed geometry is just 0..n in order. Built
    // here rather than at render, so it is not rebuilt on every re-render.
    const indices = index
      ? Uint32Array.from(index.array)
      : Uint32Array.from({ length: baked.vertices.length / 3 }, (_, i) => i);
    return { ...placed, kind, ...baked, indices };
  }

  if (kind === "ball") {
    mesh.geometry.computeBoundingSphere();
    const scale = Math.max(Math.abs(SCALE.x), Math.abs(SCALE.y), Math.abs(SCALE.z));
    const radius = (mesh.geometry.boundingSphere?.radius ?? 0) * scale;
    // A collider with a zero extent is one rapier will not build.
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
  /** Materials are shared across meshes; each is only worth flattening once. */
  const matted = new Set<string>();
  const sunShadows: THREE.DirectionalLight[] = [];
  const lamps: THREE.Light[] = [];
  let lights = 0;
  let shadowCasters = 0;

  scene.traverse((child) => {
    const light = child as THREE.Light;
    if (light.isLight) {
      lights += 1;
      // A sun is not a lamp: it lights the whole level from one direction and
      // there is nothing to be nearest to.
      if (!(light as THREE.DirectionalLight).isDirectionalLight) lamps.push(light);
      // glTF carries photometric units — lux for a sun, candela for a lamp —
      // so a Blender lamp arrives in the thousands and washes the map out.
      light.intensity *= LIGHT_SCALE * lightScale;

      // `decay` and `distance` exist on both point and spot lights.
      const falloff = light as THREE.PointLight;
      if (falloff.isPointLight || (light as THREE.SpotLight).isSpotLight) {
        falloff.decay = decay;
        if (tuning.distance !== undefined) falloff.distance = tuning.distance;
      }

      // **Every lamp is set up to cast, whether or not it is casting now.**
      // `ShadowBudget` moves the job between them as the camera moves, and a
      // lamp promoted at runtime would otherwise carry three's raw defaults —
      // a 512 map, no bias, and a point light's shadow camera reaching 500
      // units for a light that stops at 26. That is a shadow nobody can see,
      // appearing only in the rooms the budget happened to reach.
      const shadow = (light as THREE.DirectionalLight).shadow;
      if (shadow) {
        // A sun covers the whole level from one map and needs the resolution;
        // a point light's shadow is a *cube*, so three packs six faces into
        // one texture and 2048 would mean 8192x4096. Only the sun is raised.
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
          // A directional light's shadow camera is an orthographic box, and
          // three's default is ±5 units — a tenth of a map, so everything
          // outside the middle simply stops casting. Sized to the level below,
          // once its extent is known.
          if (castsShadow(light)) sunShadows.push(light as THREE.DirectionalLight);
        } else {
          // **A lamp's shadow camera is fitted to how far the lamp reaches.**
          // Point and spot shadows are perspective, and three's default far is
          // 500 — twenty times the end of a hospital lamp, whose `distance` is
          // 26. The depth written into the map is spread over that whole range,
          // so almost all of the precision is spent on space no light arrives
          // at, and `bias` — a fraction of the range, tuned against a sun's
          // fitted camera — comes out a quarter of a metre adrift.
          const cam = shadow.camera as THREE.Camera;
          if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
            const lens = cam as THREE.PerspectiveCamera;
            lens.near = 0.2;
            lens.far = falloff.distance || 30;
            lens.updateProjectionMatrix();
          }
        }
      }

      // Casting itself is still opt-in by name, for maps with no budget set —
      // a budget takes it over from the first frame.
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

    // Decoration. Deliberately *not* named `ROOM_SURFACE`: shots, the ground
    // test and the camera all read the collision layer instead. See invariant 5.
    //
    // A shell piece is excluded from *casting* by name. glTF has no per-object
    // shadow flag, so this cannot come from the file, and a lit map needs it:
    // its walls are 12 tall under a 47-degree sun, which lays an 11-unit band of
    // shadow across a quarter of the floor and shuts the sun out of the room the
    // sky says it is shining into. They still *receive* — see invariant 18.
    mesh.castShadow = !(shadowTuning.exclude ?? []).some((p) => mesh.name.startsWith(p));
    mesh.receiveShadow = true;
    if (options.matte) makeMatte(mesh.material, matted);
    drawn.push(mesh);
  });

  const colliders: LevelCollider[] = [];
  for (const [mesh, kind] of collision) {
    const collider = colliderFrom(mesh, kind);
    if (collider) colliders.push(collider);
    // A collision object is collision *instead of* being drawn — invariant 13.
    mesh.removeFromParent();
  }

  // Now the level's extent is known, so every sun can be given a shadow camera
  // that covers it. Without this only the middle of a map casts at all.
  if (sunShadows.length) {
    // Measured over what actually *casts*, not over the colliders. Decoration
    // can reach past every collider — the old arena's cone and dome sat 36 units
    // out with nothing solid that far — and a shadow camera fitted to the
    // collision layer clips exactly those pieces.
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

      // Acne is a depth error, and its size is set by how far the surface falls
      // across one shadow texel — texel / tan(elevation) — so it explodes as the
      // sun gets low. A constant `bias` cannot track that; `normalBias` offsets
      // along the surface normal in world units and does. Derived from the texel
      // rather than typed, because the frustum above is derived too: a map
      // was striped end to end with a bias 230x smaller than its own error.
      const texel = (camera.right - camera.left) / sun.shadow.mapSize.x;
      sun.shadow.normalBias = shadowTuning.normalBias ?? texel * 3;
    }
  }

  // The ambient terms glTF has no way to express. Added to the prepared scene
  // rather than by a component, so they still belong to the *map* — see
  // invariant 15, which this refines rather than breaks.
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

/**
 * How far the origin is from the farthest corner of a collider — the radius a
 * sun's shadow camera has to cover.
 *
 * **Not `reachOf`**, which is the ground plane only. A sun looks at the level
 * from an angle, so its orthographic box lives in *light* space and has to
 * contain the level's whole 3D extent however the light is turned. A level is
 * 20.5 out and 12 tall: a ground reach of 24.6 left the far corner 6.8 short,
 * and shadows simply stopped along a hard line across the floor.
 */
function radiusOf(collider: LevelCollider) {
  if (collider.kind === "hull" || collider.kind === "trimesh") {
    const bounds = collider.geometry.boundingBox;
    if (!bounds) return 0;
    return Math.max(bounds.min.length(), bounds.max.length());
  }
  if (collider.kind === "ball") return collider.position.length() + collider.radius;

  // The eight real corners, rotated. Adding the half-diagonal to the centre
  // distance is easier and always safe, but it over-reaches badly for a long
  // thin piece — the old arena's walls pushed the span from 32 to 44, and every
  // wasted unit is shadow resolution spent on empty space.
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

/** How far out a collider reaches on the ground plane. */
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

/**
 * Compares a loaded level against the numbers typed beside it in `maps.ts`, and
 * reports what it is made of.
 *
 * There is no build step between Blender and the game, so those numbers can
 * drift from the file the moment you move something. Both ways it drifts are
 * silent and neither looks like a bug from inside the game:
 *
 * - **`bound` too small** and the server clamps players inside a room they can
 *   still walk around in, so everyone else watches them stop dead at an
 *   invisible wall while their own screen shows them walking on.
 * - **`spawn` moved** and a round starts with everybody falling out of the
 *   world, or standing inside the geometry that replaced the floor.
 *
 * Development only, and it warns rather than throws: a level that is wrong is
 * still worth walking around in while you work out why.
 */
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

  // **The whole shadow chain, in one line.** Every part of it is silent when it
  // fails: a lamp nobody renamed, a renderer whose `shadowMap` was switched on
  // for a different map, a level whose furniture is excluded from casting. Each
  // of those looks exactly like the others from the sofa — a room with no
  // shadows in it — so all four are printed together and the broken link is
  // whichever number is zero.
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

  // Every point light that casts is six render passes. Four is already a lot
  // for a browser; past that the frame cost stops being worth the darkness.
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

  // A perimeter wall always reaches past the floor it encloses, by its own
  // thickness — `bound` is the playable interior, not the outside of the shell,
  // so a small overshoot is correct and must not cry wolf. This is here to
  // catch a `bound` that is *badly* stale, which is what happens when a map
  // grows and the number beside it does not.
  const SHELL_SLACK = 1.5;
  if (reach > level.bound + SHELL_SLACK) {
    say(
      `collision reaches ${reach.toFixed(2)} but bound is ${level.bound} — ` +
      `players past ${level.bound} will be clamped. Raise it in maps.ts.`,
    );
  }

  // The `spawn` empty is the author's marker; `maps.ts` has to repeat it
  // because the player is placed before the file has loaded. It survives into
  // the prepared scene because it is an Empty rather than a mesh.
  const marker = scene.getObjectByName("spawn");
  // Absence used to pass in silence, which is the wrong way round: a deleted
  // marker disables the only check on `spawn` drifting, and the game keeps
  // using the number in `maps.ts` so nothing looks wrong until it is.
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
