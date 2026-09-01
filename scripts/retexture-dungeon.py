"""Split the dungeon kit's one atlas material into six real ones.

Run inside the open .blend (Text Editor, or `blender --background dungeon.blend
--python scripts/retexture-dungeon.py`). It is **idempotent**: a second run
re-projects UVs at whatever scale is set below and changes nothing else, which
is how you retune a repeat without starting over.

## What it keys off

The kit ships no textures -- it ships a *palette*. Its 211 models share one
material over a 1024x1024 image that is an 8x4 grid of flat colour cells, one
per surface the artist meant. Every face's UV lands in exactly one cell, so
**the cell is the material identity the kit was authored with**, and it is the
only thing in the file that tells a wall from a barrel hoop.

**But a swatch is a colour, not a surface**, and the kit reuses one wherever
that colour was wanted. Three of the five cells below therefore need a
mesh-name rule beside them, and PLAN holds an ordered list per cell: the first
rule whose prefixes match wins, and `None` matches anything.

    (1,3) #BCC2C5  light grey: the wall's recessed field at |y|=0.25 and the
                   blocks standing in it -> brick; everywhere else the same
                   swatch is the kit's silver -- barrel and box linings, chest
                   and trunk bands, sword blades, keys, torch heads, shield
                   framing, banner poles -> metal
    (4,3) #CB9F8D  wood, and only ever wood, down to the shield backs and the
                   torch handles -> wood. No rule needed, which is the tell
                   that the kit used this swatch for a single material.
    (5,3) #C9C4BE  pale stone: the 8x8 m piece at the origin is the spawn
                   platform -> tiles; every other floor -> gravel. It is also
                   the crockery, which the `floor` prefix keeps out.
    (3,3) #4E595C  dark iron: the floor grates and the portcullis gates
                   -> metal_dark, which is `metal` under a multiply.
    (0,2) #EBEEF0  white: the floor spike trap -> metal. Also the banner
                   patterns and the shield fields, which the prefix keeps out.
    (0,3) #92979B  the darker grey: the frame at the wall's full thickness
                   (|y|=0.50), the pillar bodies and caps, the foundations
                   -> rock. It is what gives the brick field an edge to stop
                   against, so it wants a stone that is clearly not the brick
                   -- Rock014 is mean 88 against Bricks076A's 135.
    (7,3) #ACA199  the kit's *dark* wood and stone at once: the ceiling slab
                   above z=-0.05 and the dark chest variant -> wood, and the
                   rubble pile at the end of one hallway -> rock. The ceiling
                   *beams*, which hang below at
                   z=-0.25..-0.05, are cell (2,3) and are left alone. The same
                   swatch is also barrel tops, torch sconces and banner
                   backs, which both prefixes keep out.

## Why the projection is in local space

Every in-map wall sits on a 2 m grid at scale 1.0, rotated only in 90-degree
steps; every floor is on a 4 m grid. So a **local**-space box projection whose
repeat divides that grid tiles by pure translation across the whole map --
which is the only motion a seamless texture survives (AUTHORING trap 18) --
while leaving every instance sharing its mesh, so no draw call is lost. A
world-space projection would be seamless too and would cost one unique mesh per
object; the only way to have both is to join the pieces at export, which is
what the dungeon's retired procedural floor used to do.
"""

import math

import bpy
from mathutils import Vector

COLS, ROWS = 8, 4

STRUCTURAL = ("wall", "pillar", "column", "stairs", "arch", "barrier",
              "floor_foundation")
# The 8x8 m piece at the origin is the spawn platform; the rest are traps, and
# a trap is set into a floor rather than into loose gravel. Note the spike
# plate is in both this list and SPIKES: its base is tiled and the spikes
# standing out of it are metal, and they are two different swatches.
TILED = ("floor_tile_extralarge_grates", "floor_tile_big_grate",
         "floor_tile_grate", "floor_tile_big_spikes")
SPIKES = ("floor_tile_big_spikes",)
# `trunk_large_B` is the one chest variant the kit put on its *dark* wood
# swatch while `_A` and `_C` sit on the light one, so it alone missed the wood
# rule and shipped as flat atlas colour among the gold.
WOODEN = ("ceiling", "trunk")
RUBBLE = ("rubble",)

# The only pieces laid edge to edge on the grid, and so the only ones where a
# neighbour's pattern has to line up. Everything else -- a table, a bed, a
# banner -- is placed on its own and at any angle it likes.
GRID = ("floor", "ceiling")

