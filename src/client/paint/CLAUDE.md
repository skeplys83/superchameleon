# paint — camouflage, and the brush that puts it on

**Owns:** the per-player canvases, the brush, the palette, the eyedropper, and
the panel they are driven from.

## What's here

| file              | what                                                       |
| ----------------- | ----------------------------------------------------------- |
| `skin.ts`         | one canvas per player, and the stroke encoding on the wire  |
| `surface.ts`      | where a dab lands on the texture, and the seam handling     |
| `brushCursor.ts`  | the drag: hit-testing the body, the ring, the stroke stream |
| `brush.ts` `palette.ts` `pick.ts` `eyedropper.ts` | size, the recent-colour history, hit-testing, screen sampling |
| `pickPreview.ts`  | the two things that ride the cursor: the swatch, and the hint |
| `PaintPanel.tsx`  | the palette UI                                              |

## The four rules that will bite you

1. **A dab is a sphere on the body, not a circle on the texture.** It is applied
   in 3D and projected, so it wraps a limb the way paint would. Brush size is an
   absolute radius in figure-local units, which is why it looks the same on an
   arm and on a torso.
2. **Every dab is padded into the gutter around the islands it touched**, and
   seams stop existing as far as the brush is concerned. Skip either and a
   stroke across a seam shows a hairline of bare texture at every mip level.
3. **A drag is spaced by the brush, and the gap between mouse events is filled
   in.** Two separate reasons a fast smear used to come out as dots:

   - The spacing was a flat `0.012` in UV. A dab's radius in UV is about half
     the brush size, so at `MIN_SIZE` (0.015) it was 0.0075 — **smaller than
     the step**, and the smallest brush laid down dabs that did not touch even
     at a crawl. The step is now `0.2 × size`.
   - One mouse move is one dab, and a flick produces few moves. The skipped
     segment is now walked and a dab laid at each step, **by re-casting the ray
     at points along it** rather than by interpolating UV — the unwrap has
     seams, and a straight line across one runs through unrelated parts of the
     atlas. Every filled dab is a real hit with its own UV.

   Filling costs strokes: a fast drag now sends up to `MAX_FILL` (16) times as
   many. `MAX_STROKES` on the server is 800 per player and drops the oldest, so
   a heavy painter reaches that sooner — only late joiners see the difference,
   since the local canvas is never replayed.
4. **Paint never survives leaving a room, by any door.** Joining, respawning and
   being carried to a match all clear it; `net/` re-sends yours on arrival,
   which is what makes painting yourself in a lobby worth doing. The strokes are
   *state* on the server, not a broadcast, so a late joiner is handed everyone's.

## The eyedropper picks albedo, not the pixel

**Paint is albedo.** A skin is a `map` on a `MeshStandardMaterial`, so whatever
the picker returns is lit and tone-mapped like every other surface. Returning
the *drawn pixel* therefore applies the room's lighting twice: pick a floor
rendering at 40% brightness, paint it on, and the body renders at 16%. That was
"I picked the ground and it came out way darker", and it got worse the darker
the map — obvious in the dungeon, barely visible in the arena.

Albedo against albedo is also just what camouflage is. Two surfaces with the
same base colour under the same light render the same colour.

So `albedo.ts` raycasts the drawn geometry on the click itself and returns
`material.color` times the texel under the hit UV. Both maps make that exact:
the arena's twelve materials are untextured and **named for their own hex**
(11 of 12 round-trip to their own name through the linear→sRGB conversion; the
twelfth is just called "Material"), and the dungeon is a 1024² atlas plus the
baked `dirt_ground`, both with a white base factor, so the picked colour is the
texel itself. Neither has vertex colours. It needs no frame at all — the
ray is cast in the pointer handler.

**Skinned meshes are excluded on purpose.** `SkinnedMesh.raycast` costs ~6 ms a
ray (see `pick.ts`), so with several players on screen one click would drop a
frame. The cost is that you cannot pick another player's paint; scenery is the
point.

### The framebuffer read is still there, for two things

When the ray hits nothing solid — sky, background — `eyedropper.ts` reads the
drawn pixel at frame priority 3 instead, which for something unlit is right.

**The cursor swatch reads it too, and always.** That is not a fallback but the
answer to a different question: the click asks what the brush should hold, the
swatch asks what the player is looking at.

**The trap there is that `FrameLimiter` does not draw every frame.** It caps at
60 fps by skipping `gl.render` outright, so on a 120 Hz display half of all
frames draw nothing, and a read on one of those returns zeroes — `#000000`. A
pick is therefore only *taken* on a frame that drew, and stays pending
otherwise. **Anything else that takes over `gl.render` must call `markDrawn`.**

## What makes everyone's copy of a body identical

Paint is replicated as **strokes, not pixels** — a list of
`u,v,size,color` replayed on every client. Three things have to hold for that
to land on the same image everywhere, and two of them already did:

- **The rasteriser is deterministic.** A dab is raw arithmetic into an
  `ImageData`, never a canvas-2D `arc()` or `fill()`, so no browser's
  antialiasing gets a vote. Same canvas size (1024², fixed), same model, same
  floats, same pixels.
- **Order is preserved.** One sender, one socket.
- **The numbers have to be the same numbers.** `encodeStroke` rounds to three
  decimals — half a texel — and the painter used to apply the *unrounded* hit
  locally while sending the rounded one. Your own body was the one copy nobody
  else could see. Dabs are now painted from the decoded wire form, so every
  canvas is fed byte-identical input.

**The hole that is left is `MAX_STROKES`.** The server keeps the last 800 per
player and drops the oldest, and a client re-sends its whole history on entering
a room. Anyone watching live sees every stroke; anyone who *replays* the list —
a late joiner, and **the hunter arriving from the lobby is always one** — sees
the last 800. Past that they get a body missing its earliest strokes, which
shows as bare white where the first pass went.

