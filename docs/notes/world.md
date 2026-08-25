<!-- Archive. The short doc that agents actually read is the CLAUDE.md in
     the folder this describes. Everything here is the long-form reasoning
     behind it: the full invariant list, the tuning, and the debugging
     sessions each rule was paid for with. Kept because it is expensive
     knowledge, demoted because nobody finishes a 500-line file. -->

# world — the maps

**Owns:** every map the game can load, the registry that picks one, and the
`ROOM_SURFACE` name that shots and the camera filter on.

**Entry points:** `Room`, `ROOM_SURFACE`, `ROOM_HALF`.

## Files

- `maps.ts` — `GameMap` and the registry: every map's id, file, spawn, bound,
  round length and presentation, plus `MATCH_MAP_LIST` and `mapName`. Data only
  — no React, no three.js, because the **server** imports it.
- `mapIds.ts` — the ids alone, **import-free on purpose**. Also `LOBBY_MAP` and
  `MATCH_MAP_IDS`, which the server validates against.
- `surface.ts` — `ROOM_SURFACE` and the surface revision counter, alone for the
  same reason. **Import-free**, which is why the collision-drawing switch is no
  longer here — see "Seeing the collision" below.
- `Room.tsx` — renders whichever map the room is playing, sets the background
  and the sky, and raises the loading flag while the file arrives. It preloads
  **nothing**; see `preload.ts`.
- `preload.ts` — `preloadMap(id)`, the one way a map's file is fetched ahead of
  being stood on. Called by `Game.tsx`, not from here.
- `levelScene.ts` — all of the *reading* of a level `.glb`: the split into a
  visual half and a collision half, the shadow setup on the file's lights, the
  instancing, and `checkLevel`. **No React**, so it runs in Node — see
  "Checking a level without a browser".
- `GltfLevel.tsx` — the mounting for the above: the colliders, the raycast
  proxies, and the map's ambient light. Thin on purpose.

## A map is one `.glb`, exported from Blender

There is one kind of map and one way to make one. `levels/<id>/<id>.blend` is the
map, `public/maps/<id>.glb` is its export, and the row in `maps.ts` is a display
name and the handful of numbers the game needs before the file has loaded.

**Nothing in this repo reads or generates a `.blend`** — the Blender side is a
separate workflow that happens to drop a file into `public/maps/`, and the cost
is that `spawn` and `bound` are typed by hand and can drift from the file, which
is what `checkLevel` is for.

**The `.glb` side is one step, and it is `export-level.sh`.** Blender writes the
file and then `scripts/optimize-level.mjs` runs `dedup` over it in place, merging
mesh data the exporter emitted more than once. That is not a build step in the
sense this doc used to deny — nothing generates the *level*, and the `.glb` is
still the committed artefact — but it is a pass over the export, and it earns its
place: `batch()` groups by geometry identity, so a piece copied with `shift+D`
instead of `alt+D` is its own draw call. Dedup makes that mistake stop mattering
(invariant 14). It paid for itself immediately — **the arena went 30 draw calls
to 15** on files nobody thought were duplicated, because Blender writes identical
geometry more than once on its own.

It refuses to write if node, collider or light counts move: dedup merges *data*
and must never change what the level is made of.

**It also changes how attributes are *packed*, and that broke the arena once.**
Merging accessors lets glTF share one buffer view between positions, normals and
UVs, and three then loads them as an `InterleavedBufferAttribute`. `bake()` used
to hand rapier `attributes.position.array`, which for an interleaved attribute is
*the whole buffer* — so a hull was built from normals and UVs as if they were
vertices. A capsule's 1056 vertices arrived as 2112, the ring's 3072 as 8192, and
a player embedded in the resulting garbage **could not move at all while looking
around still worked.** Only the arena has hull, ball and trimesh colliders; the
dungeon is all `col_` cuboids, which are built from the bounding box and never
touch the array, which is why the lobby broke and the match map did not. `bake()`
now copies positions out one vertex at a time. Interleaving is a packing choice
any glTF may make, so nothing downstream may assume it either way.

**The registry is readable by Node, and the server reads it.** `server/room.ts`
imports `mapRoundSeconds` and `server/messages.ts` imports `mapLimit`. That works
because `maps.ts` and `mapIds.ts` import nothing but each other and
`shared/protocol.ts`, **and because they use relative `.ts` paths rather than
the `@/` alias**, which only the bundler resolves. Both halves are required: an
`@/` import here fails at server startup, not at build. **Importing a component
or three.js into `maps.ts` closes the door entirely** — which is why
`levelScene.ts` is a separate file even though it is pure logic.