# cell -> [(material, metres per repeat, prefixes or None), ...], first match
# wins. Each repeat divides the grid its pieces sit on: walls 2 m, floors 4 m,
# the spawn platform 2 m for a 33 cm tile. The fittings are on no grid at all,
# so theirs is chosen for legibility instead -- 0.35 m, because the brushed
# metal is nearly featureless (stddev 13 against brick's 16, and 6 before it was
# stretched) and at 1 m a key read as a flat white patch rather than as steel.
PLAN = {
    (1, 3): [("brick", 2.0, STRUCTURAL),
             ("metal", 0.35, None)],
    (4, 3): [("wood", 2.0, None)],
    (5, 3): [("tiles", 2.0, TILED),
             ("gravel", 4.0, ("floor",))],
    (3, 3): [("metal_dark", 0.35, None)],
    (0, 2): [("metal", 0.35, SPIKES)],
    (0, 3): [("rock", 2.0, STRUCTURAL)],
    (7, 3): [("wood", 2.0, WOODEN),
             ("rock", 2.0, RUBBLE)],
}

# Meshes retextured wholesale, by mesh name: the 110 tiles of the retired
# procedural floor have no atlas UVs to read, because they never had a swatch.
WHOLE = {"floor_dirt_large_ground": ("gravel", 4.0)}

ATLAS = "dungeon"


def flat(n: Vector) -> bool:
    """Does this face point up or down? Only those care about the yaw."""
    return abs(n.z) >= max(abs(n.x), abs(n.y))


def box_uv(co: Vector, n: Vector, repeat: float, yaw: float) -> tuple[float, float]:
    """Planar-project a vertex onto whichever axis its face most faces.

    `yaw` is the Z rotation of the objects wearing this mesh, and it is applied
    to the up-facing faces only. A wall's faces are vertical, and a Z rotation
    slides their pattern along the run rather than turning it, so they need
    nothing; a floor's face is the one a rotation actually spins. See
    `align_yaw` for why this is not simply zero.
    """
    if flat(n):
        x, y = co.x, co.y
        if yaw:
            c, s = math.cos(yaw), math.sin(yaw)
            x, y = c * co.x - s * co.y, s * co.x + c * co.y
        u, v = (x, y) if n.z >= 0 else (x, -y)
    elif abs(n.x) >= abs(n.y):
        u, v = (-co.y, co.z) if n.x >= 0 else (co.y, co.z)
    else:
        u, v = (-co.x, co.z) if n.y >= 0 else (co.x, co.z)
    return u / repeat, v / repeat


def slot_for(mesh, name: str) -> int:
    """Index of `name` in the mesh's slots, appending one if it has none."""
    for i, m in enumerate(mesh.materials):
        if m and m.name == name:
            return i
    mesh.materials.append(bpy.data.materials[name])
    return len(mesh.materials) - 1


def repeats() -> dict[str, float]:
    """material -> metres per repeat.

    A material carries exactly one repeat, however many cells route to it --
    `rock` arrives from both the wall trim and the rubble, and both want 2 m.
    Wanting two would need the repeat carried per face rather than per material,
    so a rule that disagrees is refused here rather than silently taking
    whichever came last.
    """
    out: dict[str, float] = {}
    for rules in PLAN.values():
        for mat, r, _ in rules:
            if out.setdefault(mat, r) != r:
                raise SystemExit(f"'{mat}' is asked for two repeats: {out[mat]} and {r}")
    for mat, r in WHOLE.values():
        if out.setdefault(mat, r) != r:
            raise SystemExit(f"'{mat}' is asked for two repeats: {out[mat]} and {r}")
    return out


def classify(mesh, wanted: set[str]) -> dict[int, str]:
    """poly index -> material name, for the polys this script owns.

    Read from the atlas UVs on a first run. On a re-run those UVs are gone --
    the projection overwrote them -- so the material already on the poly is the
    answer instead, which is what makes the script re-runnable. The only way
    back from a bad pass is to pull the UVs out of a copy of the .blend with
    `bpy.data.libraries.load`, so take one before you start.
    """
    slots = [m.name if m else "" for m in mesh.materials]
    if any(s in wanted for s in slots):
        return {p.index: slots[p.material_index]
                for p in mesh.polygons if slots[p.material_index] in wanted}

    uv = mesh.uv_layers[0].data
    out = {}
    for poly in mesh.polygons:
        us = vs = 0.0
        for li in poly.loop_indices:
            a = uv[li].uv
            us += a[0]
            vs += a[1]
        n = poly.loop_total
        cell = (min(COLS - 1, max(0, int(us / n * COLS))),
                min(ROWS - 1, max(0, int(vs / n * ROWS))))
        for name, _, prefixes in PLAN.get(cell, ()):
            if prefixes is None or mesh.name.startswith(prefixes):
                out[poly.index] = name
                break
    return out


