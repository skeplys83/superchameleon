import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import {
  frameDrawn,
  requestPick,
  takePick,
  takeWatch,
} from "@/client/paint/eyedropper";

// Returns null on an empty buffer — this scene never draws fully transparent
// black, so all-zeroes means the read found nothing.
function pixelAt(
  gl: THREE.WebGLRenderer,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): string | null {
  const canvas = gl.domElement;
  const px = Math.min(
    canvas.width - 1,
    Math.round(((clientX - rect.left) / rect.width) * canvas.width),
  );
  // WebGL rows count from the bottom; DOM from the top.
  const py = Math.min(
    canvas.height - 1,
    canvas.height - 1 - Math.round(((clientY - rect.top) / rect.height) * canvas.height),
  );
  const ctx = gl.getContext();
  const buffer = new Uint8Array(4);
  ctx.readPixels(px, py, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buffer);
  if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 0 && buffer[3] === 0) {
    return null;
  }
  return `#${[buffer[0], buffer[1], buffer[2]]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

// Priority 3 — after Scene's draw at 2. Two readers share the frame: the
// click's fallback (one-shot) and the cursor swatch (standing, ~1 read/frame).
export function useEyedropperReadback() {
  useFrame(({ gl }) => {
    // Consumed once — frameDrawn clears the flag.
    if (!frameDrawn()) return;
    const rect = gl.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const wanted = takePick();
    if (wanted) {
      const hex = pixelAt(gl, rect, wanted.x + rect.left, wanted.y + rect.top);
      // Re-queue rather than report #000000 on an empty read.
      if (hex) wanted.done(hex);
      else requestPick(wanted.x, wanted.y, wanted.done);
    }

    const watch = takeWatch();
    if (watch) {
      const hex = pixelAt(gl, rect, watch.x, watch.y);
      // Keep last value on empty — blanking would flicker.
      if (hex) watch.show(hex);
    }
  }, 3);
}
