import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Role } from "@/shared/protocol";
import { resolveShot } from "@/client/combat/shoot";
import { kickViewmodel } from "@/client/combat/recoil";
import { muzzleAt } from "@/client/combat/muzzle";
import { sendKill, sendPaint, sendShoot } from "@/client/net";
import { setLockTarget } from "@/client/players/pointerLock";
import { createBrushCursor, type BrushCursor } from "@/client/paint/brushCursor";
import {
  cancelPick,
  moveWatch,
  requestPick,
  stopWatch,
  watchPixel,
} from "@/client/paint/eyedropper";
import { albedoAt } from "@/client/paint/albedo";
import {
  createCursorHint,
  createPickPreview,
  type CursorHint,
  type PickPreview,
} from "@/client/paint/pickPreview";
import { MAX_SIZE, MIN_SIZE, type Brush } from "@/client/paint/brush";
import { rememberColor } from "@/client/paint/palette";
import { startLoop, stopLoop } from "@/client/sound/engine";
import { FIRE_INTERVAL_MS } from "@/shared/protocol";
import { newLook, type Look } from "./look";

const ZOOM_MIN = 1.2;
const ZOOM_MAX = 14;
// Only ever pulls in — a player closer than this chose that.
const PAINT_ZOOM = 2.8;
const ZOOM_STEP = 0.0022;
// Exponential so it is frame-rate independent.
const ZOOM_TAU = 0.11;
const ZOOM_EPSILON = 0.002;
const MOUSE_SENSITIVITY = 0.0022;
// The 0.02 guard keeps camera.lookAt stable against world up.
const PITCH_MIN = -Math.PI / 2 + 0.02;
const PITCH_MAX = Math.PI / 2 - 0.02;
const PAINT_FLUSH_MS = 100;
const SIZE_PER_PIXEL = (MAX_SIZE - MIN_SIZE) / 250;

type Options = {
  role: Role;
  brush: Brush;
  onBrush: (b: Brush) => void;
  painting: boolean;
  paused: boolean;
  frozen: boolean;
  picking: boolean;
  onPicked?: (hex: string) => void;
  visual: React.RefObject<THREE.Group | null>;
  ring: React.RefObject<THREE.Mesh | null>;
  solids: React.RefObject<THREE.Object3D[]>;
};

