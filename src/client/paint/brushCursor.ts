import * as THREE from "three";
import { decodeStroke, encodeStroke, paint, SELF } from "./skin";
import { pickBody, type BodyHit } from "./pick";
import type { Brush } from "./brush";

// Fraction of brush radius — has to scale with size.
const STEP_PER_SIZE = 0.2;
const MIN_STEP = 0.0025;
// A flick between mouse events is filled by re-casting rays along the segment
// — never by interpolating UV, which crosses seams.
const MAX_FILL = 16;
// Along the line of sight, not the normal — a normal offset slides the ring
// off the cursor on a face turned away from the camera.
const RING_OFFSET = 0.02;
// A limb tip is a few pixels wide; rays are fired in rings out to this.
const EDGE_RINGS = [7, 13, 19];
const EDGE_DIRS = 8;

const pointerNdc = new THREE.Vector2();
const facing = new THREE.Vector3();
const toEye = new THREE.Vector3();

export type BrushCursor = ReturnType<typeof createBrushCursor>;

export function createBrushCursor({
  canvas,
  camera,
  raycaster,
  figure,
  ring,
  brush,
  onStroke,
  onDrawingChange,
}: {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  raycaster: THREE.Raycaster;
  // Getters — the figure and ring mount after this is built.
  figure: () => THREE.Group | null;
  ring: () => THREE.Mesh | null;
  brush: () => Brush;
  onStroke: (encoded: string) => void;
  onDrawingChange?: (drawing: boolean) => void;
}) {
  let drawing = false;
  let last: { u: number; v: number; x: number; y: number } | null = null;

  const setDrawing = (next: boolean) => {
    if (drawing === next) return;
    drawing = next;
    onDrawingChange?.(next);
  };

  function hitAt(x: number, y: number, tolerant = false): BodyHit | null {
    const group = figure();
    if (!group) return null;

    let body: THREE.SkinnedMesh | null = null;
    group.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!body && mesh.isSkinnedMesh && mesh.userData.body) body = mesh;
    });
    if (!body) return null;

    const cast = (px: number, py: number) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointerNdc, camera);
      // pickBody, not intersectObject — three re-skins the body per ray (6ms each).
      return pickBody(body!, raycaster.ray);
    };

    const direct = cast(x, y);
    if (direct || !tolerant) return direct;

    for (const radius of EDGE_RINGS) {
      for (let i = 0; i < EDGE_DIRS; i++) {
        const a = (i / EDGE_DIRS) * Math.PI * 2;
        const found = cast(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
        if (found) return found;
      }
    }
    return null;
  }

  function where(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hit(e: MouseEvent, tolerant = false): BodyHit | null {
    const { x, y } = where(e);
    return hitAt(x, y, tolerant);
  }

  function showRing(found: BodyHit | null) {
    const mesh = ring();
    if (!mesh) return;
    if (!found) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    toEye.copy(camera.position).sub(found.point).normalize();
    mesh.position.copy(found.point).addScaledVector(toEye, RING_OFFSET);
    mesh.lookAt(facing.copy(mesh.position).add(found.normal));
  }

  // Painted from the decoded wire form — encodeStroke rounds to 3 decimals
  // (half a texel) and painting the raw hit locally desynchronised copies.
  function dab(u: number, v: number, size: number, color: string) {
    const encoded = encodeStroke({ u, v, size, color });
    const stroke = decodeStroke(encoded);
    if (!stroke) return;
    paint(SELF, stroke);
    onStroke(encoded);
  }

  function drawAt(e: MouseEvent) {
    const { x, y } = where(e);
    const found = hitAt(x, y, true);
    showRing(found);
    if (!found) return;

    const { size, color } = brush();
    const step = Math.max(MIN_STEP, size * STEP_PER_SIZE);

    if (last) {
      const gap = Math.hypot(last.u - found.u, last.v - found.v);
      if (gap < step) return;

      const fills = Math.min(MAX_FILL, Math.ceil(gap / step));
      for (let i = 1; i < fills; i++) {
        const t = i / fills;
        // Not tolerant: a fill that misses should not be there.
        const between = hitAt(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
        if (between) dab(between.u, between.v, size, color);
      }
    }

    dab(found.u, found.v, size, color);
    last = { u: found.u, v: found.v, x, y };
  }

  return {
    get drawing() {
      return drawing;
    },

    over: (e: MouseEvent) => !!hit(e),

    begin(e: MouseEvent) {
      if (!hit(e, true)) return false;
      setDrawing(true);
      last = null;
      drawAt(e);
      return true;
    },

    move(e: MouseEvent) {
      if (drawing) {
        drawAt(e);
        return true;
      }
      const found = hit(e);
      showRing(found);
      return !!found;
    },

    end() {
      setDrawing(false);
      last = null;
    },

    cancel() {
      setDrawing(false);
      last = null;
      const mesh = ring();
      if (mesh) mesh.visible = false;
    },
  };
}
