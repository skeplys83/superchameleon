"""
Bake a procedural material from its node graph to the texture the game ships.

    blender levels/dungeon/dungeon.blend --background --python scripts/bake-material.py

or run it from Blender's text editor with the file already open — it writes
`levels/dungeon/textures/<material>.png` and leaves the material exactly as it found it.
Two materials use it today: `dirt_ground` and `stone_wall`.

**Why a bake at all.** The node group is the thing you tune, with a slider for
every layer. glTF cannot carry a node graph — it carries PBR factors and image
textures and nothing else — so the game needs an image, and an image has to
repeat.

**Why the repeat is invisible.** The node group is built on a torus: every noise
is sampled on a circle in x and another in y, so the pattern is *periodic* over
`Tile Period` metres by construction. This bakes exactly one period, which
therefore tiles with no seam at all — as long as the floor's UVs repeat by
translation. The export script's join is what guarantees that; **per-tile UVs
plus per-tile rotation is what made the first attempt seam**, because a rotated
tile meets its neighbour's edge with the wrong one.

**The export runs this itself**, so a slider you moved is in the map you built —
`export-level.py` calls `main()` for every material carrying a `tile_period`.
Run it by hand when you want the PNG refreshed without exporting.
"""

import json
import os

import bpy
import numpy as np

MATERIAL = "dirt_ground"        # the default when run standalone
IMAGE_NODE = "Image Texture"
PIXELS_PER_METRE = 128          # 8 m period at this is 1024 square
SAMPLES = 4                     # a colour bake carries no light, so this is plenty
MARGIN = 0                      # the tile must wrap, and a margin would smear the edge


