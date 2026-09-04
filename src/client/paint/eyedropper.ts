// Framebuffer readback — the eyedropper's fallback when albedo.ts hits nothing.
// The sky / background are near enough unlit that the drawn pixel is right.
// Read happens at frame priority 3 (after FrameLimiter's gl.render at 2).
// A pick is only *taken* on a frame that drew: FrameLimiter can skip
// gl.render outright, and reading a buffer this frame never wrote returns
// zeroes. Anything else that owns gl.render must call markDrawn().

type Pending = {
  x: number;
  y: number;
  done: (hex: string) => void;
};

let pending: Pending | null = null;
let drawn = false;

export function markDrawn() {
  drawn = true;
}

export function requestPick(x: number, y: number, done: (hex: string) => void) {
  pending = { x, y, done };
}

// Consumes the flag. Cleared unconditionally so a drawn frame with nothing to
// read does not leave it set for the skipped frame after it.
export function frameDrawn() {
  const fresh = drawn;
  drawn = false;
  return fresh;
}

export function takePick() {
  const p = pending;
  pending = null;
  return p;
}

export function cancelPick() {
  pending = null;
}

// Cursor swatch's live read — standing (not per-move), because the world
// moves under a still cursor. Shows the drawn pixel (what the eye sees),
// while the click takes albedo.
type Watch = {
  x: number;
  y: number;
  show: (hex: string) => void;
};

let watch: Watch | null = null;

export function watchPixel(x: number, y: number, show: (hex: string) => void) {
  watch = { x, y, show };
}

export function moveWatch(x: number, y: number) {
  if (!watch) return;
  watch.x = x;
  watch.y = y;
}

export function stopWatch() {
  watch = null;
}

// Left in place, unlike a pick — answered every frame until stopped.
export function takeWatch() {
  return watch;
}