## What the loader reads out of a `.glb`

The file is read **by convention**. There is no level editor and no metadata
sidecar; an object's name is the whole interface.

| named | becomes |
| --- | --- |
| `col_*` | a **cuboid** collider from its bounding box |
| `colhull_*` | a **convex hull** of its real vertices |
| `coltri_*` | a **trimesh**. Only for shapes with a hole through them |
| `colball_*` | a **ball** from its bounding sphere |
| anything else | decoration. Drawn and shadowed, and **never collided with** |
| a light | a light, with shadows switched on at load |
| an Empty named `spawn` | the author's marker for the spawn point |

**A name is the only mechanism, and `userData` is read for nothing.** There was
briefly a second way in — a `collider` custom property on a drawn object, riding
glTF `extras`, which made the piece collide as itself and stay drawn. It is
gone, along with `export_extras` in `scripts/export-level.py`. It was never
usable at the scale a furnished map has: a tagged piece's raycast proxy is its
*render* geometry, several hundred triangles against 12 for an authored box, in
a list `players/Player.tsx` walks several times a frame (invariant 25). All
collision is authored in Blender as `col*_` objects.

Everything else about the map — round length, background, sky, and the `bound`
the server clamps to — is typed in `maps.ts`. **Lighting is not on that list and
never should be**: see invariant 15.

> **How to actually build one is not in this file.**
> [`levels/AUTHORING.md`](../../../levels/AUTHORING.md) is the authoring guide —
> the export pipeline, the asset palette, deriving a shell from its floor plan,
> placing props, generating their collision, and the checks that prove a level is
> sealed and walkable. This doc stays on what the *code* guarantees.

`scripts/export-level.sh` and `scripts/export-level.py` are the only two files
that know how a `.blend` becomes a `.glb`, and nothing under `src/` reads either.
The game only ever loads whatever `.glb` is sitting in `public/maps/`.

### The render config

`maps.ts` carries no comments — it is a table, and this is the key to it. Every
field is optional; each falls back to a global constant in `levelScene.ts` or to
a value derived from the level.

| `render.*` | what it does |
| --- | --- |
| `toneMapping` | one of three's seven. **`AgXToneMapping` is the only one Blender also has**, so it is the only one that can ever show the same picture — the dungeon is on it, the arena is still ACES |
| `exposure` | `gl.toneMappingExposure`. Scales the **whole tone-mapped frame**, not just lit surfaces — see invariant 23 |
| `outputColorSpace`, `antialias`, `dpr` | straight onto the canvas |
| `shadows.enabled` / `.type` | the only two the *renderer* takes. Resolution and bias belong to the light — invariant 21. **Use `PCFShadowMap`**: three deprecated `PCFSoftShadowMap` and silently swaps it for `PCFShadowMap` anyway, warning once per compile. Asking for it bought nothing and cost `shadow.radius`, which PCF honours and PCFSoft ignores — so the softness knob was unreachable for as long as we asked for the deprecated one |
| `fog` | `THREE.Fog`, or null |

| `render.lights.*` | what it does |
| --- | --- |
| `scale` | multiplies every light in the file, on top of `LIGHT_SCALE`. The dungeon runs **0.05**, half what it first shipped with — the lamps read as lamps rather than as floodlights, and the dark between them is the point |
| `decay` | falloff exponent for point and spot. Overrides `LAMP_DECAY` |
| `distance` | cut-off radius, 0 = infinite. three uses **Frostbite windowing**, so a 16 unit cut-off is a 0.3% dim at 3.2 units and exactly zero at 16 — it costs almost nothing near the lamp and ends the far tail |
| `shadow.intensity` | how *dark* a shadow is, 0..1, independent of the light's brightness. The arena runs 0.75, because full-strength shadows in a white room read as holes |
| `shadow.radius` | how soft the edge is. Works under `PCF` and `VSM`, and is **ignored under `PCFSoftShadowMap`** — but see below, nothing uses that any more |
| `shadow.blurSamples` | `VSMShadowMap` only |
| `shadow.bias` / `.normalBias` / `.mapSize` | overrides for the derived defaults. Leave them alone unless you have measured something |
| `ambient` / `hemisphere` | the terms glTF cannot carry, built by `prepareLevel` from this entry — invariant 15 |

