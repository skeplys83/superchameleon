export const ROOM_SURFACE = "room-surface";

// Import-free (invariant 1) — the collision-layer draw flag is DEV, read by
// GltfLevel/Scene.
let revision = 0;

export function bumpSurfaces() {
  revision += 1;
}

export const surfaceRevision = () => revision;