// Handlers installed once; current brush/mode/props reach them through refs.
// Re-binding mid-drag loses the gesture.
export function usePointerControls({
  role,
  brush,
  onBrush,
  painting,
  paused,
  frozen,
  picking,
  onPicked,
  visual,
  ring,
  solids,
}: Options): React.RefObject<Look> {
  const { gl, camera, scene, raycaster } = useThree();

  const look = useRef(newLook());

  const cursor = useRef<BrushCursor | null>(null);
  const outbox = useRef<string[]>([]);
  const sizing = useRef<{ x: number; size: number } | null>(null);
  const lastShot = useRef(0);

  const brushRef = useRef(brush);
  const onBrushRef = useRef(onBrush);
  const paintingRef = useRef(painting);
  const pausedRef = useRef(paused);
  const frozenRef = useRef(frozen);
  const pickingRef = useRef(picking);
  const onPickedRef = useRef(onPicked);
  const preview = useRef<PickPreview | null>(null);
  const hint = useRef<CursorHint | null>(null);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);
  useEffect(() => {
    onBrushRef.current = onBrush;
  }, [onBrush]);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);

  useEffect(() => {
    pickingRef.current = picking;
    onPickedRef.current = onPicked;
    if (!picking) return;
    cursor.current?.cancel();
    hint.current?.setVisible(false);
    document.body.style.cursor = "crosshair";

    const swatch = createPickPreview();
    preview.current = swatch;
    // Placed up front so F-arming without a mouse move is not a corner circle.
    const { x, y } = lastMouse.current;
    swatch.move(x, y);
    watchPixel(x, y, (hex) => swatch.setColor(hex));

    return () => {
      document.body.style.cursor = "";
      stopWatch();
      preview.current = null;
      swatch.destroy();
    };
  }, [picking, onPicked]);

  const zoomBefore = useRef<number | null>(null);
  const zoomTween = useRef(0);

  useEffect(() => {
    paintingRef.current = painting;
    if (!painting) {
      cursor.current?.cancel();
      hint.current?.setVisible(false);
    }

    // Paint mode borrows the zoom and hands it back on leaving.
    if (painting) {
      if (zoomBefore.current === null) zoomBefore.current = look.current.zoomTarget;
      look.current.zoomTarget = Math.min(look.current.zoomTarget, PAINT_ZOOM);
    } else if (zoomBefore.current !== null) {
      look.current.zoomTarget = zoomBefore.current;
      zoomBefore.current = null;
    }

    // Ease lives here because Look is written here — the frame loop only reads.
    cancelAnimationFrame(zoomTween.current);
    let last = performance.now();
    const ease = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      const gap = look.current.zoomTarget - look.current.zoom;
      if (Math.abs(gap) < ZOOM_EPSILON) {
        look.current.zoom = look.current.zoomTarget;
        return;
      }
      look.current.zoom += gap * (1 - Math.exp(-delta / ZOOM_TAU));
      zoomTween.current = requestAnimationFrame(ease);
    };
    zoomTween.current = requestAnimationFrame(ease);
    return () => cancelAnimationFrame(zoomTween.current);
  }, [painting, look]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) return;
    cursor.current?.cancel();
    hint.current?.setVisible(false);
    look.current.orbiting = false;
  }, [paused, look]);

  useEffect(() => {
    const flush = setInterval(() => {
      if (!outbox.current.length) return;
      sendPaint(outbox.current.splice(0, outbox.current.length));
    }, PAINT_FLUSH_MS);
    return () => clearInterval(flush);
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    setLockTarget(canvas);

    look.current.locked = document.pointerLockElement === canvas;

    const label = createCursorHint("G to pick a colour");
    hint.current = label;

    const brushCursor = createBrushCursor({
      canvas,
      camera,
      raycaster,
      figure: () => visual.current,
      ring: () => ring.current,
      brush: () => brushRef.current,
      onStroke: (encoded) => outbox.current.push(encoded),
      onDrawingChange: (drawing) => {
        if (drawing) startLoop("brush");
        else stopLoop("brush");
      },
    });
    cursor.current = brushCursor;

    const onPointerDown = (e: MouseEvent) => {
      if (pausedRef.current) return;

      // Right button: resize brush over the body, orbit anywhere else.
      if (e.button === 2) {
        if (look.current.locked) return;
        if (!frozenRef.current && cursor.current?.over(e)) {
          sizing.current = { x: e.clientX, size: brushRef.current.size };
        } else {
          look.current.orbiting = true;
        }
        return;
      }
      if (e.button !== 0) return;

      if (pickingRef.current) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Albedo, not the lit pixel — paint IS albedo and would be lit twice.
        const albedo = albedoAt(
          scene,
          camera,
          (x / rect.width) * 2 - 1,
          -(y / rect.height) * 2 + 1,
        );
        if (albedo) {
          onPickedRef.current?.(albedo);
          return;
        }

        // Nothing solid — fall back to the drawn pixel.
        requestPick(x, y, (hex) => onPickedRef.current?.(hex));
        return;
      }

      if (!frozenRef.current && !look.current.locked && brushCursor.begin(e)) {
        rememberColor(brushRef.current.color);
        return;
      }

      // Click back into the world takes the lock — the browser throttles the
      // effect's retries after an Esc.
      if (!look.current.locked) {
        if (!paintingRef.current) canvas.requestPointerLock();
        return;
      }

      if (role === "chameleon") return;

      // Trigger-pull is what is rate-limited (server enforces the same).
      const now = performance.now();
      if (now - lastShot.current < FIRE_INTERVAL_MS) return;
      lastShot.current = now;

      const shot = resolveShot(raycaster, camera, solids.current);
      if (!shot) return;
      kickViewmodel();
      if (shot.kind === "player") sendKill(shot.id, shot.point);
      // Tracer is drawn from the barrel, not the eye — muzzleAt is one frame
      // stale and about a metre off, invisible at range.
      else sendShoot(shot.position, shot.rotation, muzzleAt() ?? shot.origin);
    };

    const onPointerUp = () => {
      brushCursor.end();
      look.current.orbiting = false;
      sizing.current = null;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onWheel = (e: WheelEvent) => {
      if (pausedRef.current || role === "hunter") return;
      e.preventDefault();
      // Both, so the wheel lands on the frame it turns.
      const next = THREE.MathUtils.clamp(
        look.current.zoomTarget * (1 + e.deltaY * ZOOM_STEP),
        ZOOM_MIN,
        ZOOM_MAX,
      );
      look.current.zoom = next;
      look.current.zoomTarget = next;
    };

    const onMouseMove = (e: MouseEvent) => {
      lastMouse.current.x = e.clientX;
      lastMouse.current.y = e.clientY;

      if (e.buttons === 0 && (look.current.orbiting || brushCursor.drawing)) {
        brushCursor.end();
        look.current.orbiting = false;
        sizing.current = null;
      }

      if (sizing.current) {
        if (e.buttons === 0) {
          sizing.current = null;
        } else {
          const next = THREE.MathUtils.clamp(
            sizing.current.size + (e.clientX - sizing.current.x) * SIZE_PER_PIXEL,
            MIN_SIZE,
            MAX_SIZE,
          );
          if (next !== brushRef.current.size) {
            onBrushRef.current({ ...brushRef.current, size: next });
          }
          return;
        }
      }

      // Paused cursor belongs to the menu — a hover would open the palette and
      // clear paused, and the menu would vanish.
      if (pausedRef.current) {
        label.setVisible(false);
        return;
      }

      if (pickingRef.current) {
        preview.current?.move(e.clientX, e.clientY);
        moveWatch(e.clientX, e.clientY);
      }

      // Stroke in flight wins — except a round ending under it: the frozen body
      // is on exhibit.
      if (brushCursor.drawing) {
        if (frozenRef.current) brushCursor.cancel();
        else brushCursor.move(e);
        label.setVisible(false);
        return;
      }

      if (
        !frozenRef.current &&
        !look.current.locked &&
        !look.current.orbiting &&
        !pickingRef.current
      ) {
        const overBody = brushCursor.move(e);
        label.move(e.clientX, e.clientY);
        label.setVisible(overBody);
      } else {
        brushCursor.cancel();
        label.setVisible(false);
      }

      if (!look.current.locked && !look.current.orbiting) return;
      look.current.yaw -= e.movementX * MOUSE_SENSITIVITY;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch - e.movementY * MOUSE_SENSITIVITY,
        PITCH_MIN,
        PITCH_MAX,
      );
    };

    const onLockChange = () => {
      look.current.locked = document.pointerLockElement === canvas;
    };

    const onBlur = () => {
      look.current.focused = false;
      brushCursor.cancel();
      look.current.orbiting = false;
      label.setVisible(false);
    };
    const onFocus = () => {
      look.current.focused = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onBlur();
      else onFocus();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerup", onPointerUp);
    // pointercancel: gesture interrupted, touch cancelled — no pointerup fires.
    document.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopWatch();
      hint.current = null;
      label.destroy();
      cancelPick();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      cursor.current = null;
      stopLoop("brush");
      setLockTarget(null);
    };
  }, [gl, camera, scene, raycaster, role, visual, ring, solids]);

  return look;
}