**Nothing that does not do something goes in this table.** three's
`scene.environmentIntensity` and `backgroundIntensity` are deliberately absent:
the first needs an environment map, which neither map has and trap 3 rules out
fetching, and the second scales a background *texture* where both maps use a
plain `Color`. Adding either would recreate the dead-config trap of invariant 21.

Two `GameMap` fields are worth naming because nothing in the file says so:
`roundSeconds` on the **arena is unused** — it is the waiting room, never a match
map — and `spawn` is the body's *centre*, which is why it is `[0, 2, 0]` and not
on the floor.

### Checking a level without a browser

`levelScene.ts` is free of React and takes a plain `THREE.Object3D`, so the
*actual* runtime reading of a level runs in Node over the exported `.glb`:
parse it with `GLTFLoader.parse`, hand `gltf.scene` to `prepareLevel`, and every
claim in the table above is measurable. `checkLevel` can be called the same way.
Three DOM globals have to be stubbed for the texture decode (`self`,
`URL.createObjectURL`, `createImageBitmap`); the texture failing to load is
expected and affects none of the above.

**The checks worth running, and how to run them, are in
[`levels/AUTHORING.md`](../../../levels/AUTHORING.md) §6** — sightlines,
walkability, clipping, headroom. That file is the authoring half of this one.

## Seeing the collision

**Developer mode draws it** — `DEV` in `src/client/app/dev.ts`, which is
`import.meta.env.DEV` and therefore true under `npm run dev` and compiled to
`false` by `vite build`. It is on by default there and switched by the DEV chip
in the HUD or by backquote; `GltfLevel` subscribes **once** and passes `show`
down to every proxy, because a furnished map has hundreds of them and they all
appear and disappear together. It used to be `SHOW_COLLISION`, a constant in
`surface.ts` that had to be flipped by hand and, inevitably, was committed as
`true`. It could not stay there once it was tied to the environment: this file
is import-free by invariant 1, and `import.meta.env` is a bundler substitution
that Node has no answer for.

**It is one flag feeding two different pictures on purpose**:

- **`GltfLevel`'s proxies**, as green wireframes. That is the `ROOM_SURFACE`
  layer — what a shot, the ground test, the climb probes and the camera pull-in
  actually hit.
- **`<Physics debug>`** in `Scene.tsx`, which is rapier's own outline of every
  collider, the player's box included.

They are two lists built from the same map and **a piece that appears in one and
not the other is exactly the bug this is for**: a collider with no proxy is a
wall you can shoot and see through, a proxy with no collider is a surface you
walk into and fall past. Invariant 13 is the other half of it — anything drawn
in green here that also has a visible mesh under it means a piece of decoration
got named `col_`.

Flipping it recompiles the proxy material, so it is a switch you throw while
looking at something rather than something to bind to a held key.

## Adding a map

Add the id to `mapIds.ts`, export a `.glb` to `public/maps/`, and add a row to
`maps.ts`. Nothing else: the menu and the lobby panel both list `MATCH_MAP_LIST`,
the server validates a chosen id against `MATCH_MAP_IDS`, `Room` renders it, and
its file is preloaded. `maps.ts` throws at import time if the two files disagree,
so a half-added map fails the build instead of showing an empty menu entry or
silently refusing a legitimate choice.

## Downloading a map is demand-driven, and triggered from outside this folder

`Room.tsx` used to loop over `MAPS` at import time and preload every model in
the game. Because `Game.tsx` imports `Scene` statically, that ran on **page
load**: everybody who opened the start menu pulled the whole dungeon down,
whether they ever played it or not.

It is now `preloadMap(id)` in `preload.ts`, called from `Game.tsx` at two
moments and no others:

1. **On arriving in a lobby**, keyed on `nextMap`, so it re-fires when the host
   changes their pick. This is the one that matters — the whole
   gathering-and-painting wait is free budget.
2. **When the countdown starts**, as a backstop. A no-op for anybody the first
   trigger already covered, since drei's cache is keyed by URL. It is there for a
   host who changed the map moments before pressing Start.

**Do not put a preload back at module scope.** An import-time side effect cannot
be told which map anybody wants, and it is invisible at the call site.

**Neither trigger is a guarantee, and a player who misses is covered twice:**

- **The body is held.** `players/Player.tsx`'s frame loop zeroes `vy` and returns
  for as long as its `ROOM_SURFACE` list is empty, so nobody falls through where
  the floor will be — invariant 14 in `players/CLAUDE.md`.
