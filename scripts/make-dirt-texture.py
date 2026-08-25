"""
The dungeon's dirt ground, generated rather than painted.

    blender levels/dungeon/dungeon.blend --background --python scripts/make-dirt-texture.py

or, with the file already open, run it from Blender's text editor (or through the
MCP server) — it updates the `dirt_ground` image datablock in place and rewrites
`levels/dungeon/textures/dirt_ground.png`, so the viewport shows the new one immediately.

**Why a script and not a shader node graph.** glTF cannot carry procedural
nodes, so anything built out of Noise and Voronoi has to be baked before it can
reach the game — which means a bake pass between every tweak and every export,
and a texture whose recipe lives in a node graph nobody can diff. This writes
the pixels directly: the knobs below are the recipe, the PNG is the output, and
both are in the repo.

**What it is for.** The kit's dirt tile is one 91x198 patch of the shared atlas,
repeated under all 110 floor tiles, and its variation is a soft gradient — so
the floor reads as flat and a chameleon lying on it is a silhouette. This
replaces it on the floor tiles only, with tonal patches at the scale a body
covers.

**The scale rule that decides every number here.** Camouflage is painted by hand
with a brush, so detail finer than a brush stroke cannot be matched — it only
breaks up an outline, and a smooth painted body on a speckled ground can stand
out *more*. So the contrast lives at 1-2 m (paintable in two or three strokes
with the eyedropper) and everything finer is kept quiet.

The texture is seamless: every lattice lookup wraps, and the pebbles are
splatted with wrap too.
"""

import os
import bpy
import numpy as np

# --------------------------------------------------------------------------
# The knobs. Frequencies are in *tiles*, and one tile is TILE_METRES across —
# so a frequency of 2 over a 4 m tile means features about 2 m wide.
# --------------------------------------------------------------------------
RES = 512               # pixels across one tile: 512 over 4 m is 128 px/m
TILE_METRES = 4.0       # the floor tile the texture is mapped to, one to one

PATCH_FREQ = 2          # ~2 m earth patches — the layer that matters for hiding
PATCH_OCTAVES = 3
PATCH_BANDS = 4         # posterised into this many tones; 0 disables the banding
PATCH_EDGE = 0.07       # how soft a band edge is, as a fraction of a band
PATCH_CONTRAST = 0.42   # ± brightness across the bands. The main dial

MID_FREQ = 6            # ~0.6 m, so a band is not a solid colour
MID_CONTRAST = 0.16

GRAIN_FREQ = 40         # ~10 cm grit. Below what a brush can match: keep quiet
GRAIN_CONTRAST = 0.09

PALE_PEBBLES = 55       # ~3 per square metre, matching how few the kit has
PALE_LIFT = 0.34
DARK_PEBBLES = 25
DARK_SINK = 0.22
PEBBLE_PX = (1.5, 5.0)  # radius range in pixels: 5 px at 128 px/m is 4 cm

WARM_SHIFT = 0.055      # dry patches redder, damp ones cooler
COOL_SHIFT = 0.070

# The atlas patch's own mean, in linear RGB. **Hold this.** Every prop, wall and
# painted body in the map was judged against it, so a floor with a different
# average shifts the whole room.
BASE = (0.5832, 0.5508, 0.5239)

IMAGE_NAME = "dirt_ground"
SEEDS = dict(patch=11, mid=12, grain=13, pale=21, dark=22)


def fbm(res, base_freq, octaves, seed):
    """Periodic value-noise fBm. Tileable because every lattice lookup wraps."""
    rng = np.random.default_rng(seed)
    ys, xs = np.meshgrid(np.arange(res), np.arange(res), indexing="ij")
    total = np.zeros((res, res))
    amp, norm, freq = 1.0, 0.0, base_freq
    for _ in range(octaves):
        lat = rng.random((freq, freq))
        fx = xs * freq / res
        fy = ys * freq / res
        x0 = np.floor(fx).astype(int) % freq
        x1 = (x0 + 1) % freq
        y0 = np.floor(fy).astype(int) % freq
        y1 = (y0 + 1) % freq
        tx = fx - np.floor(fx)
        ty = fy - np.floor(fy)
        tx = tx * tx * (3 - 2 * tx)      # smoothstep, or the lattice shows
        ty = ty * ty * (3 - 2 * ty)
        total += amp * (
            lat[y0, x0] * (1 - tx) * (1 - ty) + lat[y0, x1] * tx * (1 - ty)
            + lat[y1, x0] * (1 - tx) * ty + lat[y1, x1] * tx * ty
        )
        norm += amp
        amp *= 0.5
        freq *= 2
    return total / norm


