import * as THREE from "three";
import { decodeStroke, encodeStroke, paint, SELF } from "./skin";
import { pickBody, type BodyHit } from "./pick";
import type { Brush } from "./brush";

/**
 * How far a drag travels between dabs, as a fraction of the brush's radius.
 *
 * **It has to scale with the brush, and it used to be a flat 0.012 in UV.** The
 * body's unwrap puts roughly two figure units in one UV unit, so a dab's radius
 * in UV is about half the brush size — and at `MIN_SIZE` that is 0.004, well
 * under the old fixed step. The smallest brush therefore laid down dabs that
 * did not touch each other even at a crawl. `MIN_STEP` below still sits under
 * that radius, so the finest line is continuous rather than dotted.
 */
const STEP_PER_SIZE = 0.2;
/** A floor for it, so a tiny brush cannot ask for a dab every texel. */
const MIN_STEP = 0.0025;
/**
 * Most gap-filling dabs one mouse move may insert.
 *
 * A move event is one dab, so a fast flick with a small brush left a dotted
 * line with clear air between the dots — the pointer simply was not sampled
 * often enough. The gap is filled by **re-casting the ray at points along the
 * segment the cursor skipped**, rather than by interpolating UV: the unwrap has
 * seams, and a straight line across one runs through unrelated parts of the
 * atlas. Every filled dab is a real hit with its own UV, so it sits on the
 * surface exactly as a slower drag would have put it.
 *
 * The cap bounds the cost of a mouse that jumped half the screen. Each fill is
 * one ray over the cached posed triangles — the same rays `EDGE_RINGS` already
 * spends up to 25 of on a miss.
 */
const MAX_FILL = 16;
/**
 * How far the ring is lifted off the skin, **along the line of sight**.
 *
 * It used to be lifted along the surface normal, and that is what put the
 * preview off the cursor on a curve: on a face turned away from the camera the
 * normal points sideways in screen space, so a 2 cm lift slides the ring off the
 * point it is previewing — worst exactly where a limb rounds away, which is most
 * of a body. Moving *toward the eye* leaves the centre on the cursor's own ray,
 * so it stays under the pointer whatever the surface is doing.
 *
 * The ring draws with `depthTest: false` (`players/Player.tsx`), so this is not
 * holding off z-fighting; it only keeps the quad from being coincident with the
 * skin it is oriented against.
 */
const RING_OFFSET = 0.02;
/**
 * How far outside the body a press or a drag still counts, in screen pixels.
 *
 * A limb is a few pixels wide at its tip, so a stroke that runs off the end of
 * an arm used to stop dead — the cursor was a pixel past the silhouette and the
 * ray hit nothing. Rays are fired in rings out to this distance and the first
 * hit wins, which reads as the body simply being a bit easier to hit.
 *
 * Only presses and live drags pay for it, and it is affordable at all because
 * `pick.ts` skins the body once and shares that between the rays: through
 * three's own raycast this search measured ~153 ms — a freeze every time a drag
 * ran off a limb — against ~2.4 ms now.
 */
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
  /** Your own figure's group. A getter — it mounts after this is built. */
  figure: () => THREE.Group | null;
  /** The hover preview. A getter for the same reason. */
  ring: () => THREE.Mesh | null;
  /** Read fresh on every stroke so changing colour mid-drag works. */
  brush: () => Brush;
  /** Called with the encoded stroke, for the caller to batch and send. */
  onStroke: (encoded: string) => void;
  /** Fires when a drag starts and when it ends, and only on the change. */
  onDrawingChange?: (drawing: boolean) => void;
}) {
  let drawing = false;
  /** The last dab: where it landed on the unwrap, and where the cursor was on
   *  screen — the second is what the gap-filling re-casts through. */
  let last: { u: number; v: number; x: number; y: number } | null = null;

  const setDrawing = (next: boolean) => {
    if (drawing === next) return;
    drawing = next;
    onDrawingChange?.(next);
  };

  /** Whatever part of your own body is under the cursor.
   *  `tolerant` widens the target — see `EDGE_RINGS`. */
  function hitAt(x: number, y: number, tolerant = false): BodyHit | null {
    const group = figure();
    if (!group) return null;

    // The one skinned mesh wearing the paint. `figure/StickFigure` marks it;
    // the reveal overlay deliberately is not marked, so it cannot be picked.
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
      // Not `raycaster.intersectObject`: three re-skins the whole body for
      // every ray, at 6.15 ms each. See `pick.ts`.
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

  /** Canvas-relative coordinates of a mouse event. */
  function where(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hit(e: MouseEvent, tolerant = false): BodyHit | null {
    const { x, y } = where(e);
    return hitAt(x, y, tolerant);
  }

  /** Sit the ring on the body under the cursor, so you see the dot before you
   *  commit to it. The ring is built at the right radius by the caller, so this
   *  only has to place it. */
  function showRing(found: BodyHit | null) {
    const mesh = ring();
    if (!mesh) return;
    if (!found) {
      mesh.visible = false;
      return;
    }

    // The normal is already in world space — it is built from posed vertices.
    // It still decides which way the ring *faces*; only the lift is along the
    // view ray, so the centre stays on the pixel the cursor is over.
    mesh.visible = true;
    toEye.copy(camera.position).sub(found.point).normalize();
    mesh.position.copy(found.point).addScaledVector(toEye, RING_OFFSET);
    mesh.lookAt(facing.copy(mesh.position).add(found.normal));
  }

  /**
   * One dab, applied here and sent to everyone else. The body is one mesh
   * wearing one continuous unwrap, so a hit's own UV is the coordinate the
   * canvas is drawn in — nothing to look up.
   *
   * **Painted from the decoded wire form, not from the numbers we measured.**
   * `encodeStroke` rounds to three decimals — half a texel on a 1024² canvas —
   * so painting the raw hit locally made your own body the one copy nobody
   * else was looking at. Round-tripping first costs a string and guarantees
   * every canvas is fed byte-identical input.
   */
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

      // Walk the segment the cursor skipped and lay a dab at each step. `ceil`
      // rather than `floor`, so the spacing comes out at or under `step`
      // instead of just over it.
      const fills = Math.min(MAX_FILL, Math.ceil(gap / step));
      for (let i = 1; i < fills; i++) {
        const t = i / fills;
        // Not tolerant: a fill that misses the body is a fill that should not
        // be there, and paying the ring search for each of them would cost far
        // more than the dab is worth.
        const between = hitAt(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
        if (between) dab(between.u, between.v, size, color);
      }
    }

    dab(found.u, found.v, size, color);
    last = { u: found.u, v: found.v, x, y };
  }

  return {
    /** Is a stroke in flight? Callers give a live drag priority over anything
     *  else the mouse might mean. */
    get drawing() {
      return drawing;
    },

    /** Is the cursor over your own body right now? */
    over: (e: MouseEvent) => !!hit(e),

    /** Left button went down on the body. Returns false if it missed. */
    begin(e: MouseEvent) {
      if (!hit(e, true)) return false;
      setDrawing(true);
      last = null;
      drawAt(e);
      return true;
    },

    /** Mouse moved. Returns whether the cursor is over the body, which is what
     *  pops the palette open. */
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

    /** Drop any in-flight stroke and hide the preview — pausing, or losing the
     *  free cursor. A drag left running would carry on painting when the
     *  handlers woke up again. */
    cancel() {
      setDrawing(false);
      last = null;
      const mesh = ring();
      if (mesh) mesh.visible = false;
    },
  };
}