- **The screen is covered.** `Room`'s `Suspense` fallback calls `beginLoading`
  from `src/client/app/loading.ts`, which puts `hud/LoadingScreen` up until the map
  commits.

Neither is sufficient alone: the hold without the screen is a frozen player
staring at nothing, and the screen without the hold is a spinner over a body
falling out of the world. The boundary is deliberately the signal rather than a
fetch counter — it wraps exactly the map *this room is playing*, so the next map
downloading in the background cannot raise it.

## Invariants

1. **`mapIds.ts` and `surface.ts` must stay import-free**, and `maps.ts` must
   import only those and `shared/protocol.ts`. The server reads
   the registry, and the server is plain Node. Adding a React or three.js import
   anywhere in that set breaks `npm run dev` at startup, not at build — which is
   the loud, early failure this arrangement is designed for.
2. **A map id is a wire value.** It is chosen in the menu, stored in room state
   and read by every client. Add ids freely; rename one and you break anybody
   mid-session, the same as renaming a message.
3. **The map is fixed for a room's life.** Swapping geometry under players
   standing on it has no sane outcome, and a map chosen per client would put
   people inside walls their opponents cannot see. A lobby is *always* the
   arena; the map a host picks is `nextMap`, which the match is created with.
   Changing the map is therefore always changing rooms.
4. **The arena is `LOBBY_MAP`, not a choice.** It is where every game waits —
   playable on purpose, so you can walk about and paint while people arrive — and
   it is absent from `MATCH_MAP_IDS`, refused by `onCreate` and `setMap`, and
   missing from both pickers. Offering it would mean pressing Start and arriving
   where you already were.
5. **`ROOM_SURFACE` goes on the collision layer and on nothing else.** That name
   is what `players/Player.tsx` filters on for the shot raycast, the ground test
   and the camera pull-in, so a raycast reads the same simple boxes physics does
   rather than a torch's forty triangles. Two consequences while building a
   level: decoration cannot be shot, stood on or clung to, and a piece of cover
   with no collision object is cover you walk straight through.
6. **The prefix chooses the collider, and the wrong one does not error.** A hull
   around the arena's ring fills in the hole you run through; a box around its
   dome is a box; a cuboid around a rotated ramp is right only because the
   rotation is kept on the collider. None of these fail loudly — they just make a
   shape behave like a different shape.
7. **Everything tall has a way up.** Jump apex is `JUMP_SPEED²/2g` ≈ 4.1 units (10²/24), so
   no step in the arena is more than ~2: the ziggurat is three 1-unit tiers, the
   divider is a lip then a wall, the stairs rise 0.9 each onto a catwalk that
   dead-ends at the slab, and the big drum has a smaller drum beside it as its
   step. The cone, the capsule and the crystal are the deliberate exceptions.
8. **A map must suspend exactly once, before any collider exists.** `Room`'s
   `Mounted` calls `useGLTF(map.src)` once, above `GltfLevel`. React discards a
   suspended tree, so a component that suspended *below* a mounted collider would
   have that collider torn down and rebuilt — and rapier does not survive that:
   it panics with `unreachable` and every later call throws `recursive use of an
   object`, killing physics for the session.
9. **Anything that changes the set of surfaces must call `bumpSurfaces`.**
   `players/Player.tsx` collects `ROOM_SURFACE` meshes and reuses the list for
   the shot raycast, the climb probes and the camera. It used to collect them
   once on mount, which broke the moment maps started loading from files: the
   player mounted first, found nothing, and kept an empty list forever — no
   walls, no climbing, no shots, which reads exactly like "the controls are
   broken". `Room` bumps the counter when a map mounts and again when it
   unmounts. **Standing up is not on this list**: the character controller finds
   the floor through rapier's own colliders, so an empty surface list costs you
   shooting, climbing and the camera but still leaves you able to walk around.
10. **The loaded scene is cloned before it is touched.** `prepareLevel` does the
    clone, in a `useMemo` — before render, so the `ROOM_SURFACE` proxies exist by
    the time `players/Player.tsx` collects them. drei caches the parsed glTF by
    URL and hands the *same* object out to every caller, so mutating it directly
    would leak shadow flags and removed colliders into the next room that loads
    the same file.