def users(mesh) -> list:
    return [o for o in bpy.data.objects if o.type == "MESH" and o.data is mesh]


def yaws(mesh) -> dict[int, list]:
    """Objects wearing this mesh, grouped by Z rotation in whole degrees."""
    out: dict[int, list] = {}
    for o in users(mesh):
        out.setdefault(round(math.degrees(o.rotation_euler.z)) % 360, []).append(o)
    return out


def align_yaw(mesh, polys: dict[int, str]) -> list:
    """Give each Z rotation its own copy of a floor mesh. Returns the new ones.

    **The bug this exists for.** The projection is in local space, so a mesh's
    UVs travel with the object -- and the kit's 140 ground tiles are rotated in
    90-degree steps on purpose, to stop their moulded relief repeating every
    4 m. A rotated tile therefore met its neighbour's edge with the wrong one,
    which is trap 18 exactly, and on a stochastic gravel it is subtle enough to
    survive a screenshot.

    The fix is not to stop rotating them -- that is what the rotation is for --
    but to counter-rotate the UVs, which cannot be done on a mesh two rotations
    share. So each rotation gets a copy, and only for the pieces laid edge to
    edge on the grid -- see `GRID`. A first cut gated on "mostly horizontal
    faces" instead and split 33 meshes, tables and banners among them: they have
    horizontal faces too, and no neighbour to line up with. A wall needs nothing
    either, since its owned faces are vertical, where a yaw slides the pattern
    along the run instead of spinning it.
    """
    if not mesh.name.startswith(GRID):
        return []
    groups = yaws(mesh)
    if len(groups) < 2:
        return []

    keep = max(groups, key=lambda d: len(groups[d]))
    made = []
    for degrees, objs in groups.items():
        if degrees == keep:
            continue
        copy = mesh.copy()
        copy.name = f"{mesh.name}__yaw{degrees}"
        for o in objs:
            o.data = copy
        made.append(copy)
    return made


def project(mesh, polys: dict[int, str], repeat_of: dict[str, float]) -> None:
    group = yaws(mesh)
    yaw = math.radians(next(iter(group))) if len(group) == 1 else 0.0
    uv = mesh.uv_layers[0].data
    for index, name in polys.items():
        poly = mesh.polygons[index]
        repeat = repeat_of[name]
        normal = poly.normal
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            uv[li].uv = box_uv(co, normal, repeat, yaw)


def main() -> None:
    repeat_of = repeats()
    wanted = set(repeat_of)
    missing = sorted(wanted - set(bpy.data.materials.keys()))
    if missing:
        raise SystemExit(f"no such material: {', '.join(missing)}")

    # Phase 1: decide what every face becomes, and put it on its slot.
    targets: dict[object, dict[int, str]] = {}
    for mesh in list(bpy.data.meshes):
        if not mesh.polygons or not mesh.uv_layers:
            continue
        names = [m.name if m else "" for m in mesh.materials]
        base = mesh.name.split("__yaw")[0]

        if base in WHOLE:
            mat, _ = WHOLE[base]
            mesh.materials.clear()
            mesh.materials.append(bpy.data.materials[mat])
            for poly in mesh.polygons:
                poly.material_index = 0
            targets[mesh] = {p.index: mat for p in mesh.polygons}
        elif ATLAS in names or any(n in wanted for n in names):
            polys = classify(mesh, wanted)
            if not polys:
                continue
            for index, name in polys.items():
                mesh.polygons[index].material_index = slot_for(mesh, name)
            targets[mesh] = polys
        else:
            continue

    # Phase 2: one Z rotation per mesh, so phase 3 can counter-rotate it.
    for mesh, polys in list(targets.items()):
        for copy in align_yaw(mesh, polys):
            targets[copy] = dict(polys)   # a copy is topologically identical

    # Phase 3: the UVs.
    faces = 0
    for mesh, polys in targets.items():
        project(mesh, polys, repeat_of)
        faces += len(polys)

    print(f"retextured {faces} faces across {len(targets)} meshes")
    for name in sorted(repeat_of):
        used = sum(1 for me in bpy.data.meshes
                   if any(m and m.name == name for m in me.materials))
        print(f"  {name:11} every {repeat_of[name]:g} m, on {used} meshes")
    split = [me.name for me in bpy.data.meshes if "__yaw" in me.name]
    if split:
        print(f"  split by rotation: {', '.join(sorted(split))}")


main()
