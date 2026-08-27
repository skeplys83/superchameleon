import { useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { markDrawn } from "@/client/paint/eyedropper";
import { KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { controlMap } from "@/client/players/controls";
import { GRAVITY } from "@/client/players/body";
import { Player } from "@/client/players/Player";
import { Room } from "@/client/world/Room";
import { DEV, reportDraw, useDevMode } from "@/client/app/dev";
import { MAPS, mapSpawn, safeMapId } from "@/shared/maps";
import { Marks } from "@/client/combat/Marks";
import { Graves } from "@/client/combat/Graves";
import { Viewmodel } from "@/client/combat/Viewmodel";
import { RemotePlayers } from "@/client/players/RemotePlayers";
import { SoundStage } from "@/client/sound/SoundStage";
import type { Role } from "@/shared/protocol";
import type { Brush } from "@/client/paint/brush";
import type { Grave } from "@/client/net";

/**
 * Frames drawn per second, at most. `requestAnimationFrame` already pins the
 * loop to the display's refresh rate, so this only ever takes it *down* — which
 * on a 120Hz panel is half the GPU work, and this game is fragment-bound.
 */
const MAX_FPS = 60;

/** The fallback for a map that names no `dpr`. A module constant rather than a
 *  literal at the use site, because `HuntVision` restores it out of an effect
 *  and a fresh array every render would resize the renderer every render. */
const DEFAULT_DPR: [number, number] = [1, 2];

/**
 * What a hunter sees through during the hunt: framebuffer pixels per CSS pixel,
 * so a half is a quarter of the pixels, upscaled back to fill the window. The
 * one number that tunes how blind the hunt is.
 *
 * **Absolute, rather than a fraction of the map's own `dpr`.** r3f resolves a
 * `[min, max]` range against the display, so the map's `[1, 1.5]` is 1.5 on a
 * retina panel and 1 on a plain one; scaling those by a common factor would
 * hand the player with the better screen a sharper hunt, which is an advantage
 * bought with hardware. One flat number means every hunter looks for
 * chameleons through the same pixels.
 */
const HUNT_DPR = 0.3;

/**
 * How that half-resolution frame is scaled back up to fill the window.
 *
 * `"auto"` lets the browser interpolate — a soft blur, which is what smears a
 * still chameleon into the wall it is painted to match. `"pixelated"` is the
 * crunchy alternative: nearest-neighbour quantises into blocks rather than
 * smearing, and reads more PSX. One word, either way; `HUNT_DPR` is the knob
 * for *how much*, this is the knob for *which kind*.
 */
const HUNT_UPSCALE = "auto";

/**
 * Draws at most `fps` frames a second.
 *
 * **Passing a priority above 0 turns off r3f's automatic render**, which is what
 * makes this possible at all: this callback then owns `gl.render`, and skipping
 * it skips the frame. Movement, physics and input still tick at the full refresh
 * rate and only the expensive pass is throttled — input latency and rapier's
 * stability are untouched.
 *
 * **Frame priorities are the game's one ordering guarantee**, and this is the
 * one that draws:
 *
 * | 0 | movement, physics, input — everything that decides where things are |
 * | 1 | anything that must copy a result, i.e. `combat/Viewmodel` off the camera |
 * | 2 | this, which draws |
 * | 3 | anything that must read the drawn frame back — the eyedropper in
 *       `players/Player.tsx`, which samples the framebuffer it just produced |
 */
function FrameLimiter({ fps }: { fps: number }) {
  const carry = useRef(0);

  useFrame(({ gl, scene, camera }, delta) => {
    const interval = 1 / fps;
    carry.current += delta;

    // Half a frame of slack, or a 60Hz display asking for 60fps loses every
    // frame whose delta lands a hair under the interval.
    if (carry.current < interval - delta / 2) return;

    // Carry the remainder so the long-run average holds, but never bank more
    // than a frame of it: after a stall or a backgrounded tab the accumulated
    // debt would otherwise force a burst of catch-up renders.
    carry.current = Math.min(carry.current - interval, interval);
    gl.render(scene, camera);
    // The eyedropper reads the framebuffer at priority 3 and must not read one
    // this frame never wrote — see `paint/eyedropper.ts`.
    markDrawn();
    if (DEV) reportDraw();
  }, 2);

  return null;
}

export default function Scene({
  map,
  room,
  role,
  reveal,
  hunting,
  frozen,
  graves,
  painting,
  paused,
  brush,
  onBrush,
  picking,
  onPicked,
  onHoverBody,
}: {
  /** Which map this room is playing, straight from room state. */
  map: string;
  /** Which room this is — its invite code, which is its id. */
  room: string;
  role: Role | null;
  /** The round is over and the survivors are being shown. */
  reveal: boolean;
  /** The hunt is on. Hidden players lose their name badges for the duration. */
  hunting: boolean;
  /** This player is rooted to the spot but may still look around. */
  frozen: boolean;
  /** Where each chameleon was found. */
  graves: Grave[];
  painting: boolean;
  paused: boolean;
  brush: Brush;
  onBrush: (b: Brush) => void;
  picking: boolean;
  onPicked: (hex: string) => void;
  onHoverBody: (hovering: boolean) => void;
}) {
  const chosen = MAPS[safeMapId(map)];
  const render = chosen.render;
  const dpr = render.dpr ?? DEFAULT_DPR;

  /**
   * The hunter's handicap: a chameleon lying still against the wall it is
   * painted to match is exactly what a low resolution destroys, so the hunt
   * gets harder without taking anything the player needs to *play*. The HUD
   * surviving is not a trick — `hud/` renders outside the Canvas, so this
   * cannot reach it, and the crosshair is the CSS cursor. Only the world
   * degrades — **the shotgun viewmodel included, deliberately**: it is drawn
   * in-canvas, and a sharp gun held against a soft world is the thing that
   * would look broken.
   *
   * **Gated on the phase as much as on the role**: everyone in a lobby is
   * nominally a hunter, so the role alone would pixelate the waiting room. It
   * switches itself off when `hunting` does, which is the reveal.
   */
  const blinded = role === "hunter" && hunting;

  // Both debug pictures follow the toggle, so this re-renders on the flip.
  const devMode = useDevMode();

  return (
    <KeyboardControls map={controlMap}>
      <Canvas
        shadows={render.shadows?.enabled ?? true}
        camera={{ fov: 60, position: [0, 5, 11] }}
        dpr={blinded ? HUNT_DPR : dpr}
        // Goes on r3f's wrapper div and reaches the canvas because
        // `image-rendering` inherits.
        style={{ imageRendering: blinded ? HUNT_UPSCALE : "auto" }}
        gl={{ antialias: render.antialias ?? true }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE[render.toneMapping ?? "ACESFilmicToneMapping"];
          gl.toneMappingExposure = render.exposure ?? 1;
          gl.outputColorSpace = THREE[render.outputColorSpace ?? "SRGBColorSpace"];
          gl.shadowMap.enabled = render.shadows?.enabled ?? true;
          gl.shadowMap.type = THREE[render.shadows?.type ?? "PCFSoftShadowMap"];
          if (render.fog) {
            scene.fog = new THREE.Fog(render.fog.color, render.fog.near, render.fog.far);
          }
        }}
      >
        <FrameLimiter fps={MAX_FPS} />
        <Physics
          key={map}
          gravity={[0, -GRAVITY, 0]}
          timeStep="vary"
          interpolate={false}
          debug={devMode}
        >
          <Room map={map} />
          {role && (
            <Player
              key={`${room}:${role}`}
              role={role}
              spawn={mapSpawn(map)}
              frozen={frozen}
              painting={painting}
              paused={paused}
              brush={brush}
              onBrush={onBrush}
              picking={picking}
              onPicked={onPicked}
              onHoverBody={onHoverBody}
            />
          )}
        </Physics>
        <RemotePlayers reveal={reveal} hunting={hunting} />
        <SoundStage />
        <Marks />
        <Graves graves={graves} />
        {role === "hunter" && !painting && <Viewmodel />}
      </Canvas>
    </KeyboardControls>
  );
}