11. **Levels are committed as one uncompressed `.glb` each, and furnishing the
    dungeon has put that under real pressure for the first time.** It was 784 KB
    on disk and 213 KB gzipped while it was an empty shell; with 464 props it is
    **3.1 MB on disk and ~995 KB gzipped**, which is now larger than the music.
    Geometry was the whole file — 175 distinct meshes against a kit atlas that
    compresses to 17 KB. **That is no longer quite true**: the dirt ground is a
    baked procedural now, ~300 KB of PNG, and its world-projected UVs cost a
    joined 22 k-vert mesh where 110 instanced tiles cost nothing. KTX2 is still
    overhead at this size. **Serving
    `public/` compressed is still the cheapest win** and costs nothing.

    The two levers, measured rather than guessed: **quantization**
    (`KHR_mesh_quantization`, which three reads with **no decoder at all**) took
    it from 947 KB to 742 KB gz when measured — a real 22% but not a rescue;
    **fewer distinct prop meshes** is the bigger one, because those meshes are also
    103 draw calls, so cutting variety pays twice — ~820 props cost only that many
    because every one is a linked duplicate. Meshopt (29 KB decoder, in
    `three/examples/jsm/libs/`) is the step after that. **Draco is the one to
    skip**, but not for the reason first written here: its decoder *can* be
    self-hosted — the files are in `three/examples/jsm/libs/draco/` and trap 3
    only forbids drei's default CDN path. The reason is arithmetic. That decoder
    is a 285 KB wasm plus a 59 KB wrapper against what gzip already achieves.
12. **`spawn` and `bound` are typed by hand and `checkLevel` is the only thing
    stopping them rotting.** There is no build step, so nothing *makes* them
    agree with the `.glb`. Both ways they drift are silent: a stale `bound` has
    `server/messages.ts` clamping players inside a room they can still walk
    around in, so everyone else watches them stop dead at an invisible wall while
    their own screen shows them walking on; a stale `spawn` starts the round with
    everybody falling out of the world. `checkLevel` compares both against the
    file at load, in development only, and warns rather than throws. It tolerates
    1.5 units of overshoot on `bound` because a perimeter wall always reaches
    past the floor it encloses by its own thickness.
13. **Nothing drawn is collided with and nothing collided with is drawn.** The
    two halves are split on the name prefix in `levelScene.ts`, and the split is
    the whole reason this format was worth moving to. Both directions fail
    quietly. Give the visual meshes colliders and you are back to a body per
    piece with hulls generated off render geometry — hundreds of them, decomposed
    on every map load, and the physics step starts costing more than the frame.
    Name a piece of decoration `col_` and it becomes an invisible wall that
    nothing on screen explains.
14. **Repeated geometry is instanced at load, not by the exporter.** Blender is
    *asked* for `EXT_mesh_gpu_instancing` and does not always give it — the flag
    is version-dependent and silently does nothing when it declines, which is
    exactly what happened on the dungeon's first export. Batching by
    geometry-and-material at load depends on nothing but the file having repeats,
    and on the dungeon it turns 690 meshes into 15 draw calls. This is also why a
    repeated piece must be a **linked duplicate**.

    **`shift+D` instead of `alt+D` is the single most expensive mistake you can
    make in a level**, and it is invisible in Blender — the viewport looks
    identical. `batch()` groups on `geometry.uuid`, so every real copy becomes
    its own draw call. Editing the dungeon by hand once left 25 copies of
    `floor_dirt_large`, 22 of `floor_tile_large` and 11 of `wall`: **15 draw
    calls became 75 and the file went 824 KB → 1,596 KB.** The repair is
    `Ctrl+L` → Link Object Data (or relink to one datablock per identical
    geometry headlessly), and the tell is `j.meshes.length` in the `.glb`
    climbing without the map growing.