How much 800 buys, at the current spacing:

| brush | step | travel that fits |
| ----- | ---- | ---------------- |
| min (0.015) | 0.0030 UV | ~2 UV units |
| default (0.06) | 0.0120 UV | ~10 UV units |
| max (0.5) | 0.1000 UV | ~80 UV units |

So a thorough job with a small brush overruns it. Two ways out, in order of
what they buy: make a stroke a **segment** (`u0,v0 → u1,v1`, rasterised as a
capsule) so one mouse move is one stroke instead of up to sixteen — smoother
*and* five to sixteen times cheaper — or simply raise `MAX_STROKES`, which is
one number and grows the schema.

## Contracts

- **The eyedropper is armed with `F` as well as with the button**, and the key
  is `Game.tsx`'s — the click it waits for lands in the world, so reaching back
  to the panel to arm it means looking away from the surface you wanted. The
  arming is *derived*, not stored: `picking` is the armed flag **and** the
  palette still being on screen, so pausing, dying or the reveal disarms it
  rather than leaving a pick to swallow the next click.
- **The row under the wheel is a history, not a palette.** The ten fixed
  presets are gone: a preset is a guess at what somebody wants, and a chameleon
  is matching a wall, so the colour they mixed two walls ago is worth more than
  "rose". A colour enters it when a **stroke begins** with it — recorded from
  `players/usePointerControls`, because recording where a colour is *chosen*
  would fill the row with every shade the cursor crossed on the wheel. It is in
  memory, client-side, never sent, and outlives a room on purpose.
- **The wheel is drawn at the brightness the slider is on**, and redrawn when it
  moves. It used to be drawn once at full value so that it stayed a map you
  could learn; the colour being mixed is the one about to be painted, and a
  wheel glowing at full brightness while the brush was dark showed every colour
  except that one. The fill is numeric — `hsvChannel`, not the hex form — since
  a redraw is 43 000 pixels and a string per pixel made that a frame of
  allocations.
- **`pick`, `white` and `clear` are one row of three equal buttons.** They are
  three choices of the same weight, and scattering them — pick full width, the
  other two tucked beside the size readout — made one look like a heading and
  two like footnotes. **They still do different kinds of thing**: `white`
  reloads the brush, `clear` wipes the body and paint has no undo, so the
  labels stay distinct even though the buttons match.
- **The ring is lifted along the line of sight, never along the normal.** A
  normal offset is invisible on a face turned toward you and slides the ring off
  the cursor on one turned away — which is every limb where it rounds off. Moving
  toward the eye keeps the centre on the cursor's own ray whatever the surface is
  doing; the normal still decides which way the ring *faces*. It draws with
  `depthTest: false`, so the lift was never holding off z-fighting.
- **`MIN_SIZE` is a texel floor, not a taste.** At 0.008 a dab is about four
  texels of the 1024² skin across its radius, and `MIN_STEP` in `brushCursor.ts`
  still sits under that radius so the finest line is continuous. Below it a dab
  starts disappearing between texels rather than getting thinner — the lever for
  finer than this is `TEXTURE_SIZE`, at four times the canvas per player.
- **The brush ring is where the eyedropper is advertised.** Hovering your own
  body is the moment somebody is thinking about colour, so the ring appearing
  brings "F to pick a colour" with it, and the label goes the instant the pick
  is armed. It is the only place the key is named outside the panel and the
  controls legend.
- **The click takes albedo; the cursor swatch shows the drawn pixel.** They are
  different questions and the answers differ by exactly the room's lighting.
  Showing the brush's own value in the circle was wrong on screen — a grey
  stone under the dungeon's torches is brown, and a grey circle held against
  brown ground reads as a broken picker. The swatch is what you are looking at
  *and* what the body will look like once that albedo is lit by the same room.
  It is plain DOM updated imperatively, fed by a **standing** watch in
  `eyedropper.ts` that `useEyedropperReadback` answers on every drawn frame —
  standing rather than per-move because the world moves under a still cursor.
- **`SELF` is the local player's key**; remotes use their Colyseus session id.
- **Painting needs no mode, only a free cursor** — anyone not holding the pointer
  lock can paint, which is why a hunter has to open the palette to do it.
- **`createBrushCursor` takes getters, not values.** The figure and the ring are
  rebuilt under it; captured references go stale mid-drag.
- **Reads real limb sizes from `figure/parts.ts`**; `figure/` reads the canvases
  back. Known, acyclic.
- **Padding the gutter is two jobs, and `PAD_TEXELS` only does the first.** The
  flood out of each dab covers bilinear and a mip level or two, which is what
  keeps a white hairline off the seams. It cannot reach the depth a *hunter*
  samples: at `HUNT_DPR` the figure is about sixty pixels tall against a 1024
  atlas, so the GPU reads mip four, where one texel averages sixteen by sixteen
  and the white gutter is most of what is in it — a body painted black came back
  ringed in white speckle, the one artefact a blur cannot destroy. `settleGutter`
  fills everything past the pad with the average of what is on the body, so the
  deep mips fade a figure into itself. **It walks the whole atlas**, so `skin.ts`
  runs it debounced after the brush stops rather than per dab, and nothing
  depends on it having run.
- **`MAX_STROKES`, `MAX_STROKE_LENGTH` and `MAX_STROKE_BATCH` are in
  `shared/protocol.ts`** — the server clamps against the same numbers.

---

Fourteen invariants, the projection maths, and the one remaining cost:
[docs/notes/paint.md](../../../docs/notes/paint.md).
