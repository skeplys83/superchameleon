#!/bin/sh
# Export a level from Blender into the game.
#
#   ./scripts/export-level.sh            every .blend in levels/
#   ./scripts/export-level.sh dungeon    just that one
#
# Writes public/maps/<id>.glb. Nothing else in the repo reads a .blend, and
# nothing here reads the game — this is a convenience wrapper around one
# `blender --background` call, so the export settings live in one place instead
# of in somebody's memory.
#
# Set BLENDER to point at a different install.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(dirname "$here")
levels="$repo/levels"

find_blender() {
  if [ -n "${BLENDER:-}" ]; then echo "$BLENDER"; return; fi
  if command -v blender >/dev/null 2>&1; then command -v blender; return; fi
  for guess in \
    "/Applications/Blender.app/Contents/MacOS/Blender" \
    "$HOME/Applications/Blender.app/Contents/MacOS/Blender" \
    "/usr/local/bin/blender" \
    "/snap/bin/blender"
  do
    [ -x "$guess" ] && { echo "$guess"; return; }
  done
  echo ""
}

blender=$(find_blender)
if [ -z "$blender" ]; then
  echo "Could not find Blender. Set BLENDER=/path/to/blender and try again." >&2
  exit 1
fi

# `du -k` rather than stat, whose flags differ between macOS and GNU.
size_kb() { du -k "$1" | cut -f1; }

export_one() {
  id=$1
  # One folder per level: levels/<id>/<id>.blend, with whatever it references
  # beside it. That is what keeps image paths relative, so a level opens on any
  # checkout.
  blend="$levels/$id/$id.blend"
  glb="$repo/public/maps/$id.glb"

  if [ ! -f "$blend" ]; then
    echo "no such level: levels/$id/$id.blend" >&2
    exit 1
  fi

  before=0
  [ -f "$glb" ] && before=$(size_kb "$glb")

  "$blender" --background "$blend" --python "$here/export-level.py" -- "$glb" \
    | grep -E "^(exported|  !)" || true

  # Merge mesh data the exporter wrote out more than once — see
  # scripts/optimize-level.mjs. A failure here leaves the exported file alone.
  node "$here/optimize-level.mjs" "$glb" || true

  after=$(size_kb "$glb")
  gz=$( (gzip -c9 "$glb" | wc -c) 2>/dev/null | tr -d ' ' )
  gz_kb=$((gz / 1024))

  printf '  %-10s %sK on disk, %sK gzipped' "$id" "$after" "$gz_kb"
  if [ "$before" -gt 0 ]; then
    printf ' (was %sK)' "$before"
  fi
  printf '\n'

  # The kit palette leaking into an export is the one failure that looks fine
  # until you are standing in the map, so a sudden jump is worth saying out loud.
  if [ "$before" -gt 0 ] && [ "$after" -gt $((before * 2)) ]; then
    echo "  ! that is more than twice the size it was — is the 'kit' collection ticked on?" >&2
  fi
}

if [ $# -gt 0 ]; then
  for id in "$@"; do export_one "$id"; done
else
  found=0
  for dir in "$levels"/*/; do
    id=$(basename "$dir")
    [ -f "$dir$id.blend" ] || continue
    found=1
    export_one "$id"
  done
  [ "$found" -eq 1 ] || { echo "no levels/<id>/<id>.blend found" >&2; exit 1; }
fi

echo
echo "Reload the page. The console reports what each level is made of, and warns"
echo "if spawn or bound in src/game/world/maps.ts no longer match the file."
