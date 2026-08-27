"""Export one .blend to public/maps/<id>.glb with the settings the game expects.

Driven by export-level.sh — run that rather than this. Blender-side only:
nothing here knows anything about the game beyond where to put the file.

    blender --background <in.blend> --python export-level.py -- <out.glb>
"""

import importlib.util
import json
import os
import sys

import bpy


def bake_module():
    """`bake-material.py`, imported by path — a hyphen is not an identifier, and the
    scripts directory is not on Blender's import path."""
    # Importing a file writes a `__pycache__` beside it, which is litter in a
    # repo that has no other Python packages to cache.
    sys.dont_write_bytecode = True
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("bake_material",
                                                 os.path.join(here, "bake-material.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

out = os.path.abspath(sys.argv[sys.argv.index("--") + 1])

# The collision prefixes `world/levelScene.ts` reads. Collision is not drawn, so
# neither the stray check below nor the count at the end treats it as geometry.
PREFIXES = ("col_", "colhull_", "coltri_", "colball_")

# The kit palette must never be exported: it is 211 models parked off the side
# of the map, and including it multiplies the file size and drops a field of
# furniture into the level. It is normally excluded in the .blend already; this
# forces it for the duration of the export so a .blend saved with it ticked on
# still exports correctly. Not saved, so the file on disk is left alone.
restore = []
for child in bpy.context.view_layer.layer_collection.children:
    if child.name == "kit" and not child.exclude:
        print("  ! the 'kit' collection was visible — excluding it for this export")
        child.exclude = True
        restore.append(child)

# Every *other* collection is forced the other way, for the mirror-image reason.
# `use_visible` below means a collection you toggled off in the outliner to see
# past it — `collision` is the one you always want out of the way — exports as
# if it were not in the file. Hiding the colliders that way silently shipped a
# dungeon with nothing to stand on. Restored after, so the .blend is untouched.
# Nested collections count: a level grouped as map/{floor,walls,ceiling,...} hides
# its lid or its lights one level down, and walking only the top level shipped a
# map with no ceiling and no lighting.
unhidden = []


def unhide(layer_collection):
    for child in layer_collection.children:
        if child.name == "kit":
            continue
        if child.exclude or child.hide_viewport or child.collection.hide_viewport:
            print(f"  ! the '{child.name}' collection was hidden — showing it for this export")
            unhidden.append((child, child.exclude, child.hide_viewport,
                             child.collection.hide_viewport))
            child.exclude = False
            child.hide_viewport = False
            child.collection.hide_viewport = False
        unhide(child)


unhide(bpy.context.view_layer.layer_collection)

# The mirror of the leak above, and the quieter one: a piece *placed in the map*
# that was never taken out of the palette collection goes out with the palette,
# so the map is missing a door and the export says nothing. The palette is parked
# off the side of the level, so anything in it standing inside the level's own
# footprint is that mistake. Named rather than fixed: only the .blend can say
# which collection a piece belongs to.
def kit_strays():
    kit = next((c for c in bpy.context.view_layer.layer_collection.children
                if c.name == "kit"), None)
    if not kit:
        return []
    inside = set()

    def gather(collection):
        inside.update(o.name for o in collection.objects)
        for child in collection.children:
            gather(child)

    gather(kit.collection)

    # Measured over what is *drawn*, not over the colliders: a collider built
    # on a palette piece and left there stretches the footprint over the palette
    # itself, and then every model in it reads as a stray.
    exporting = [o for o in bpy.data.objects
                 if o.name not in inside and o.type in {"MESH", "LIGHT"}
                 and not o.name.startswith(PREFIXES)]
    if not exporting:
        return []
    xs = [o.matrix_world.translation.x for o in exporting]
    ys = [o.matrix_world.translation.y for o in exporting]
    lo_x, hi_x, lo_y, hi_y = min(xs), max(xs), min(ys), max(ys)
    # World space, not `location`: a door's handle is parented to the door and
    # sits at the origin of nothing.
    return [o.name for o in bpy.data.objects
            if o.name in inside and o.type == "MESH"
            and lo_x <= o.matrix_world.translation.x <= hi_x
            and lo_y <= o.matrix_world.translation.y <= hi_y]


strays = kit_strays()
if strays:
    shown = ", ".join(sorted(strays)[:8]) + (", ..." if len(strays) > 8 else "")
    print(f"  ! {len(strays)} object(s) stand inside the map but are still in the 'kit' "
          f"collection, so they will NOT be exported: {shown}")

hidden_objects = []
for obj in bpy.data.objects:
    if obj.hide_get() if obj.name in bpy.context.view_layer.objects else False:
        hidden_objects.append(obj)
        obj.hide_set(False)
if hidden_objects:
    print(f"  ! {len(hidden_objects)} hidden object(s) — showing them for this export")

# A `*_lift` empty parks part of the map out of the way while you work on what
# was under it — the dungeon's roof rides one. The offset is a view of the
# level, not part of it, so it is zeroed for the export and put back after.
# Leave the roof in the air permanently; every export still comes out right.
lifted = []
for obj in bpy.data.objects:
    if obj.name.endswith("_lift") and obj.type == "EMPTY" and tuple(obj.location) != (0, 0, 0):
        print(f"  ! '{obj.name}' is raised — exporting it at the origin")
        lifted.append((obj, tuple(obj.location)))
        obj.location = (0.0, 0.0, 0.0)

# Children follow the parent only once the dependency graph has caught up.
if lifted:
    bpy.context.view_layer.update()

# A material carrying a `tile_period` is a **baked procedural**: a node graph
# with a slider for every layer, which glTF cannot carry, so it is baked to one
# tile of PNG here and the image is connected in place of the graph.
#
# **`world_uv_join` decides how its UVs are made, and the two materials answer
# differently.** `stone_wall` is mapped in *object* space, baked into the shared
# mesh's own UVs — 148 walls and pillars keep sharing nine meshes, and a wall
# rotated to face another way carries its pattern round with it. `dirt_ground`
# cannot do that: its tiles are rotated in 90-degree steps to break up the kit's
# repeating pebble bumps, and a seamless tile only stays seamless when it
# repeats by *translation* — a rotated tile meets its neighbour's edge with the
# wrong one, which is the seam the first attempt shipped. So the floor is joined
# into one object here and projected in world space instead, and put back
# afterwards so the .blend keeps its individual tiles.
joined = []
rewired = []
for mat in bpy.data.materials:
    period = mat.get("tile_period")
    if not period or not mat.use_nodes:
        continue

    pieces = [o for o in bpy.context.view_layer.objects
              if o.type == "MESH" and not o.hide_get()
              and any(m is mat for m in o.data.materials)]
    if not pieces:
        continue

    # **Bake first, in this same process.** The node graph is the thing that is
    # tuned and the PNG is only its output, so building a map from a stale one
    # ships a floor nobody chose — which happened, and was caught by holding a
    # screenshot against the viewport rather than by anything in the pipeline.
    # It costs one Cycles pass over a single tile, and the .blend is already
    # open, so it is cheaper here than in a second `--background` run.
    print(f"  ! baking '{mat.name}' from its node graph")
    bake_module().main(mat.name)

    image = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
    group = next((n for n in mat.node_tree.nodes if n.type == "GROUP" and n.node_tree), None)

    # The stamp beside the PNG then has to agree, which after the bake above it
    # always does. It is kept for the export-by-hand path — `AUTHORING.md` says
    # that is fine, and it is the one route where the PNG can be stale.
    stamp_path = (os.path.splitext(bpy.path.abspath(image.image.filepath))[0] + ".bake.json"
                  if image and image.image.filepath else None)
    if group and stamp_path and os.path.exists(stamp_path):
        with open(stamp_path) as f:
            stamp = json.load(f)
        now = {}
        for socket in group.inputs:
            value = socket.default_value
            now[socket.name] = ([round(float(v), 5) for v in value]
                                if hasattr(value, "__len__") else round(float(value), 5))
        moved = [k for k, v in now.items() if stamp.get("sliders", {}).get(k) != v]
        if moved:
            raise SystemExit(
                f"refusing to write {out}: '{mat.name}' has moved since it was baked "
                f"({', '.join(moved)}). Run scripts/bake-dirt.py, save the .blend, "
                "and export again."
            )
    else:
        print(f"  ! '{mat.name}' has no bake stamp — cannot tell whether its image is current")

    principled = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not principled or not image:
        raise SystemExit(f"refusing to write {out}: material '{mat.name}' has a "
                         "tile_period but no baked image to connect")
    base = principled.inputs["Base Color"]
    was = base.links[0].from_socket if base.links else None
    for link in list(base.links):
        mat.node_tree.links.remove(link)
    mat.node_tree.links.new(image.outputs["Color"], base)
    rewired.append((mat, was, base))

    if not mat.get("world_uv_join"):
        # Object-space UVs: already on the mesh, nothing to join.
        continue

    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.duplicate()
    copies = list(bpy.context.selected_objects)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    # The name decides shadow casting: `maps.ts` excludes `floor*` from casting,
    # and a floor that suddenly casts one draws a hard edge along every tile.
    merged.name = f"{mat.name}_joined"
    if not merged.name.startswith("floor"):
        merged.name = "floor_" + merged.name

    # World-planar UVs at the period the texture was baked at. Read through
    # `matrix_world`, so a joined piece that carried a transform lands where it
    # is drawn rather than where its vertices happen to be stored.
    mesh = merged.data
    to_world = merged.matrix_world
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            co = to_world @ mesh.vertices[mesh.loops[li].vertex_index].co
            # `+ 0.5`: the bake covers -period/2..+period/2, so uv 0 is the
            # plane's left edge, not the world origin.
            uv.data[li].uv = (co.x / period + 0.5, co.y / period + 0.5)

    for piece in pieces:
        piece.hide_set(True)
    joined.append((merged, pieces))
    print(f"  ! joined {len(pieces)} '{mat.name}' pieces into one, UVs projected "
          f"every {period:g} m")


bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    # Only what is visible: this is what leaves the kit palette behind.
    use_visible=True,
    # glTF is Y-up, Blender is Z-up. Without this the whole map lies on its side.
    export_yup=True,
    # Export the evaluated mesh, not the pre-modifier cage.
    export_apply=True,
    # A map with no lights arrives black.
    export_lights=True,
    export_cameras=False,
)

for merged, pieces in joined:
    mesh = merged.data
    bpy.data.objects.remove(merged, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    for piece in pieces:
        piece.hide_set(False)
for mat, was, base in rewired:
    for link in list(base.links):
        mat.node_tree.links.remove(link)
    if was:
        mat.node_tree.links.new(was, base)

for child in restore:
    child.exclude = False
for child, exclude, hide_vl, hide_coll in unhidden:
    child.exclude, child.hide_viewport, child.collection.hide_viewport = exclude, hide_vl, hide_coll
for obj in hidden_objects:
    obj.hide_set(True)

# A level with no collision loads, draws, and drops you through the floor — so
# it fails here instead.
colliders = [o.name for o in bpy.data.objects if o.name.startswith(PREFIXES)]
if not colliders:
    raise SystemExit(f"refusing to write {out}: no col_* objects — nothing to stand on")

print(f"exported {out}  ({len(colliders)} colliders)")