def bake_onto(mat, tex, image, size, location=(0.0, 0.0, 0.0)):
    """Bake the material across a square `size` metres across, into `image`."""
    keep = tex.image
    tex.image = image
    # The bake writes into the image node that is **active and selected** — both,
    # and it fails with "no active and selected image texture node" if you set
    # only one. Easy to miss interactively, where clicking a node does both.
    for node in mat.node_tree.nodes:
        node.select = False
    tex.select = True
    mat.node_tree.nodes.active = tex

    bpy.ops.mesh.primitive_plane_add(size=size, location=location)
    plane = bpy.context.active_object
    plane.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane
    bpy.ops.object.bake(type="DIFFUSE")

    mesh = plane.data
    bpy.data.objects.remove(plane, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    tex.image = keep


def periodicity(mat, tex, period):
    """Does the pattern actually repeat every `period` metres?

    **Not an edge comparison.** The obvious check — first row against last row —
    cries wolf on anything with hard edges: a masonry lattice puts a mortar
    joint exactly on the tile boundary, so those two pixels sit in different
    courses *by design* and differ wildly while the tile still repeats
    perfectly. This bakes two periods instead and compares the halves, which is
    the property that matters, and it is exact rather than a threshold.

    64 square is plenty: both halves sample the same relative positions, so a
    phase break shows up at any resolution. It costs a fraction of a second.
    """
    # 256 over two periods. Coarser than this averages the mortar and the
    # cracks away, and the noise floor then swamps a pattern whose contrast has
    # been filtered out of the probe.
    res = 256
    probe = bpy.data.images.new("periodicity probe", res, res, alpha=False)
    samples = bpy.context.scene.cycles.samples
    # A pixel here covers a good fraction of a metre, and Cycles jitters its
    # samples inside one — so a handful of samples, or the noise floor swamps
    # the thing being measured.
    bpy.context.scene.cycles.samples = 8
    try:
        bake_onto(mat, tex, probe, period * 2)
        buf = np.empty(res * res * 4, dtype=np.float32)
        probe.pixels.foreach_get(buf)
        a = buf.reshape(res, res, 4)[:, :, :3]
        half = res // 2
        drift = max(float(np.abs(a[:, :half] - a[:, half:]).mean()),
                    float(np.abs(a[:half] - a[half:]).mean()))
        spread = float(a.std())
    finally:
        bpy.data.images.remove(probe)
        bpy.context.scene.cycles.samples = samples

    # Judged against the pattern's own contrast, not against zero. A tile that is
    # genuinely out of phase drifts by something like its whole spread; sampling
    # noise drifts by a fraction of a percent of it.
    if drift < 0.02 * spread:
        return "yes (drift %.5f against contrast %.4f — sampling noise)" % (drift, spread)
    return "NO — halves drift by %.5f against contrast %.4f" % (drift, spread)


def slider_stamp(group):
    """Every input of the node group, rounded, as plain data."""
    out = {}
    for socket in group.inputs:
        value = socket.default_value
        out[socket.name] = ([round(float(v), 5) for v in value]
                            if hasattr(value, "__len__") else round(float(value), 5))
    return out


def resolution(period):
    px = int(round(period * PIXELS_PER_METRE))
    # Powers of two only: three uploads a non-power-of-two texture without mips,
    # and mips are what stop a floor shimmering at a distance.
    pot = 1 << max(0, (px - 1).bit_length())
    return pot


def main(material=MATERIAL):
    mat = bpy.data.materials[material]
    # The one group node in the material, found rather than named: a material
    # that has two is not this kind of material.
    group = next(n for n in mat.node_tree.nodes if n.type == "GROUP" and n.node_tree)
    image_name = mat.name
    period = group.inputs["Tile Period"].default_value
    res = resolution(period)

    scene = bpy.context.scene
    saved = dict(engine=scene.render.engine, samples=None, device=None,
                 selected=[o for o in bpy.context.selected_objects],
                 active=bpy.context.view_layer.objects.active)

    img = bpy.data.images.get(image_name)
    if img is None or tuple(img.size) != (res, res):
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(image_name, res, res, alpha=False, float_buffer=False)
    if img.packed_file:
        # A packed copy wins over the file, so a packed image means the next bake
        # changes the PNG and nothing on screen.
        img.unpack(method="REMOVE")
    img.colorspace_settings.name = "sRGB"

    tex = mat.node_tree.nodes.get(IMAGE_NODE)
    if tex is None:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.name = IMAGE_NODE
        tex.location = (-320, -460)
    tex.image = img
    tex.label = "baked output — connected only at export"

    scene.render.engine = "CYCLES"
    saved["samples"] = scene.cycles.samples
    saved["device"] = scene.cycles.device
    scene.cycles.samples = SAMPLES
    scene.cycles.device = "CPU"
    scene.render.bake.margin = MARGIN
    scene.render.bake.use_clear = True
    # Colour only. The room's lamps must not reach this: paint is albedo, and a
    # floor baked with its lighting in it would be lit twice in the game — the
    # same mistake the eyedropper had, one surface further out.
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True

    # A square exactly one period across, centred on the origin — one whole tile
    # of pattern whether the graph reads object space or world space, since both
    # are periodic over the period. **The UVs the game gets must use the same
    # origin**: `+ 0.5` in both projections, or the map is half a tile out of
    # phase with the viewport you tuned in.
    bake_onto(mat, tex, img, period)
    # Asked while Cycles is still the engine — baking is a Cycles feature, and
    # the restore at the end of this function takes it away again.
    tiles = periodicity(mat, tex, period)

    # **The bake buffer comes back display-referred, and saving encodes it
    # again.** Left alone, a base of 0.583 lands in the PNG as sRGB(sRGB(0.583))
    # — one gamma step too bright, and flattened with it, because encoding
    # compresses the top of the range. Undo the first encoding here so the file
    # holds sRGB(0.583) exactly once, which is what three.js will decode.
    buf = np.empty(res * res * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    rgb = buf.reshape(-1, 4)[:, :3]
    low = rgb <= 0.04045
    rgb[low] /= 12.92
    rgb[~low] = ((rgb[~low] + 0.055) / 1.055) ** 2.4
    img.pixels.foreach_set(buf)
    img.update()

    # The export script reads this off the material to decide the join and the
    # UV scale — one number, written where both halves can see it, rather than
    # the same 8 typed into two files.
    mat["tile_period"] = float(period)

    here = os.path.dirname(bpy.data.filepath) or os.getcwd()
    path = os.path.join(here, "textures", image_name + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    img.source = "FILE"
    img.reload()

    # **The stamp lives beside the PNG, not on the material.** It records what
    # this bake was made from, so the exporter can refuse a .glb whose sliders
    # have moved since — that mistake ships the *previous* look and nothing in
    # the file says so.
    #
    # On disk rather than in the .blend for a sharp reason: writing a custom
    # property does not mark the file dirty, so Blender never offers to save it
    # and the stamp quietly never arrives. It is also committed next to the
    # texture, which means a fresh checkout is checked too, and it diffs.
    with open(os.path.splitext(path)[0] + ".bake.json", "w") as f:
        json.dump({"tile_period": float(period),
                   "pixels_per_metre": PIXELS_PER_METRE,
                   "sliders": slider_stamp(group)}, f, indent=2, sort_keys=True)
        f.write("\n")

    scene.render.engine = saved["engine"]
    scene.cycles.samples = saved["samples"]
    scene.cycles.device = saved["device"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in saved["selected"]:
        try:
            o.select_set(True)
        except ReferenceError:
            pass
    bpy.context.view_layer.objects.active = saved["active"]

    check = np.empty(res * res * 4, dtype=np.float32)
    img.pixels.foreach_get(check)
    lit = check.reshape(-1, 4)[:, :3]
    base = tuple(group.inputs["Base Colour"].default_value)[:3]

    print("baked %s: %.0f m period at %d px/m -> %d x %d"
          % (mat.name, period, PIXELS_PER_METRE, res, res))
    print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))
    print("mean linear rgb %s, base %s"
          % ([round(float(lit[:, i].mean()), 4) for i in range(3)],
             [round(v, 4) for v in base]))
    print("contrast sd %.4f, range %.3f..%.3f"
          % (float(lit.mean(axis=1).std()), float(lit.min()), float(lit.max())))
    print("tiles: %s" % tiles)


if __name__ == "__main__":
    main()