def norm01(a):
    return (a - a.min()) / (a.max() - a.min())


def posterise(a, levels, softness):
    """Flat plateaus with narrow soft edges. The kit is hand-painted, so bands
    read as painted earth where smooth clouds read as a blurry photo — and a
    flat plateau is something a player can actually match with one colour."""
    if not levels:
        return a
    t = a * levels
    k = np.floor(t)
    f = np.clip((t - k - (0.5 - softness / 2)) / softness, 0, 1)
    return (k + f) / levels


def pebbles(res, count, seed, radius):
    """Round grains, splatted with wrap so the tile stays seamless."""
    rng = np.random.default_rng(seed)
    ys, xs = np.meshgrid(np.arange(res), np.arange(res), indexing="ij")
    out = np.zeros((res, res))
    for _ in range(count):
        px, py = rng.random(2) * res
        r = rng.uniform(*radius)
        dx = (xs - px + res / 2) % res - res / 2
        dy = (ys - py + res / 2) % res - res / 2
        d = np.sqrt(dx * dx + dy * dy)
        out = np.maximum(out, np.clip((r - d) / max(r * 0.55, 1.0), 0, 1))
    return out


def build():
    patch = posterise(norm01(fbm(RES, PATCH_FREQ, PATCH_OCTAVES, SEEDS["patch"])),
                      PATCH_BANDS, PATCH_EDGE) - 0.5
    mid = fbm(RES, MID_FREQ, 2, SEEDS["mid"]) - 0.5
    grain = fbm(RES, GRAIN_FREQ, 2, SEEDS["grain"]) - 0.5
    pale = pebbles(RES, PALE_PEBBLES, SEEDS["pale"], PEBBLE_PX)
    dark = pebbles(RES, DARK_PEBBLES, SEEDS["dark"], (PEBBLE_PX[0], PEBBLE_PX[1] * 0.7))

    mult = (1.0 + PATCH_CONTRAST * patch + MID_CONTRAST * mid
            + GRAIN_CONTRAST * grain + PALE_LIFT * pale - DARK_SINK * dark)
    warm = 2.0 * patch + 0.6 * mid

    rgba = np.empty((RES, RES, 4), dtype=np.float32)
    rgba[..., 0] = BASE[0] * (mult + WARM_SHIFT * warm)
    rgba[..., 1] = BASE[1] * mult
    rgba[..., 2] = BASE[2] * (mult - COOL_SHIFT * warm)
    rgba[..., 3] = 1.0
    np.clip(rgba, 0.02, 1.0, out=rgba)
    # Re-centred after clipping, not before: clipping is what moves the mean.
    for i in range(3):
        rgba[..., i] *= BASE[i] / float(rgba[..., i].mean())
    np.clip(rgba, 0.02, 1.0, out=rgba)
    return rgba, mult


def main():
    rgba, mult = build()

    here = os.path.dirname(bpy.data.filepath) or os.getcwd()
    path = os.path.join(here, "textures", IMAGE_NAME + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)

    img = bpy.data.images.get(IMAGE_NAME)
    if img is None or tuple(img.size) != (RES, RES):
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(IMAGE_NAME, RES, RES, alpha=False, float_buffer=False)
    # Left **unpacked on purpose**: a packed copy wins over the file, so packing
    # it means re-running this changes the PNG and nothing on screen.
    if img.packed_file:
        img.unpack(method="REMOVE")
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    img.source = "FILE"
    img.reload()

    print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))
    print("mean linear rgb %s, wanted %s"
          % ([round(float(rgba[..., i].mean()), 4) for i in range(3)], list(BASE)))
    print("brightness %.2f..%.2f, sd %.3f" % (mult.min(), mult.max(), mult.std()))
    print("%.0f px per metre" % (RES / TILE_METRES))


main()
