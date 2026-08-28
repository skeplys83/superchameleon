<!-- Archive. The short doc that agents actually read is the CLAUDE.md in
     the folder this describes. Everything here is the long-form reasoning
     behind it: the full invariant list, the tuning, and the debugging
     sessions each rule was paid for with. Kept because it is expensive
     knowledge, demoted because nobody finishes a 500-line file. -->

# paint — drawing on yourself

**Owns:** the per-player canvas, the brush, the palette, the compact wire
format for a stroke, and the panel that mixes colours.

**Entry points:** `getSkin` / `paint` / `clearSkin` / `forgetSkin` /
`forgetAllSkins` / `encodeStroke` / `decodeStroke` / `SELF`
from `skin.ts`; `Brush` / `DEFAULT_BRUSH` from
`brush.ts`; `PaintPanel`.

## Files

- `skin.ts` — one canvas per player id, its pixels, the stroke history and its
  encoding.
- `brush.ts` — `Brush`, `DEFAULT_BRUSH`, `MIN_SIZE`, `MAX_SIZE`.
- `eyedropper.ts` — the pending screen-pixel pick, handed from the click that
  arms it to the frame that reads it.
- `palette.ts` — `PAINT`, the ten presets, and `SWATCHES`.
- `surface.ts` — the model as a paintable surface: triangles indexed by UV and
  by position, which texels the body covers, and `dab`, which paints a sphere
  onto it and pads the result into the gutter.
- `pick.ts` — finding the point on your own body under the cursor. Skins the
  model once and tests rays against that, because three's skinned raycast
  re-skins it per ray — see invariant 14.
- `brushCursor.ts` — the cursor end: pick your own figure, place the hover
  ring, lay strokes down as the mouse drags, and report when a drag starts or
  ends.
- `PaintPanel.tsx` — colour wheel, brightness slider, brush size, clear, pin.

## Invariants

1. **A dab is a sphere on the body, not a circle on the texture.** Painting
   raycasts the cursor against your own figure, and the hit's UV says *where on
   the body* the brush landed; `surface.ts` then paints every texel whose own
   surface point is inside a sphere of the brush's radius around it.

   **Drawing the circle in texture space instead was wrong in two visible ways,
   and both were reported as bugs before this existed.** A dab reaching the edge
   of a UV island spilled onto whatever island was packed beside it — paint
   appearing on a limb you never touched — and the same dab was cut along the
   seam, leaving a torn, notched edge. Neither is tunable: a circle in UV is
   simply not a circle on a body. Measured after the change: over 40 dabs spread
   across the body, the furthest painted texel sits 0.0600 from the centre of a
   0.060 brush and **no texel lands outside it at all**.

   **One canvas per body, and one continuous unwrap.** The body is a single
   skinned mesh wearing a single 1024² texture, unwrapped in Blender. There is
   no per-part anything: a stroke is a point in that unwrap, and `Stroke` is
   `{u, v, size, color}`.
2. **Brush size is an absolute radius in figure-local units** and is compared in
   those units, against distances on the body itself. Nothing converts it into
   texture space any more, so it needs no knowledge of how the model is
   unwrapped and cannot drift when the model is re-unwrapped. It is the same
   physical dot on a forearm as on the head by construction, not by measurement.
3. **Seams stop existing as far as the brush is concerned.** Both sides of a cut
   are painted by the same sphere test, so a stroke crossing one is continuous
   on the body even though it is two disconnected patches in the texture. This
   is the whole reason for painting in 3D rather than in UV.
4. **A dab may not wrap onto a surface facing away from the one it hit.**
   `FACING_MIN` in `surface.ts`: without it, painting between the thighs paints
   the far one too, because a sphere does not care that the body is in the way.
5. **Every dab is padded into the gutter around the islands it touched.** A
   texture is filtered — bilinear, then mipmaps — so at the edge of a UV island
   the GPU mixes painted texels with the empty space beside them, and on a white
   canvas that reads as **a white hairline tracing every seam across the body**.
   `PAD_TEXELS` in `surface.ts` floods the dab's own colour six texels outward
   into anything the model does not cover.

   **The flood starts from this dab's texels, not from a precomputed map.** A
   gutter texel can sit between two islands and can only mirror one of them; a
   one-time map picks a winner in advance, and when the *other* island is the
   one being painted the seam comes back. Measured: a precomputed map left 3.6%
   of island-edge gutter texels bare, and flooding per dab leaves 0.00%.

   **Six texels is not the whole gutter, and the rest is a dilation.** The
   unwrap covers about a quarter of the atlas, so the per-dab flood reaches
   under a tenth of what is off the body; `settleGutter` fills the remainder
   on a debounce by breadth-first search from every covered texel at once,
   giving each gutter texel the colour of the nearest texel on the model. It
   filled that space with a single average of the body until Aug 2026, which is
   correct only for a body painted one shade — black legs plus unpainted white
   arms average to pale grey, and the legs came back wearing a thin light stripe
   along every seam wherever a mip or anisotropy reached past the pad.
