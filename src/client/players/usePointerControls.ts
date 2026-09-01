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
/**
 * Where the camera sits in paint mode.
 *
 * The default 7 frames a body against the room, which is the right shot for
 * hiding in it and the wrong one for painting a shoulder: the brush ring is a
 * fraction of a figure that is a fraction of the screen. Pulling in to about
 * two body-lengths puts the figure across most of the view without going so
 * close that a stroke is drawn on a surface you cannot see the shape of.
 *
 * **It only ever pulls in.** A player who had already zoomed closer than this
 * chose that, and shoving them back out to a "closer" camera is not what the
 * mode is for.
 */
const PAINT_ZOOM = 2.8;
const ZOOM_STEP = 0.0022; // per wheel pixel
/**
 * Seconds for the camera to cover about two thirds of a zoom change it was
 * *given* rather than scrolled — which today means entering and leaving paint
 * mode, and nothing else.
 *
 * **Exponential, so it is frame-rate independent**: a fixed fraction per frame
 * would arrive at a different speed on a 144 Hz monitor than on a 60 Hz one.
 * Short on purpose — this is a camera move the player asked for by pressing a
 * key, and anything slower than about a fifth of a second stops reading as a
 * move and starts reading as the controls being sluggish.
 */
const ZOOM_TAU = 0.11;
/** Below this the ease is over; an exponential never actually arrives. */
const ZOOM_EPSILON = 0.002;
const MOUSE_SENSITIVITY = 0.0022;
/**
 * How far the view may tip, down and up — effectively straight either way, so a
 * chameleon can look at the spot it is lying in from directly above, and at the
 * ceiling it is about to climb.
 *
 * **Neither is exactly PI/2.** `camera.lookAt` builds its orientation against a
 * world up of (0, 1, 0), and a view direction parallel to that has no defined
 * roll — straight up or down makes the third-person camera spin on its own
 * axis. The 0.02 guard is the smallest angle that keeps it stable, and is a
 * fifth of a degree off vertical.
 *
 * **Up used to stop at 0.9**, about 52°, which is not a look limit anybody
 * chose: it was the angle at which the old camera jammed against the floor
 * behind the player. The camera solves for that itself now — it shortens its
 * leg as the view rises, continuously, and `Player.tsx` hides the figure it
 * ends up inside — so the cap can be what the maths needs rather than what the
 * geometry used to.
 */
const PITCH_MIN = -Math.PI / 2 + 0.02;
const PITCH_MAX = Math.PI / 2 - 0.02;
const PAINT_FLUSH_MS = 100;
/** How much of the brush range one pixel of right-drag covers. The full range
 *  is about 250 px across, which is a comfortable flick. */
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