15. **A map is lit by its own file, and the game adds no light at all.** Every
    lamp in the game is an object in a `.blend`. There were two rounds of this:
    an `ambientLight` at 1.2 plus an overhead sun in `Scene.tsx` that applied to
    every map, and then a smaller per-map `ambientLight` in `GltfLevel`. Both are
    gone. They flatten an interior — a dungeon lit by a global ambient has no
    darkness in it to hide in, which for this game is the gameplay rather than
    the mood, and it makes what you see in Blender a poor guide to what you get.

    **Blender's World colour is not part of what exports**, and there is nowhere
    for it to go: `KHR_lights_punctual` has point, spot and directional and no
    concept of ambient. So a scene lit in Blender partly by its world background
    arrives darker than it looked. The fix is a light *object* in the `.blend`,
    not a knob here — a weak sun, or several opposed ones, is what a world colour
    was standing in for. **Not an area light**: `KHR_lights_punctual` has only
    point, spot and directional, so Blender drops an AREA lamp on export
    *silently* — four lamps in, three out, no warning. This doc used to
    recommend one.

    **What crosses and what does not.** POINT → `THREE.PointLight`, SUN →
    `DirectionalLight`, SPOT → `SpotLight` (`angle` from `outerConeAngle`,
    `penumbra` from the inner/outer ratio). Colour and intensity cross;
    **softness does not** — `shadow_soft_size` and a sun's `angle` have nowhere
    to go, so every light arrives as an ideal point. **Blender's Shadow checkbox
    does not cross either**: casting is decided here, by the `shadow_` name
    prefix. And unless you tick Custom Distance, no `range` is written, so three
    gets `distance = 0` — the light never cuts off, which is fine for falloff
    but does nothing for cost (see invariant 22). **Both maps now do exactly that**: the arena has a key
    sun plus three opposed fill suns, the dungeon has its lamps plus one weak
    sun straight down. `Room.tsx` adds nothing for any map, which is the first
    time that has been true.

    **The one refinement: `render.lights.ambient` and `.hemisphere`.** glTF
    genuinely cannot carry an ambient term, so those two are built by
    `prepareLevel` from the map's own registry entry. That is still "the map
    decides" — what invariant 15 forbids is a light hardcoded in a *component*,
    applying to every map at once, which is what `Scene.tsx` and then `Room.tsx`
    used to do. `hemisphere` is the better of the two: one light slot, and a
    sky/ground gradient rather than a flat wash that removes every bit of the
    darkness a chameleon hides in.

    **Light through walls is a shadow, and nothing else.** A light with no
    shadow map lights every surface in range, whatever is between them —
    colliders and `ROOM_SURFACE` are invisible to the renderer, so there is no
    way to "block" a light with the level. The levers, cheapest first:
    `lights.distance` (a cut-off radius — ignores walls but stops a lamp
    reaching the far side of the map), a `shadow_` prefix on a **spot** or
    **sun** (one extra pass), a `shadow_` prefix on a **point** (six — a cube),
    and finally baking, which encodes occlusion at zero runtime cost. Culling
    lights per frame works too, but note that `numPointLights` is part of three's
    shader program key, so changing how many are *visible* recompiles — cached
    per count, so warm it up rather than toggling every frame.

    **Blender energy is not three intensity, and the conversion differs by light
    type.** The exporter writes a sun as lux (`energy × 683`) and a point as
    candela (`energy × 683/4π`), and then `prepareLevel` scales everything by
    0.01. So `three = energy × 6.83` for a sun and `energy × 0.5435` for a
    point — a factor of 4π apart. Mixing them up is a 100× error that looks
    plausible in Blender's own viewport, because Blender renders the watts.
    Sane targets: a key sun around 3, fills under 1, and a room lamp in the
    **tens** — irradiance is `I/d²`, so a lamp 3 units up wants ~70, not 7000.
16. **Nine arena pieces are in exact `PAINT` hexes.** Same values the swatch row
    renders. Pick the matching swatch, paint yourself, and you can test camouflage
    against a true match instead of eyeballing it. They are now materials in
    `levels/arena/arena.blend`, one per colour, written as linear from the sRGB hex so
    the export round-trips. Do not "tidy" an arena colour to something
    off-palette, and do not let Blender's colour picker talk you into a near miss.
17. **Every collider in both maps has a visible counterpart, and nothing is
    collision-only.** The arena used to carry `col_ceiling`, an invisible lid
    that stopped a jump leaving the room and gave chameleons something to cling
    to upside down. It is gone: an invisible surface is a surface players learn
    by walking into it. Nothing is lost by removing it — the arena's walls are
    12 tall against a jump apex of ~3 — except the upside-down ceiling cling,
    which was never discoverable anyway. **The check is name pairing**: strip the
    `col*_` prefix and an object of that name must exist in the visual half.

    `sky` is a boolean rather than an asset because the sky is a *shader* —
    drei's `Sky`, Preetham scattering with no texture behind it. `<Environment>`
    is the one that fetches an HDR from a CDN and blanks the scene on a network
    with no internet; see trap 3.