6. **The brush edge is sharp.** `FEATHER` is 5% of the radius — about one texel
   at the default size — which exists only so the boundary is not a staircase of
   hard texels. It is not a soft brush and should not become one.
7. **Painting needs no mode, only a free cursor.** Anyone whose pointer is not
   locked — always a chameleon — paints by left-dragging on their own body and turns
   the camera by right-dragging *off* their body — right-dragging *on* it sizes
   the brush instead. Hovering the body pops the panel open on its
   own; it lingers after the cursor leaves so you can reach it, and the header
   pins it.
8. **The pin is how a *hunter* paints.** Pinning releases their pointer lock and
   drops them to third person, so they can see their own figure. `Game.tsx` has
   to know about that, or losing the lock would raise the pause menu instead.
9. **`SELF` is the local player's key in these maps**, remotes use their Colyseus
   session id. **The hunter's first-person arms no longer wear it.** They are
   capsules, and the model's unwrap scatters each limb across several islands,
   so there is no rectangle of the texture that means "forearm" to map them
   into. They are plain white until they are built from the model's own
   geometry — see `combat/CLAUDE.md`, invariant 11.
10. **Paint never survives leaving a room, by any door.** Joining, respawning,
   being carried into a match and being carried home again all arrive unpainted,
   yours and everyone else's: `Game.tsx` calls `forgetAllSkins()` on every join
   *and* from `onLeftRoom`, which `net/` fires at each of the three ways a room
   ends. That also clears the leftover skins of whoever was in the last session,
   keyed by session ids that will never be seen again.

   **The hand-off used to be the exception, and reversing this is a design
   decision rather than a fix.** `encodedHistory` existed solely so
   `net/client.ts` could replay your own strokes into the match, on the reasoning
   that you paint yourself in the waiting room while people arrive and arriving
   stripped makes the waiting room pointless. That reasoning has not stopped
   being true: the arena's nine palette-matched pieces exist so a chameleon can test
   camouflage against an exact match, and that preparation no longer travels with
   them — painting is now a lobby activity that ends at Start. `encodedHistory`
   is deleted rather than left for a second caller to find, so putting it back
   means restoring it plus a replay in `move()` and dropping `forgetAllSkins`
   from the `onLeftRoom` handler.
11. **A drag is throttled by UV distance, not by time.** `PAINT_STEP` in
   `brushCursor.ts` — a smear at 60 fps would otherwise be hundreds of
   near-identical strokes, all of them sent and stored.
12. **A press or a live drag may land slightly off the body.** A limb is a few
    pixels wide at its tip, so a stroke running off the end of an arm used to
    stop dead. `EDGE_RINGS` in `brushCursor.ts` fires rays in rings out to 19 px
    and takes the first hit — up to 25 rays, which is affordable only because of
    invariant 14. **Hovering still casts once**: it is on the mouse-move path,
    and one ray there is the difference between a cursor and a cost.
13. **`createBrushCursor` takes getters, not values.** The figure and the ring
   mount after the handlers are installed, and the brush changes while they are
   live; reading them through getters is what lets the pointer handlers be bound
   exactly once, which is the invariant `Player.tsx` depends on.

