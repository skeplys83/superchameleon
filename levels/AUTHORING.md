# Building a map

This file sits beside the `.blend` files because it is about **authoring**, not
about the game's code. It is the method: how a level is built, how its collision
is made, and how to prove it is right before anyone plays it.

`src/client/world/CLAUDE.md` is the other half — what the loader *reads*, and the
invariants the runtime depends on. Where this file says "the loader does X", that
doc is the authority.

**Nothing here is specific to a particular map or asset pack.** Where a number
appears it is an illustration from a real level, not a rule.

---

## 1. The pipeline

```
levels/<id>/<id>.blend   the map. The only real source.
      | scripts/export-level.sh <id>      (one `blender --background` call)
      v
public/maps/<id>.glb     the committed artefact. The game loads only this.
      | scripts/optimize-level.mjs        (dedup, in place)
      v
      the browser
```

**One folder per level, named after it**, holding the `.blend` and everything it
references — `textures/`, the raw kit, the bake stamps. That is the only shape
the export looks for, and there are three reasons for it: image paths stay
relative so a level opens on any checkout, `bake-material.py` writes beside the
`.blend` it was given, and one map's assets can never be mistaken for another's.

**Nothing of a level may live under `public/`.** That directory is copied
verbatim into `dist/`, so a `.blend` parked there ships to every player — 140 MB
of it, in the case that prompted this line.

**Kit textures are usually far too big for a browser.** The hospital's arrived as
33 maps at 2K and 4K and exported to a **96 MB** `.glb`, twenty times the whole
dungeon. Resized to 512 and re-encoded as JPEG they came to 0.9 MB on disk and
the map to **4.6 MB**, with no visible difference at play distance. The originals
stay in the folder; the `.blend` points at the small copies. Check an export's
size against the other levels before assuming it is done.

There is **no build step between the two** in the sense that nothing generates
the level. The `.glb` is committed. The exporter is a convenience wrapper so the
export settings live in one place rather than in somebody's memory; exporting by
hand is fine (glTF Binary, +Y up, apply modifiers, include punctual lights, and
limit to visible objects).

**The exporter defends against the three ways an export goes silently wrong:**

- **A hidden collection does not export.** Collision is the collection everyone
  hides, because it sits on top of the map you are trying to look at. A level
  once exported with every collider missing: it loaded, drew perfectly, and
  dropped players through the floor. The exporter therefore un-hides everything
  for the duration and restores it after.
- **The asset palette must *not* export.** It is excluded from the view layer for
  the duration instead, without saving the `.blend`.
- **A piece placed in the map but left in the palette goes out with the palette.**
  Dropping a kit model into the level and forgetting to move it out of `kit` is
  one keystroke, and the map simply comes back without it — that is how the
  hospital's nine door leaves and four doorway walls went missing. The exporter
  measures the footprint of everything it is about to *draw* — colliders
  excluded, since one built on a palette piece and left there would stretch that
  footprint over the palette — and names every kit model standing inside it.
  A warning, not a fix: only the `.blend` can say which collection a piece
  belongs to.

It also refuses to write a file with no collision objects at all, and warns when
a level suddenly exports at more than twice its previous size — which is what a
palette leak looks like from outside.

### Baked procedural surfaces

A material carrying a **`tile_period`** custom property is a baked procedural.
The dungeon's dirt ground is the one that exists.

```
Dirt Ground node group      tuned in Blender, sliders for every layer,
      |                     driven by world position — no tiling, no seams
      |   scripts/export-level.sh ─┐    (bakes, then exports: ~0.8s + ~1.7s)
      v                            |
levels/dungeon/textures/dirt_ground.png    |    committed, rebuilt by every export
      |                            |
      v                            v
public/maps/dungeon.glb                 one joined floor, world-projected UVs
```

**The export bakes.** `export-level.py` calls `bake-material.py`'s `main()` for
every material carrying a `tile_period`, in the same `--background` process that
is already holding the .blend open, so a slider you moved is in the map you
built. It costs about **1 s** of a 2.5 s export — measured, after an earlier
claim that a bake would be "slow and unpredictable" turned out to be worth
nothing. Run `scripts/bake-material.py` by hand only when you want the PNG
refreshed without exporting.