/**
 * Everything the mouse means, and the strokes it produces.
 *
 * Mouse look, painting, the brush-size drag, the eyedropper's click and the
 * trigger all depend on the same pointer, so they are installed together and
 * share one teardown. The handlers are installed **once** — the current brush,
 * mode and props reach them through the refs below rather than by re-binding on
 * every change, because re-binding mid-drag loses the gesture.
 */
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

  /**
   * Where this player is looking. Owned here rather than passed in, because
   * every field of it is written by the handlers below — a ref handed *into* a
   * hook and mutated by it is what `react-hooks/immutability` exists to stop.
   * The frame loop reads it back through the return value.
   */
  const look = useRef(newLook());

  const cursor = useRef<BrushCursor | null>(null);
  /** Strokes waiting to be sent, filled by the brush and drained on a timer. */
  const outbox = useRef<string[]>([]);
  /** A right-drag that started on the body: where it began and the size it had. */
  const sizing = useRef<{ x: number; size: number } | null>(null);
  /** When the shotgun last went off, so a held mouse button is one shot. */
  const lastShot = useRef(0);

  const brushRef = useRef(brush);
  const onBrushRef = useRef(onBrush);
  const paintingRef = useRef(painting);
  const pausedRef = useRef(paused);
  const frozenRef = useRef(frozen);
  const pickingRef = useRef(picking);
  const onPickedRef = useRef(onPicked);
  /** The swatch beside the cursor, alive only while the eyedropper is armed. */
  const preview = useRef<PickPreview | null>(null);
  /** The label under the brush ring. Held in a ref for the same reason the
   *  brush cursor is: the effects below have to be able to put it away, and
   *  a hint left showing under a menu is not cleared by a mouse that has
   *  stopped moving. */
  const hint = useRef<CursorHint | null>(null);
  /** Where the cursor was last seen, so an eyedropper armed from the keyboard
   *  has somewhere to put its swatch before the mouse moves again. */
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
    // An armed eyedropper says so with the pointer, since the click it is
    // waiting for lands in the world rather than on the panel that armed it.
    // On the body rather than the canvas: the panel's own buttons set their
    // own cursor, so the crosshair covers exactly what is pickable.
    if (!picking) return;
    // The ring is a real object in the scene and sits exactly under the cursor,
    // so it would be the thing sampled.
    cursor.current?.cancel();
    hint.current?.setVisible(false);
    document.body.style.cursor = "crosshair";

    // The swatch lives exactly as long as the arming does, so there is no state
    // to clear anywhere else — disarming, picking, pausing and leaving all run
    // this teardown.
    const swatch = createPickPreview();
    preview.current = swatch;
    // Placed up front: F arms the pick without moving the mouse, and a circle
    // parked in the corner until you do would read as broken. **The colour
    // comes off the drawn frame**, not from `albedoAt` — the swatch answers
    // "what am I looking at", and raw albedo held up against the surface it was
    // taken from does not match it: grey stone under torchlight is brown on
    // screen. The brush still takes the albedo, which is what makes the body
    // come out that same brown under that same light. See `eyedropper.ts`.
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

  /** The zoom paint mode borrowed, so leaving hands it back. */
  const zoomBefore = useRef<number | null>(null);
  /** The tween closing the gap between `zoom` and `zoomTarget`, if one is. */
  const zoomTween = useRef(0);

  useEffect(() => {
    paintingRef.current = painting;
    if (!painting) {
      cursor.current?.cancel();
      hint.current?.setVisible(false);
    }

    // **Paint mode moves the camera in, over about a fifth of a second.** It
    // sets the *target* and leaves `zoom` to `Player.tsx`, which closes the gap
    // per frame — see `ZOOM_TAU`. It used to assign `zoom` outright, and the
    // camera arrived before the panel did: a cut, not a move, and it read as
    // the view glitching rather than as stepping up to your own body.
    //
    // The zoom is *borrowed*: what the player was looking at the room from is
    // put back when they leave, rather than the mode quietly redefining their
    // camera for the rest of the round. Anything they scroll to while painting
    // belongs to the mode and goes with it.
    if (painting) {
      if (zoomBefore.current === null) zoomBefore.current = look.current.zoomTarget;
      look.current.zoomTarget = Math.min(look.current.zoomTarget, PAINT_ZOOM);
    } else if (zoomBefore.current !== null) {
      look.current.zoomTarget = zoomBefore.current;
      zoomBefore.current = null;
    }

    // **The ease lives here because `Look` is written here.** `Player.tsx` reads
    // it sixty times a second and never writes it — `react-hooks/immutability`
    // enforces that, and the folder doc calls it the ownership line. So this is
    // its own rAF rather than a line in the frame loop, running only while
    // there is a gap to close and stopping the moment there is not.
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
    // A drag that was in flight when the menu came up must not carry on
    // painting or turning the camera once the pointer handlers wake up again.
    if (!paused) return;
    cursor.current?.cancel();
    hint.current?.setVisible(false);
    look.current.orbiting = false;
  }, [paused, look]);

  // Strokes go out in batches: a drag produces far more points than are worth
  // a message each.
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

    // The lock may already be held when this component is built.
    look.current.locked = document.pointerLockElement === canvas;

    // Shown with the brush ring, and nowhere else: hovering your own body is
    // the moment somebody is thinking about colour, and the eyedropper is
    // otherwise a button you have to already know about. The ring only appears
    // in paint mode now, which is the only place the key works either.
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
      // One hook for the whole drag, so the brush cannot keep scrubbing after a
      // cancel — see the note on `onDrawingChange`.
      onDrawingChange: (drawing) => {
        if (drawing) startLoop("brush");
        else stopLoop("brush");
      },
    });
    cursor.current = brushCursor;

    const onPointerDown = (e: MouseEvent) => {
      // Paused means paused: no painting, no shooting, and above all no
      // grabbing the pointer lock back, which would cancel the menu.
      if (pausedRef.current) return;

      // Right button resizes the brush when it starts on your own body, and
      // turns the camera anywhere else — so the gesture is contextual and the
      // camera is never taken away from you when you are not painting.
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

      // The eyedropper takes whatever pixel is actually on the screen. The read
      // happens after the next draw — see `paint/eyedropper.ts`.
      if (pickingRef.current) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // The surface's own colour, not the lit pixel — paint is albedo, and
        // handing back a lit pixel gets it lit twice. See `paint/albedo.ts`.
        // It needs no frame: the ray can be cast on the click itself.
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

        // Nothing solid under the cursor — the sky, or the background. There is
        // no albedo to read, and what is drawn there is close enough to unlit
        // that the pixel itself is the right answer.
        requestPick(x, y, (hex) => onPickedRef.current?.(hex));
        return;
      }

      // Left button on your own body draws on it — unless the round is over and
      // this body is being shown to everybody, which is not the moment to repaint
      // the camouflage that is the subject of the exhibit.
      if (!frozenRef.current && !look.current.locked && brushCursor.begin(e)) {
        // A colour counts as *used* here and nowhere else: a drag begun with it.
        // Recording it where it is chosen would fill the history with every
        // shade the cursor crossed on its way across the wheel.
        rememberColor(brushRef.current.color);
        return;
      }

      // **Both roles take the lock**, so a click back into the world is the way
      // back in for either of them — the browser throttles repeated lock
      // requests after an Esc, and without a click there is a window where the
      // effect's retries are refused and nothing else asks.
      if (!look.current.locked) {
        if (!paintingRef.current) canvas.requestPointerLock();
        return;
      }

      // Past here the pointer is captured and the click is a trigger pull, and
      // only one of the two roles has a trigger.
      if (role === "chameleon") return;

      // A pump-action needs pumping. The trigger-pull is what is rate-limited,
      // not the hit — clicking faster than this simply does nothing, rather than
      // queueing up. The server enforces the same interval, since fire rate is
      // the one thing about a shot that reaches everybody else.
      const now = performance.now();
      if (now - lastShot.current < FIRE_INTERVAL_MS) return;
      lastShot.current = now;

      const shot = resolveShot(raycaster, camera, solids.current);
      if (!shot) return;
      // After the hit test, so it fires exactly when the bang does — a shot
      // that resolved to nothing makes no noise and should kick nothing.
      kickViewmodel();
      if (shot.kind === "player") sendKill(shot.id, shot.point);
      // The server relays the mark back to everyone, this client included, so
      // every player sees the same patch appear.
      //
      // **The tracer is drawn from the barrel, not from the eye.** `shot.origin`
      // is where the shot was *cast* from — the camera, through the centre of
      // the screen — and that is still what decides what was hit. But the
      // camera sits behind your eyes, so a beam drawn from it came out of the
      // middle of your face with the gun in your hands doing nothing. The
      // muzzle is one frame stale and about a metre away; at that range the
      // difference is invisible to everyone else and it is the whole effect for
      // the hunter. Null when there is no viewmodel on screen to have a barrel.
      else sendShoot(shot.position, shot.rotation, muzzleAt() ?? shot.origin);
    };

    const onPointerUp = () => {
      brushCursor.end();
      look.current.orbiting = false;
      sizing.current = null;
    };

    // The right-drag look would otherwise raise the browser menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    // Wheel zooms the third-person camera. Painting fine detail needs to get
    // close, and chameleons want to pull back to check their hiding spot. It is a
    // third-person control, so it is the chameleon's — a hunter's camera sits
    // inside their head and there is nothing to pull back from.
    const onWheel = (e: WheelEvent) => {
      if (pausedRef.current || role === "hunter") return;
      e.preventDefault();
      // Both, so the wheel still lands on the frame it is turned. Only paint
      // mode animates — see `zoomTarget` in `look.ts`.
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

      /** Nothing that needs a button held may survive the button coming up. */
      if (e.buttons === 0 && (look.current.orbiting || brushCursor.drawing)) {
        brushCursor.end();
        look.current.orbiting = false;
        sizing.current = null;
      }

      // A right-drag that began on the body is sizing the brush, not painting
      // and not turning: one pixel across is one step through the range.
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

      // While the menu is up the cursor belongs to the menu: moving it must not
      // turn the camera, and must not report a hover — a hover pops the palette
      // open, and opening the palette clears `paused`, so the pause menu used
      // to vanish the moment you moved the mouse towards it.
      if (pausedRef.current) {
        label.setVisible(false);
        return;
      }

      // The armed eyedropper's swatch follows the pointer; its colour is read
      // off the drawn frame by `useEyedropperReadback`, which keeps answering
      // for as long as the watch stands.
      if (pickingRef.current) {
        preview.current?.move(e.clientX, e.clientY);
        moveWatch(e.clientX, e.clientY);
      }

      // A stroke already in flight wins over everything else the mouse could
      // mean — including a right button pressed mid-drag. The exception is a
      // round ending under it: a drag begun a moment before the gong must not
      // keep repainting the body everybody has been asked to look at.
      if (brushCursor.drawing) {
        if (frozenRef.current) brushCursor.cancel();
        else brushCursor.move(e);
        // The ring is under the cursor and the stroke is already happening;
        // there is nothing left to advertise.
        label.setVisible(false);
        return;
      }

      // A free cursor means paint mode, which is the only thing that hands one
      // back — so keep the brush ring on whatever it is over.
      if (
        !frozenRef.current &&
        !look.current.locked &&
        !look.current.orbiting &&
        !pickingRef.current
      ) {
        const overBody = brushCursor.move(e);
        // The label rides with the ring: same condition, same moment.
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

    // Losing the tab drops every key, and anything mid-gesture with it: a drag
    // that was painting, an orbit, and the brush loop, none of which will ever
    // see their matching up event.
    // A backgrounded tab runs no frames, so the loop cannot notice this itself.
    // It clears `jumpHeld` from `focused` on its next frame — see `Player.tsx`.
    const onBlur = () => {
      look.current.focused = false;
      brushCursor.cancel();
      look.current.orbiting = false;
      // No ring, no label — and nothing will move the mouse to clear it while
      // the tab is in the background.
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
    // A pointer the browser takes away — a gesture interrupted, a touch
    // cancelled — never sends `pointerup`. Same handler, same reason.
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
