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
import { MapWarmer } from "@/client/world/MapWarmer";
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

const MAX_FPS = 60;

// Module constant — a fresh array every render would resize the renderer.
const DEFAULT_DPR: [number, number] = [1, 2];

// Absolute (not a fraction of the map's dpr) so hardware cannot buy a sharper
// hunt — the hospital's [1, 1.5] is 1.5 on retina and 1 on plain.
const HUNT_DPR = 0.3;

// "auto" = soft browser interpolation (smears a still chameleon into the wall).
// "pixelated" = crunchy nearest-neighbour.
const HUNT_UPSCALE = "auto";

// Priority > 0 disables r3f's automatic render, so this owns gl.render.
// Frame priorities: 0 movement/physics/input · 1 things copying from those
// (viewmodel, listener) · 2 draw · 3 read the drawn frame back (eyedropper).
function FrameLimiter({ fps }: { fps: number }) {
  const carry = useRef(0);

  useFrame(({ gl, scene, camera }, delta) => {
    const interval = 1 / fps;
    carry.current += delta;

    // Half-frame slack — a 60Hz screen asking for 60fps otherwise misses
    // every frame whose delta lands a hair under the interval.
    if (carry.current < interval - delta / 2) return;

    // Cap the accumulated debt so a backgrounded tab does not force catch-up.
    carry.current = Math.min(carry.current - interval, interval);
    gl.render(scene, camera);
    // The eyedropper (priority 3) must not read a frame this did not draw.
    markDrawn();
    if (DEV) reportDraw();
  }, 2);

  return null;
}

export default function Scene({
  map,
  nextMap,
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
}: {
  map: string;
  nextMap?: string | null;
  room: string;
  role: Role | null;
  reveal: boolean;
  hunting: boolean;
  frozen: boolean;
  graves: Grave[];
  painting: boolean;
  paused: boolean;
  brush: Brush;
  onBrush: (b: Brush) => void;
  picking: boolean;
  onPicked: (hex: string) => void;
}) {
  const chosen = MAPS[safeMapId(map)];
  const render = chosen.render;
  const dpr = render.dpr ?? DEFAULT_DPR;

  // Stays on through the reveal — a hunter never gets a clean look at the
  // spot that beat them. HuntVision is gated on exactly this pair.
  const blinded = role === "hunter" && (hunting || reveal);

  const devMode = useDevMode();

  return (
    <KeyboardControls map={controlMap}>
      <Canvas
        shadows={render.shadows?.enabled ?? true}
        camera={{ fov: 60, position: [0, 5, 11] }}
        dpr={blinded ? HUNT_DPR : dpr}
        // image-rendering inherits from r3f's wrapper.
        style={{ imageRendering: blinded ? HUNT_UPSCALE : "auto" }}
        gl={{ antialias: render.antialias ?? true }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE[render.toneMapping ?? "ACESFilmicToneMapping"];
          gl.toneMappingExposure = render.exposure ?? 1;
          gl.outputColorSpace = THREE[render.outputColorSpace ?? "SRGBColorSpace"];
          gl.shadowMap.enabled = render.shadows?.enabled ?? true;
          // Not PCFSoftShadowMap: deprecated in three 0.185.
          gl.shadowMap.type = THREE[render.shadows?.type ?? "PCFShadowMap"];
          // Runs once, at Canvas creation — a later map's tone mapping etc.
          // only apply if the Canvas is rebuilt.
          if (DEV) {
            console.info(
              `renderer configured once, at Canvas creation: ` +
              `shadowMap.enabled=${gl.shadowMap.enabled}, type=${gl.shadowMap.type}, ` +
              `toneMapping=${gl.toneMapping}, exposure=${gl.toneMappingExposure}`,
            );
          }
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
          <MapWarmer id={nextMap} current={map} />
          {role && (
            <Player
              key={`${room}:${role}`}
              role={role}
              spawn={mapSpawn(map)}
              frozen={frozen}
              hunting={hunting}
              painting={painting}
              paused={paused}
              brush={brush}
              onBrush={onBrush}
              picking={picking}
              onPicked={onPicked}
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