**`world_uv_join` on the material asks for the export-time join.** The dirt
needs it: its tiles are *rotated* 90° to break up the kit's repeating pebble
bumps, and a seamless tile only stays seamless when it repeats by translation,
so the floor is joined into one object and projected in world space. The join is
undone the moment the export finishes. **The projection offsets by `+ 0.5`**,
because the bake plane is centred on the origin and spans −period/2..+period/2 —
without it the map is half a tile out of phase with the viewport you tuned in.

A material *without* the flag keeps whatever UVs its mesh already has, which is
how a procedural could be mapped in object space and stay instanced. Nothing
uses that today.

**The tiling check is a periodicity test, not an edge comparison.** The obvious
check — first row of pixels against the last — cries wolf on anything with hard
edges: masonry puts a mortar joint exactly on the tile boundary, so those two
pixels sit in different courses *by design* and differ wildly while the tile
repeats perfectly. `bake-material.py` bakes two periods into a 256² probe and
compares the halves instead, judged against the pattern's own contrast, since
Cycles jitters its samples and the floor is never exactly zero.

**Why it is built this way.** The kit's dirt tile is one small patch of the
shared atlas repeated under all 110 floor tiles, so the ground read as flat and
a chameleon lying on it was a silhouette. The replacement puts its contrast at
**1-2 m** — the scale a body covers and a brush can match in two or three
strokes — because camouflage here is painted by hand: detail finer than a stroke
cannot be reproduced, and a smooth painted body on a speckled ground stands out
*more*.

**Three rules hold it together:**

1. **The tiles are rotated in 90-degree steps** (hashed from each tile's own
   position, so it never reshuffles) to break up the kit's repeating pebble
   bumps, which marched in step every 4 m.
2. **The node group is periodic by construction** — every noise is sampled on a
   torus, so `Tile Period` metres of it wrap exactly. That is what makes one
   baked square tile with no seam.
3. **The export joins the floor into one object and projects UVs in world
   space.** Both halves matter: a seamless tile only stays seamless when it
   repeats by *translation*, and per-tile UVs plus per-tile rotation means a
   rotated tile meets its neighbour's edge with the wrong one. That shipped
   once, and the seams were visible from across the room.

The join is undone the moment the export finishes, so the `.blend` keeps its
individual tiles. The per-tile UVs they still carry are vestigial — the export
overwrites them — and the *tuning* material ignores UVs entirely.

**Two Blender traps worth knowing before you build a lattice in nodes.** A Math
node's sockets default to **0.5**, not 0 — so `WRAP(value, max)` with the Min
left alone wraps into `[0.5, max)` and quietly breaks periodicity. And `MODULO`
is signed, so a row at −1 offsets the wrong way and a running bond breaks either
side of an object's origin; `WRAP` is what you want.

Move a slider, save, export. **The stale-bake trap is gone by construction**,
since the export bakes — but the check that caught it survives for the
export-by-hand path: the bake writes `dirt_ground.bake.json` beside the PNG, and
the export refuses to write a file whose sliders have moved since, naming the
ones that did. The stamp is on disk rather than on the material because
**writing a custom property does not mark a .blend dirty** — Blender never
offers to save it, so a stamp kept there quietly never arrives, which is how the
check failed the first time it was needed. Beside the PNG it is also committed,
so a fresh checkout is verified too, and it diffs.

Note what the export writes: `levels/dungeon/textures/dirt_ground.png` is a build
artefact of the node graph, so an export leaves it modified in the working tree
whenever the sliders have moved. That is the point — it keeps the committed PNG
and the .blend telling the same story.

### The asset palette

Keep the source kit in its own collection, parked well clear of the map, and
copy from it. Two rules make this work:

- **The palette collection is excluded from the view layer**, so it never
  exports even by accident.
- **Copy with linked duplicates (`alt+D`), never `shift+D`.** Objects sharing
  mesh data are batched into one draw call at load; independent copies cannot
  be. This is invisible in the viewport and is the single most expensive mistake
  available — a level once had 25 copies of one floor tile and went from 15 draw
  calls to 75, and the file doubled.

**A useful invariant: the palette should always contain exactly N objects.** Any
surplus is something you dragged into the map and left behind. That is a reliable
way to find hand-placed work that has not been filed into a proper collection
yet — see §4.

---

## 2. The naming interface

The file is read **by convention**. There is no level editor and no metadata
sidecar; an object's name is the whole interface.

| named | becomes |
| --- | --- |
| `col_*` | a **cuboid** from its bounding box |
| `colhull_*` | a **convex hull** of its vertices |
| `coltri_*` | a **trimesh** |
| `colball_*` | a **ball** from its bounding sphere |
| anything else | decoration — drawn, never collided with |
| a light | a light |
| an Empty named `spawn` | the spawn marker |

