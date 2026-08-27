# world — the map, and what you can stand on

**Owns:** loading a `.glb` into a playable room, the collision layer, and the
lighting that comes with the file.

**The map *data* is not here.** `shared/maps.ts` and `shared/mapIds.ts` hold the
registry — ids, spawn, bound, `roundSeconds`, render config — because the server
reads them too. This folder is the three.js half.

## What's here

| file             | what                                                        |
| ---------------- | ------------------------------------------------------------ |
| `Room.tsx`       | picks the map, suspends while it loads, adds the old lights  |
| `GltfLevel.tsx`  | the loaded scene, its colliders, and its own lighting rig    |
| `levelScene.ts`  | `prepareLevel` / `checkLevel`: what is read out of the file  |
| `surface.ts`     | `ROOM_SURFACE`, and the revision counter that says it changed |
| `preload.ts`     | fetching a map before anybody needs it                       |

## A map is one `.glb`, and this repo has no part in making one

`levels/<id>/<id>.blend` is the map, `public/maps/<id>.glb` is its export, and the row
in `shared/maps.ts` is a name plus the few numbers the game needs before the file
has loaded. **There is no build step and no generated file.** The naming
conventions the loader reads — `col_*`, `colhull_*`, `coltri_*`, `colball_*` for
collision, everything else decoration — and the full Blender workflow are in
[levels/AUTHORING.md](../../../levels/AUTHORING.md).

## The three rules that will bite you

1. **The prefix chooses the collider, and the wrong one does not error.** A hull
   where a trimesh was meant is a solid lump you cannot walk into; a trimesh
   where a box was meant is hollow. Nothing warns — you find it by walking.
2. **A map must suspend exactly once, before any collider exists.** `Room`'s
   `Suspense` is what `hud/LoadingScreen` covers; a second suspension mid-round
   tears down colliders the player is standing on. Anything that changes the set
   of surfaces must call `bumpSurfaces`, or `Player.tsx` keeps raycasting a
   stale list and the player stands on a map that is no longer there.
3. **A map is lit by its own file and the game adds no light at all.** Lights
   added here apply to *every* map and wash out the one that was lit
   deliberately. `Room.tsx` renders the old ambient-plus-sun pair only for maps
   built from primitives.

## Contracts

- **`spawn` and `bound` are typed by hand** in `shared/maps.ts`; `checkLevel`
  warns in the console when they stop matching the file. That is the whole cost
  of having no build step.
- **Nothing drawn is collided with and nothing collided with is drawn.**
- **`ROOM_SURFACE` is the collision layer's name** and goes on nothing else —
  `players/`, `combat/` and `paint/` all raycast by it. Each proxy also carries
  `userData.shell`.
- **`shell` is floor, walls and ceiling, matched on the collision object's own
  name** (`/floor|wall|ceiling/i`, in `levelScene.ts`). Shots and the ground
  test use the whole layer; **only the follow camera reads `shell`**, because a
  camera that backed away from every barrel and table spent a hunt lurching in
  and out, and in a furnished map that is most of what is behind you. The
  dungeon has 345 collision objects and 104 of them are shell.

  The rule is a regex over names a `.blend` chooses, so nothing in the build can
  catch it drifting — a re-export that renames `col_ceiling` breaks the camera
  silently, in one map only. `world/test/shell.test.ts` pins it against names
  sampled from both files. **The judgement call is `col_ring_deck`**: it is
  walkable but not named like shell, so a player standing on it can drop the
  lens through it. Add `deck` to the pattern if that reads worse.
- **`matte` in a map's render config flattens every material it loads** — rough
  1, no metalness, and the MR maps dropped with them, because glTF's default
  metallic factor is 1 and a kit that ships an MR texture is trusting it
  completely. A glossy surface has no one colour for a chameleon to match, so
  this is a hiding rule before it is a look. It mutates the materials the cached
  glTF owns rather than cloning: every mount of a map wants the same answer, and
  the operation is idempotent.
- **Developer mode draws it green** (`DEV` in `app/dev.ts`, plus `<Physics
  debug>` in `Scene.tsx`), which is exactly what you want while hunting for a
  hole in a map and exactly what you do not want the rest of the time.

---

The loader's full contract, the lighting and shadow tuning, the instancing, and
twenty-five invariants: [docs/notes/world.md](../../../docs/notes/world.md).