21. **Everything about a shadow is derived from the level, and none of it is
    configurable per map.** `maps.ts` carries only `shadows.enabled` and
    `shadows.type`, because those are the two the *renderer* takes; it used to
    also carry `bias`, `normalBias` and `mapSize` that **nothing read**, which is
    how the arena came to be striped end to end with acne while an authored
    `normalBias: 0.02` sat in the registry doing nothing. Three things follow,
    all of them in `prepareLevel`:
    - **A sun's shadow camera is sized to the level's *radius*, not its ground
      reach.** three's `DirectionalLightShadow` defaults to an orthographic box
      of ±5 units — a tenth of the arena — so everything outside the middle
      silently stops casting. That is why the sizing happens *after* the
      traverse, once the extent is known. It uses `radiusOf`, which includes
      height and rotates the real corners: the box lives in *light* space, so a
      sun at an angle needs the full 3D extent, and the arena's 12-tall walls
      put its far corner 6.8 units outside a ground-plane fit — shadows stopped
      dead along a line across the floor. Fitting the true corners rather than
      the half-diagonal keeps the span at 33 instead of 44, and every wasted
      unit is resolution spent on empty space.
    - **`normalBias` is computed from the texel, not typed.** Acne is a depth
      error whose size is `texel / tan(elevation)`, so it grows without limit as
      the sun drops. A constant `bias` cannot track that. At 23° elevation the
      arena's error was 0.116 against a bias of 0.0005 — 230× short.
    - **Only a sun gets a 2048 map.** A point light's shadow is a *cube*, and
      three packs six faces into one texture, so 2048 there means 8192×4096.
22. **Every light in the file is paid for on every pixel, every frame.** three's
    renderer is *forward*: it gathers all scene lights into uniform arrays and
    every material's fragment shader loops over all of them, with no per-object
    culling. So 25 lamps means 25 PBR evaluations per pixel across the whole
    screen, and a light's `range` does not help — `distance` changes the falloff
    curve, not whether the light is in the shader. **A shadow-casting light
    costs geometry passes on top**, and a *point* light's shadow is a cube:
    **six full passes of the map per frame**, which is why the dungeon's hall
    lamp does not cast. A spot costs one pass, a sun one. Nothing in the dungeon
    casts today, so nothing there — including a player — has a shadow; that is a
    known trade, not an oversight. Baking is the way to have many lights without
    paying for them, and the blocker is that a lightmap needs a unique UV per
    instance while batching needs shared geometry.
23. **Lamps do not fall off physically, and the two halves are tuned together.**
    `LAMP_DECAY` in `levelScene.ts` is 1.6 rather than the `1/d²` glTF mandates,
    because a physically correct lamp reads as a bright ring with a hard edge and
    a corridor between two of them goes black in the middle. The energies in each
    `.blend` are chosen against that number, so changing one without the other
    re-lights every map.

    **`LIGHT_SCALE` beside it is not the same knob as `render.exposure`**, even
    though both are a multiply and folding one into the other looks like a free
    simplification. Exposure scales the whole tone-mapped frame; `LIGHT_SCALE`
    scales *lit surfaces only*. Everything tone-mapped but unlit comes apart if
    you merge them — drei's `Sky` is a `ShaderMaterial` and `toneMapped` defaults
    to true, so the arena's sky would go 100× darker, and the shot mark's
    `emissive` with it. A plain background `Color` is the exception: it goes
    through `setClear` and is never tone-mapped.
24. **`SUN` in `Room.tsx` and the arena's key light are one thing in two
    files.** The sky is a backdrop that casts nothing; the light in
    `arena.blend` is what makes shadows. Move one without the other and the
    room is lit from somewhere the sky says the sun is not. Keep it **high** —
    a low sun rakes long hard shadows over everything and drives the acne term
    above.
18. **The arena's shell does not cast shadows, and that is not a perf tweak.**
    Its light is overhead, so a ceiling that cast would drop a shadow across the
    entire room and every interior would go black.
19. **An interior map has to be sealed against *sightlines*, not against
    walking.** The dungeon's collision was airtight while three separate visual
    holes remained, and each one is a different lesson worth keeping:
    - **A kit wall has no bottom face.** It is modelled to stand on a floor that
      hides it. Any course with open air beneath — the lintel over each hallway
      mouth — shows its hollow underside and you look straight out of the map.
      Those eight lintels are capped with a scaled `ceiling_tile`.
    - **`ceiling_tile` is coffered**: ribs at local −0.25 but the continuous
      surface at −0.05. Hang it flush with a 4.0 wall top and the *solid* plane
      sits at 4.15, leaving a 0.15 band a grazing ray threads between the ribs.
      `CEIL_Z` is chosen so the solid plane passes under the wall tops.
    - **Two surfaces meeting exactly on a plane are not a seal.** The floor and
      the lid both run a tile past the walkable area and past the grid, so they
      overlap the walls instead of abutting them.