**A name is the *only* mechanism.** There was briefly a second one — a
`collider` custom property on a drawn object, which made it collide as itself
while staying drawn — and it is gone. It never suited a furnished map: every
collider also produces an invisible raycast proxy, the proxy for a tagged object
is its **render geometry**, and the runtime raycasts every proxy several times a
frame against a flat, unindexed list. An authored box is 12 triangles where a
tagged prop is several hundred, so the mechanism that read as the convenient one
was the one that could not be used at the scale a map actually has. Author the
collision; it all lives in the `.blend` either way.

**Two directions of failure, both silent.** Give the visual meshes colliders and
you get hundreds of hulls decomposed on every load and a physics step that costs
more than the frame. Name a piece of decoration `col_` and it becomes an
invisible wall that nothing on screen explains.

---

## 3. The shell

### The floor plan is the only thing you author by hand

Everything else — walls, the roof, the shell's collision, the bounds — should be
**derived from the floor tiles**. Read the tile positions, snap them to the grid,
and you have a cell set. Then:

- the roof is that set, plus a one-cell seal ring
- the shell's collision is that set's boundary
- the map's extent, and therefore the clamp bound, is that set's extent

The payoff is that reshaping the map is one operation. The cost is that anything
generated has to be **re-generated** after an edit, and a stale generated layer
looks completely fine until someone walks into it.

**Corollary: keep floor with floor.** If a floor tile ends up filed in a props
collection, every derivation that reads "floor objects in the room collection"
will treat that cell as solid rock, and the roof and collision will have a hole
in them.

### Merge collision runs; do not tile them

The strongest habit in the whole file. One merged slab across a room beats one
box per tile, and it is a win twice over:

- **Frame cost, not load cost.** Each collider is a proxy in the per-frame
  raycast list. Halving the count halves the work every frame, forever.
- **Smoothness.** A seam between two abutting coplanar boxes is a place a
  climbing or sliding probe can catch. One long box has no interior seams.

A real example of the scale: 158 wall pieces merged into 50 runs, and 131 roofed
cells into 16 slabs.

**Use a uniform thickness for a run, whatever the art does.** Decorative wall
variants have different depths; if the collider follows them, a wall that reads
as one flat face becomes a collider that steps in and out along its length, and
anything climbing it snags on something invisible.

**And do not band it vertically either.** The same temptation returns turned on
its side: a plinth at the foot and a cornice at the head are deeper than the wall
between them, so a collider traced onto them becomes a stack of boxes of
different depths. A chameleon climbing that wall meets a ledge at every seam. One
box, floor to ceiling, at the **main wall's** depth — the kit's wall body is
0.5 deep, centred on the tile, and the plinth and cornice simply poke through it.

**Overlap neighbouring slabs slightly** (a few centimetres) rather than abutting
them exactly, so no ray threads the seam.

### Sealing is about sightlines, not walking

An interior map must be sealed against **rays**, which is a much stricter test
than being sealed against a player. Three failures worth knowing:

1. **Kit walls often have no bottom face.** They are modelled to stand on a floor
   that hides it. Any course with open air beneath — a lintel over a doorway —
   shows its hollow underside and you look straight out of the map.
2. **Coffered ceiling tiles have two surfaces.** Ribs at one depth and the
   continuous plane at another. Hang one flush with the wall top and a grazing
   ray threads the gap between the ribs. Choose the height so the *solid* plane
   passes under the wall tops.
3. **Two surfaces meeting exactly on a plane are not a seal.** Run the floor and
   the lid a tile past the walls so they overlap rather than abut.

**The drawn lid and the collision lid are not the same shape.** The drawn one
needs the overlap; the collision one should stop at the floor plan, because the
level's "reach" is measured from colliders and a dilated collider pushes the
map's bound out past its own walls. The walls are what hold players in.

Kit floor and deck tiles frequently have **no underside** either. If a player can
ever be below one — a raised walkway — add a mirrored copy underneath (rotate
180° about X and offset slightly to avoid z-fighting).

---

## 4. Furnishing

### Filing

Put every placed prop in a collection, and give the hand-placed ones their own.
Duplicates from the palette land in the *palette's* collection by default, so
they need moving — see the count invariant in §1.

### The pack's facing convention