14. **Nothing here uses three's raycast against the body, and that is a
    performance rule with a measured number behind it.** `SkinnedMesh.raycast`
    re-skins the model *inside the ray loop* — `applyBoneTransform` on every
    vertex of every triangle it tests, three times per triangle, 28,692 bone
    transforms for this body — and then does it all again for the next ray.
    Measured against `player.glb`: **6.15 ms per ray, hit or miss.**

    That was a third of a frame on every mouse move a chameleon made, painting
    or not — the free cursor means `brushCursor.move` runs on every
    `mousemove` — and the tolerant edge search turned a drag that slipped off a
    limb into **~153 ms**, a freeze rather than a slow frame. It is the whole of
    "painting lags the game".

    `pick.ts` splits the two halves that three fuses: skinning depends on the
    *pose*, not on the ray, so it happens once per `MAX_AGE_MS` (8 ms, one frame
    at 120 Hz) and per *vertex* rather than per triangle corner — 5,745
    transforms instead of 28,692 — and every ray after that is a Möller–Trumbore
    sweep over a flat `Float32Array` behind a posed-bounding-box reject.
    **6.15 ms → 0.098 ms a ray; the 25-ray search 153 ms → 2.4 ms**, with the
    skinning pass itself at 0.08 ms.

    It is verified against three rather than trusted: over a 41×41 grid of rays
    across the body, all 170 shared hits agree to 3.4e-8 in UV and 1.2e-7 in
    world space, with no ray that one finds and the other does not. **Keep that
    check** — it is the only thing standing between a hand-written intersector
    and paint landing a centimetre from the cursor. Front faces only, matching
    the `FrontSide` material, or a cursor over an arm sometimes picks the inside
    of the chest behind it.

    `combat/shoot.ts` still uses three's raycast, deliberately: a shot happens
    twice a second at most, where a mouse move happens sixty times.

## Contracts

- **Reads `figure/model.ts`** for `characterGeometry()`, the bind-space mesh
  every body shares. `parts.ts` is gone: `PARTS`, `PART_SHAPE` and the atlas
  went with the per-part model, and no constant replaced them — the brush works
  in the body's own units now.
- **`surface.ts` is built once, lazily, the first time anybody paints** — 8 ms
  for 9,564 triangles, plus 12 ms on the first dab for the coverage mask the
  padding needs — and is shared by every player's canvas, because it describes
  the model rather than any one body. **Dabs after that are 0.14 ms** at the
  default brush and 0.9 ms at the largest, so the dab has never been the
  expensive half of a stroke; the raycast was (invariant 14).
- **The body mesh is found by `userData.body`**, and the hit's UV is used as-is.
- **Reads `MAX_STROKES` from `shared/protocol.ts`**, the same cap the server
  keeps in schema.
- **`encodeStroke` output must stay under `MAX_STROKE_LENGTH` (40).** It is
  currently ~24 characters: `u,v,size,rrggbb`, each number to three decimals.
  The part index it used to carry went with the per-part model. Adding a field to `Stroke` means checking that budget and updating
  `decodeStroke`, which is the only validation on the way back in.
- `players/Player.tsx` owns the pointer handlers and the 100 ms batch flush, and
  builds the ring mesh at `brush.size × hy`; `brushCursor.ts` owns the raycast,
  where the ring goes and when a stroke happens. It hands each encoded stroke
  back through `onStroke` and never talks to `net/` itself.
- **`onDrawingChange` reports the start and end of a drag, and nothing more.**
  This folder does not import `sound/` — it says a drag began; `players/Player.tsx`
  decides that means a looping brush sound. The callback exists rather than
  leaving the caller to watch `begin`/`end`/`cancel`, because `cancel` is the one
  that gets forgotten and the symptom is a brush still scrubbing behind the pause
  menu.
- `net/` calls `paint`, `clearSkin` and `forgetSkin` for remote players.
- **Nine arena pieces are painted in exact `PAINT` hexes, so a preset is a true
  match for something you can lie against** — camouflage is not testable
  otherwise. Those colours now live in `levels/arena/arena.blend` as one material per
  hex rather than in a table that imported this file, so **nothing enforces the
  match any more**: changing a preset here silently stops it matching the room.
  Never "tidy" a preset without opening the .blend. See `world/CLAUDE.md`,
  invariant 16.

## The one cost left, and why it was not touched

**Every dab re-uploads the whole 1024² texture.** `putImageData` already writes
only the dirty rectangle, but `texture.needsUpdate = true` on a `CanvasTexture`
hands the entire canvas to the GPU — 4 MB, plus regenerating ten mip levels —
for a dab that may have touched a hundred texels. At a drag's throttled rate
that is bounded and it is GPU-side, which is why it was left alone: the CPU cost
above was 60× larger and could be measured here, and this cannot be measured
without a browser.

The lever if it ever matters: three uploads a **`DataTexture`** in pieces —
`texture.addUpdateRange(start, count)`, which `WebGLTextures` turns into
`texSubImage2D` per contiguous row range — and this folder already holds the
pixels as an `ImageData`, so the canvas is not load-bearing. The thing to check
before doing it is mipmaps: a partial upload must not leave the lower levels
stale, or the body goes blurry-wrong at distance rather than obviously broken.

## Not built yet

No undo and no per-part erase — only "clear paint", which wipes the whole body.
No way to paint anyone but yourself, and no persistence between sessions.