25. **A furnished map's collision is *generated*, and that has runtime
    consequences this folder owns.** The shell's colliders are derived from the
    floor plan and merged into runs; each prop's is derived from its asset name,
    as an oriented box, a computed convex hull, or a slab. The rules for choosing
    and the failures behind each one are in
    [`levels/AUTHORING.md`](../../../levels/AUTHORING.md) §3 and §5 — they are
    authoring decisions, not runtime ones.

    **What matters here is the count.** Every collider is also a `ROOM_SURFACE`
    proxy in the flat, unindexed list `players/Player.tsx` raycasts several times
    a frame. Furnishing the dungeon took that list from 68 to 334. Two things
    keep it affordable and both are easy to undo by accident:

    - **Every collider is authored as a `col*_` object**, so every proxy is a
      simple shape. This is why the `collider` custom property was removed
      rather than kept for convenience: a tagged prop's proxy is its render
      geometry — several hundred triangles against 12 for a box — so tagging
      ~800 props would put ~800 render meshes in the raycast list.
    - **Hulls are computed compactly and shared per asset.** A barrel's 700
      vertices become a 74-vertex hull, and one hull mesh serves every instance.

    If movement ever feels heavy, this list is the first number to look at.

20. **Whether a wall piece is see-through is measured, not read off its name.**
    Ray a grid across each piece's face and count the misses. It overturns the
    names in both directions: `wall_doorway` is **solid** (the door is shut) and
    `wall_arched` is a **blind niche**, while `wall_sloped` and
    `wall_half_endcap` are wide open. The dungeon's ten variants are the ten
    that measured 0.00%.

## Contracts

- **Reads `ROOM_HALF` and `ROOM_LIMIT` from `shared/protocol.ts`.** The arena's
  `bound` is `ROOM_HALF`, and the gap between the two (20 vs 19.9) is the slack
  every map gets through `mapLimit` — deliberate rather than a rounding slip, see
  `shared/CLAUDE.md`.
- **`server/messages.ts` clamps to `mapLimit(room.state.map)`** and
  **`server/room.ts` reads `mapRoundSeconds`**, so the registry is read on every
  `state` and every `kill`.
- **`Room` owns the background and the sky**, which `Scene.tsx` used to. Both are
  facts about the map.
- `players/Player.tsx` collects `ROOM_SURFACE` meshes from the scene graph
  whenever `surfaceRevision()` moves, which `Room` bumps on mount and unmount.
- `combat/Graves.tsx` deliberately does **not** use that name — a grave is paint
  on the floor and must not stop a bullet or the camera.
- **Nothing here reads `paint/palette.ts` any more.** The arena's palette colours
  live in its `.blend` as materials; the swatches are still `PAINT`, and the two
  are kept in step by hand — see invariant 16.

## Not built yet

**The dungeon is furnished and solid.** ~820 props in a `props` collection with
one child per themed section, and 334 colliders — the shell's, merged from the
floor plan, plus one per prop that needs one. What is where, and how any of it
was placed, is a property of the `.blend` rather than of this folder; the method
is in [`levels/AUTHORING.md`](../../../levels/AUTHORING.md).

**No dimension of the layout is written down here on purpose**: the shape is
edited in Blender and everything else is regenerated from the floor tiles, so a
number in this doc would be the one part that rots.


**No baked lighting.** A level's lights are punctual and real-time, and for
geometry this static the obvious next step is a Blender lightmap bake into a
second UV set, fed to three as `lightMap`. Nothing here is built for it:
`prepareLevel` would need to find the second UV set.

**No mesh compression and no chunking.** Meshopt is the compression to reach for
(invariant 11), and batching is the only draw-call work there is — a level big
enough to need per-room frustum culling would want chunk conventions to merge
within.

**No collision beyond the four primitives.** No capsule, no heightfield, no
compound shapes — and no cylinder, which is the one that gets asked for. A
computed convex hull covers that case exactly (see `levels/AUTHORING.md` §5);
what is genuinely missing is a *concave* shape short of a trimesh.

The arena's layout is fixed — no variants and no randomisation. There is exactly
*one* spawn point per map and everybody uses it, so a full lobby arrives in a
match stacked on the same square — and since players have no colliders against
each other, they simply overlap until they walk apart.