Most asset packs orient a prop's "front" along one local axis. Find it once and
write it down, because **getting it 180° wrong is invisible to every automated
check**: the piece is still the right distance from the right wall at the right
height, and only eyes will catch that it is back-to-front.

To find it: look at the local bounding box of a wall-hung asset. If its geometry
sits entirely on one side of the origin along one axis, that axis is the
mounting direction and the origin is the mounting plane.

Given an inward wall normal `n` and a pack whose detail faces local −Y:

```
rotation = atan2(-n.x, n.y) + PI          # -Y points into the room
origin   = wallface + ymax * n            # ymax = max local y
```

The `ymax` term is what makes the piece sit *on* the wall rather than floating or
sinking into it, and it works for both a banner that hangs entirely in front of
the wall and a bracket that pokes slightly through it.

### Keeping the map walkable

**Nothing tall belongs in the middle of a space.** A simple rule that scales:
anything over roughly knee height is placed only within ~1.5–2 units of solid
rock. Every room and corridor then keeps a lane through it for free, and the
result reads as a furnished room rather than an obstacle course.

Two deliberate exceptions are worth allowing:

- **Islands.** A cluster in the middle of a large room with lanes all around it
  is walkable and looks better than a bare centre.
- **Dead ends.** They can be filled solid; there is nothing to walk through to.
  Decide explicitly whether a given dead end is a pocket to hide in or a wall.

### Wall-piece furniture

Partial wall pieces make good corridor furniture, but **only the ones with a
finished cap**. Measure rather than guess: sum the face area at each end of the
piece along its long axis. A flat butt **joint** and a sculpted **cap** are very
different numbers, typically an order of magnitude apart.

**The joint is the larger number**, and the giveaway is that a plain full wall
has one at *both* ends. The joint goes against the wall; the cap points into the
room. Pieces with a joint at both ends cannot jut at all — either way round they
show one.

Stagger them side to side with a minimum separation along the run, so two never
face each other and pinch the corridor.

### Placement hygiene

Whatever generates placements, run these afterwards:

- **Seat everything.** If a prop's world `zmin` is below the floor, raise it. Many
  assets have origins that are not at their base.
- **Keep it under the ceiling.** Scale down anything poking through, keeping its
  base planted. Exempt genuine wall pieces — they are meant to meet the lid.
- **Keep centres on the plan.** Assets with off-centre origins drift into rock;
  nudge them so the bounding-box centre lands where you meant.
- **De-clip.** If two systems draw from the same anchor list (props and wall
  furniture both using wall faces, say) they will place objects inside each
  other. Check every pair and remove or move the losers. This has to be re-run
  after *any* change that moves either set.

---

## 5. Prop collision

### Classify by asset, not by instance

Build a table from asset name to treatment. Instances then inherit it, and
re-generating after a placement change is one pass.

**Author the collider in the prop's own local frame and give it the prop's world
matrix.** You get an oriented shape for free; a world-axis bounding box around a
rotated crate is much too big.

### Convex hulls are the default, not boxes

The instinct when a box is too loose is to reach for a cylinder or a capsule
primitive. Usually the engine does not have one — and it does not need one:

**a convex hull of a low-poly round prop already *is* a rounded cylinder.**

Compute the hull yourself at build time (Blender: `bmesh.ops.convex_hull`) and
store it as its own compact mesh. The result is tighter than a box *and* cheaper
than tagging, because the hull of a low-poly asset is tiny:

| | render mesh | hull |
| --- | --- | --- |
| a banded barrel | 700 verts | 74 |
| a crate | 320 | 24 |
| a sloped wall stub | 460 | **10** (a wedge) |
| a plain column | 92 | 8 |

**Build one hull mesh per asset and share it across every instance.** Hundreds of
hull colliders then cost a couple of dozen meshes in the file and the same number
of shared raycast proxies.

### Cap the hull at the prop's *body*

A decorated prop's bounding box includes whatever is standing on it — a bottle,
candles, a banner. Hull the whole thing and the collider is a box around the
candles.

**Find the body top automatically:** slice the mesh in z, measure each slice's
cross-section, and take the highest slice still above a fraction (~25%) of the
widest. Thin decoration falls away; the body survives. This needs no per-asset
tuning and is stable across a whole pack.

### The shapes that are not hulls

- **Tables are a slab at the top.** A thin box spanning only the vertices at
  tabletop height. Legs and tabletop clutter get nothing, and a prone player can
  hide underneath. Find the tabletop by looking for the highest broad horizontal
  face — in a coherent pack every table will share one height.
