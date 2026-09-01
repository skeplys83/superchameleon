"""Pull the dungeon walls' top and bottom bands in, almost flush with the field.

Run inside the open .blend (Text Editor, or `blender --background dungeon.blend
--python scripts/inset-wall-bands.py`), then **re-run `retexture-dungeon.py`**:
this moves vertices, and the UVs are a projection of vertex position, so they
have to be rebuilt afterwards.

## The hole it closes

The kit's wall is 1.0 m thick at its base and cornice and only 0.48 m through
the middle, and its collider is a 0.5 m slab -- so a player is stopped at the
brick field while the bands stand 0.26 m proud of them, above and below. That
is a 4 m wide, 2.7 m tall, 0.26 m deep alcove on both faces of every wall in
the map, roofed by the cornice, and a chameleon standing in one is not hiding
against the wall so much as inside it.

Widening the collider instead would be worse: it would stop a body 0.26 m in
front of the surface it is painted to match, which is the whole game.

## Why the rule is a coordinate range and not a z range

The wall's profile is the same handful of kit constants everywhere:

      |a| = 0.500   the band, at full thickness (z <= 0.25, z >= 3.45)
            0.429   its chamfer
            0.350   a groove near the top of the cornice
            0.330   the blocks standing out of the field  <- the pivot
            0.239   the field itself

so **the compression is applied to the coordinate, not to a band of height**,
pivoting on the blocks at 0.330 and bringing 0.500 to 0.350 -- 0.02 m proud of
the blocks, 0.11 m proud of the field. That matters for three reasons:

- It runs on **x and y alike**, which is what makes `wall_corner` work. A
  corner is thick on both axes, and a rule written for "the y thickness" would
  bend one of its legs and leave the other standing.
- It leaves the wall's *length* alone: |x| = 2.0 on a straight piece is far
  outside the range, so ends still meet their neighbours exactly. Two collinear
  pieces thin by the same amount and still abut.
- It leaves **decoration** alone. `wall_pillar` reaches 0.75, `wall_shelves`
  0.87, `wall_cracked` 0.63; all are past the range and none of them move.

A z gate is kept anyway, loose, as a second fence around the field.

**It cannot open a sightline.** The middle of the wall is 0.478 m through and
already the thinnest part; nothing here touches it, and the bands stay thicker
than it is. Collision is a separate object and is not touched at all, so where
a player may stand does not change -- only how much room there is to stand in.

## Idempotence

The source range starts at 0.36, above every value this can produce (0.350 and
below), so a second run finds nothing to do. That is the whole guard: no flag,
no custom property -- see AUTHORING trap 20 for why a property would not have
survived anyway.
"""

import bpy

# The kit constants above. PIVOT is the blocks standing out of the field, and
# what "almost flush" is measured against.
PIVOT = 0.330
TARGET = 0.350   # where the band lands: 0.02 m proud of the blocks
LOW = 0.360      # below this nothing moves, which is what makes a re-run a no-op
HIGH = 0.550     # above this it is decoration, not the band

# Loose, and only a second fence: the range above already excludes the field.
BAND_BELOW = 0.60
BAND_ABOVE = 3.15

SCALE = (TARGET - PIVOT) / (0.500 - PIVOT)


def inset(value: float) -> float:
    """Compress one coordinate toward the field, or return it unchanged."""
    size = abs(value)
    if not (LOW < size <= HIGH):
        return value
    moved = PIVOT + (size - PIVOT) * SCALE
    return moved if value > 0 else -moved


def main() -> None:
    walls = [m for m in bpy.data.meshes
             if m.name.startswith("wall") and "__yaw" not in m.name]
    top = max((max(v.co.z for v in m.vertices) for m in walls if m.vertices),
              default=0.0)
    moved = 0
    for mesh in walls:
        for vertex in mesh.vertices:
            z = vertex.co.z
            if not (z <= BAND_BELOW or z >= top - (4.0 - BAND_ABOVE)):
                continue
            before = (vertex.co.x, vertex.co.y)
            vertex.co.x = inset(vertex.co.x)
            vertex.co.y = inset(vertex.co.y)
            if (vertex.co.x, vertex.co.y) != before:
                moved += 1
    print(f"inset {moved} vertices across {len(walls)} wall meshes "
          f"({0.500:.3f} -> {TARGET:.3f}, pivoting on {PIVOT:.3f})")
    print("now re-run scripts/retexture-dungeon.py: the UVs are a projection "
          "of vertex position and are stale until you do")


main()