- **Beds are a slab to the mattress**, not a box to the pillow. The point is to
  be able to lie on it.
- **Stairs are one box per tread.** See below.
- **Archways are their solid parts only.** A piece that reads as a frame can be
  mostly open at head height; a bounding box turns it into a wall and can cut a
  map in half. **Measure it**: ray a grid over the face at several heights and
  map the solid columns. Then build a box per solid run — typically two uprights
  and a lintel.
- **Decks and platforms are merged slabs**, generated from tile positions.
- **Under about knee height: nothing.** It is stepped over.

### Stairs, and the slope trap

A ramp collider under a flight of stairs is usually **steeper than the
controller's slide threshold**, so the player slides back down something they are
visibly standing on. Two ways out, and the second is better:

1. Raise the slide angle. One constant, but it applies to every surface in every
   map.
2. **Enable autostep and build one box per tread.** The player climbs the real
   steps.

If you take the second, **choose the step height deliberately**. It must clear
the treads you want climbed and stay *below* anything you want jumped — existing
maps may be built on the assumption that a given ledge needs a jump. Autostep has
a large side benefit: every knee-high prop becomes steppable rather than a full
stop, which matters a lot once a map has hundreds of prop colliders.

### Detecting "hung on a wall"

The obvious test — "its base is above the floor" — is wrong on any map with a
**second storey**. A raised deck carries props whose bases are metres up, and the
naive test silently skips every one of them, railings included.

Test for a *band* between the known floor levels instead.

### Generated colliders need re-checking after every generator change

A collider derived from a prop disappears loudly — the prop is still there. A
collider generated from *geometry* (a deck from tile positions, a shell from the
floor plan) has nothing to notice its absence. One was dropped in a refactor and
the walkway stayed drawn while players fell through it.

**After changing the generator, re-run the checks in §6 rather than assuming.**

---

## 6. Verification

None of this needs a browser. The runtime's level reader is deliberately free of
React and takes a plain scene object, so it can be run in Node over the exported
`.glb`. Everything below is worth automating.

### Sightlines — is it sealed?

Fire rays from open space in every direction and count the ones that hit nothing.
Each is a hole.

- **Cull back faces like the renderer does.** Test against the parsed scene with
  a normal raycaster, *not* a modelling-tool BVH — those usually ignore winding
  and report a wall where the only thing in the way is a back face the GPU
  discards. That difference is the whole reason lintel caps exist.
- **Sample origins away from tile edges**, or rays start inside a wall and
  "escape" from solid rock.
- **Report the leakiest origin**, not just the count. It points straight at the
  hole.

A structural cross-check is cheaper and finds the same class of bug: for every
floor cell edge that borders solid rock, assert a wall object exists on that grid
line. That will name the missing piece.

### Walkability — can you get everywhere?

Rasterise the floor plan to a fine grid, mark cells blocked by props, and flood
fill from the spawn. Report the percentage reached and the size and location of
any cut-off pockets.

**Do not use bounding boxes for tall pieces.** An archway is mostly air, and a
bbox test will report a sealed corridor and send you hunting a bug that does not
exist. For anything wall-scale, ask the mesh: sample solid columns along its long
axis at player height and block only those.

Small unreachable pockets behind furniture are fine — they are hiding places.
A large one is a bug.

### The rest

- **Clipping:** no prop's box intersects another's.
- **Seating:** nothing is below the floor.
- **Headroom:** nothing pokes through the ceiling except pieces meant to.
- **On-plan:** every prop's centre is over a real floor cell.
- **Bounds:** the map's collision reach still matches the clamp typed in code.

### Look at it

Automated checks cannot see a prop mounted backwards, a collider that is the
wrong shape, or a room that is simply ugly. **Render from a script**, do not rely
on someone opening the file:

- Drive a temporary camera and render offscreen. Beware: the usual viewport-render
  call defaults to using the *current viewport* rather than your camera — pass the
  flag that turns that off, or you will render whatever the last person was
  looking at and believe it.
- **Render colliders and art from the same camera as two images.** That is the
  only way to judge fit, and it is how a too-loose collider gets caught.
- Hide the palette and the collision layer for art shots.

---

## 7. Budgets

Four numbers to watch, in rough order of how easily they get away from you:

| | what drives it | note |
| --- | --- | --- |
| **draw calls** | *distinct* meshes, after batching | linked duplicates are free; asset *variety* is what costs |
| **raycast proxies** | total collider count | a flat unindexed list, walked several times a frame |
| **file size** | vertex count | one uncompressed `.glb`; serve `public/` compressed before anything else |
| **collider count** | props made solid | merging shell runs is the cheap win |

**Variety is the expensive axis, not quantity.** Hundreds of props cost only as
many draw calls as they have distinct meshes. Cutting the number of *kinds* pays
twice, in draw calls and in bytes.

When file size does become the problem, the order is: serve compressed, then
**mesh quantization** (halves geometry, and three reads it with no decoder at
all), then meshopt. Measure before adopting either — quantization measured 22% on
a real level, which is real but not a rescue.

---

## 8. Traps, in one list

1. `shift+D` instead of `alt+D`. Invisible; multiplies draw calls and file size.
2. A hidden collection silently not exporting.
3. The asset palette leaking into the export.
4. Sealing against walking instead of against rays.
5. Kit walls and floor tiles having no bottom face.
6. Surfaces abutting exactly instead of overlapping.
7. Dilating the *collision* lid along with the drawn one, pushing the map's
   bound past its own walls.
8. Prop mounted 180° out — passes every automated check.
9. Bounding boxes around decorated props, capturing the candles on top.
10. A bounding box around an archway, sealing a corridor.
11. "Above the floor" used as a test for "hung on a wall", on a map with a second
    storey.
12. A ramp under stairs, steeper than the slide threshold.
13. A generated collider dropped by a refactor of the generator.
14. Two placement systems drawing from the same anchors and clipping each other.
15. Floor filed outside the collection the floor plan is derived from.
16. A bbox-based walkability check reporting a false blockage at an open piece.
17. Colliders left in a solid display mode, hiding the map in the viewport.
18. A seamless texture given per-tile UVs on tiles that are rotated — seamless
    only survives repetition by translation.
19. Moving a `Dirt Ground` slider and shipping the previous bake. **The export
    now bakes**, so this cannot happen through the script; exporting by hand
    still can, and the stamp beside the PNG is what refuses it.
20. Keeping any bookkeeping in a custom property and expecting it to persist: a
    property write leaves the .blend *clean*, so nothing prompts you to save it.

---

## 9. Previewing lighting in Blender

Blender can be made to show roughly what the game will, and **none of it
exports** — the `.glb` is byte-identical before and after, so set these freely.
Set them in each `.blend` once.

| | why |
| --- | --- |
| View Transform **AgX**, Look None, Gamma 1 | three's `AgXToneMapping` *is* Blender's AgX. It is the only curve both sides have, which is why the dungeon is on it and the arena is still ACES. |
| Film Exposure **0** (the default) | see below |
| World colour **black** | three has no ambient. A 0.051 grey world lifts every shadow in Blender and nothing in game. |
| EEVEE raytracing / fast GI **off**, or Cycles bounces **0** | three computes direct light only. Bounce light is most of what a Blender render shows and none of what the game does. |

The brightness relationship is not a taste call, it is the unit conversion:

```
game / blender  =  683 × LIGHT_SCALE × exposure × d^(2 − LAMP_DECAY)
```

683 lm/W is the exporter's photometric conversion, `LIGHT_SCALE`, `lights.scale`
and `exposure` are the game's multiplies, and the last term is the falloff we
chose over the physical one. **Solve it for 1 and Blender at its default
exposure of 0 is the preview, with nothing to remember.** At `exposure: 0.8` it
was 8.70×, which is what produced a blown-out room against a Blender scene that
looked right.

The dungeon currently runs `lights.scale: 0.3` with `exposure: 0.5`, which puts
it at **1.63×** — deliberately a little hotter than the viewport, not the exact
1.00 that `scale: 1, exposure: 0.092` gave. Change any of those four numbers and
the ratio moves: either re-solve for 1, or dial `log2(ratio)` into Blender's Film
Exposure and preview against that instead.

**What still will not match**, and cannot without baking:

- **The falloff.** `LAMP_DECAY` is 1.6 and Blender is inverse-square, so one
  exposure can only line them up at one distance. Calibrated at 3.2 m, the game
  runs 0.83× at 2 m and 1.44× at 8 m — the deliberate softness, seen from the
  other side.
- **Bounce light**, if you leave GI on. This is the big one.
- **Shadow softness.** `shadow_soft_size` has no glTF field, so every lamp is an
  ideal point in game however soft it looks here.

