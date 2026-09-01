import { useEffect, useState } from "react";
import { POSES, type Joint, type Pose } from "@/client/figure/poses";
import {
  debugDraws,
  debugTicks,
  playerDebug,
  toggleDevMode,
  useDevMode,
  type PlayerDebug,
} from "@/client/app/dev";

/**
 * The developer-mode readout: what the local player is doing, and every number
 * of the pose they are holding.
 *
 * Only mounted in a developer build, so it is absent from the built image — see
 * `src/game/dev.ts`. It reads a module-level snapshot rather than props,
 * because what it displays is written from inside the frame loop.
 *
 * **The chip is the toggle**, and it is always there while the readout is
 * mounted — the one thing that must not disappear when developer mode goes off
 * is the way back on. It sits *below* the readout so it does not move as the
 * numbers above it grow and shrink.
 */

/** Ten samples a second. The frame loop writes at sixty; re-rendering this tree
 *  that often to watch numbers a human is reading is pure waste, and a slower
 *  sample is also *more* readable — digits stop flickering. */
const SAMPLE_MS = 100;

/** Every joint of a `Pose`, in the order the body is built from — the arms
 *  twice over, since the table states those per side. */
function jointRows(pose: Pose): [string, Joint][] {
  return [
    ["torso", pose.torso],
    ["chest", pose.chest],
    ["neck", pose.neck],
    ["head", pose.head],
    ["clavicle L", pose.clavicle.left],
    ["clavicle R", pose.clavicle.right],
    ["shoulder L", pose.shoulder.left],
    ["shoulder R", pose.shoulder.right],
    ["elbow L", pose.elbow.left],
    ["elbow R", pose.elbow.right],
    ["hip", pose.hip],
    ["knee", pose.knee],
  ];
}

const num = (n: number, places = 2) => n.toFixed(places);

/** A number that is zero is written by nobody: dim it, so the ones a pose
 *  actually sets are the ones the eye lands on. */
function Angle({ value, className }: { value: number | undefined; className: string }) {
  const set = value !== undefined && value !== 0;
  return (
    <span className={`w-12 text-right ${set ? className : "text-neutral-700"}`}>
      {num(value ?? 0)}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className="flex gap-2">{children}</span>
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 mb-0.5 border-t border-neutral-800 pt-1.5 first:mt-0 first:border-t-0 first:pt-0 text-[0.5625rem] font-bold uppercase tracking-[0.18em] text-lime-400">
      {children}
    </div>
  );
}

function JointRow({ name, joint }: { name: string; joint: Joint }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-cyan-300">{name}</span>
      <span className="flex gap-1.5">
        <Angle value={joint?.x} className="text-rose-300" />
        <Angle value={joint?.spread} className="text-amber-300" />
        <Angle value={joint?.twist} className="text-violet-300" />
      </span>
    </div>
  );
}

export function DebugPanel({ map, phase }: { map: string; phase: string }) {
  const on = useDevMode();
  const [state, setState] = useState<{ player: PlayerDebug | null; fps: number; tps: number }>({
    player: null,
    fps: 0,
    tps: 0,
  });

  // Nothing is sampled while the readout is off — the interval is the only cost
  // this thing has when nobody is looking at it.
  useEffect(() => {
    if (!on) return;
    let draws = debugDraws();
    let ticks = debugTicks();
    let at = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(1, now - at);
      const seenDraws = debugDraws();
      const seenTicks = debugTicks();
      setState({
        player: playerDebug(),
        fps: ((seenDraws - draws) * 1000) / elapsed,
        tps: ((seenTicks - ticks) * 1000) / elapsed,
      });
      draws = seenDraws;
      ticks = seenTicks;
      at = now;
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [on]);

  const { player, fps, tps } = state;
  const pose: Pose | null = player ? POSES[player.pose] : null;

  return (
    // Clear of `hud/ChatPanel`, which owns bottom-left at `w-80`. Offset
    // always rather than only in a lobby: a dev chip that moves about between
    // rooms is harder to find than one that does not.
    <div className="pointer-events-none absolute bottom-4 left-[22rem] z-30 flex w-60 select-none flex-col items-start gap-1.5 font-mono text-[0.625rem] leading-[1.4] tabular-nums text-neutral-300 antialiased">
      {on && (
        <div className="max-h-[calc(100dvh-5rem)] w-full overflow-y-auto rounded border border-lime-400/25 bg-black/95 px-3 py-2">
          <Head>room</Head>
          <Row label="map">
            <span className="text-fuchsia-300">{map}</span>
          </Row>
          <Row label="phase">
            <span className="text-fuchsia-300">{phase}</span>
          </Row>

          {!player ? (
            <div className="mt-2 text-neutral-600">no player in the world</div>
          ) : (
            <>
              <Head>player</Head>
              <Row label="role">
                <span className="text-fuchsia-300">{player.role}</span>
              </Row>
              <Row label="pos">
                <span className="text-rose-300">{num(player.x)}</span>
                <span className="text-lime-300">{num(player.y)}</span>
                <span className="text-sky-300">{num(player.z)}</span>
              </Row>
              <Row label="half">
                <span className="text-rose-300">{num(player.half[0])}</span>
                <span className="text-lime-300">{num(player.half[1])}</span>
                <span className="text-sky-300">{num(player.half[2])}</span>
              </Row>
              <Row label="yaw / pitch">
                <span className="text-amber-300">{num(player.yaw)}</span>
                <span className="text-amber-300">{num(player.pitch)}</span>
              </Row>
              <Row label="body yaw">
                <span className="text-amber-300">{num(player.bodyYaw)}</span>
              </Row>
              <Row label="vy">
                <span className={player.vy < -0.01 ? "text-orange-400" : "text-lime-300"}>
                  {num(player.vy)}
                </span>
              </Row>
              <Row label="ground / cling">
                <span className={player.grounded ? "text-lime-400" : "text-neutral-600"}>
                  {player.grounded ? "yes" : "air"}
                </span>
                <span className={player.clinging ? "text-lime-400" : "text-neutral-600"}>
                  {player.clinging ? "yes" : "no"}
                </span>
              </Row>
              <Row label="camera">
                <span className="text-cyan-300">{player.firstPerson ? "first" : "third"}</span>
                <span className="text-cyan-300">{num(player.zoom, 1)}</span>
              </Row>
              {/* The list every raycast in the frame loop walks — see `world/`,
                  invariant 25. The first number to look at if movement feels heavy. */}
              <Row label="surfaces">
                <span className={player.surfaces ? "text-cyan-300" : "text-orange-400"}>
                  {player.surfaces}
                </span>
              </Row>
              <Head>
                pose {player.pose} · <span className="text-fuchsia-300">{pose?.key}</span>
              </Head>
              <Row label="box">
                <span className="text-cyan-300">
                  {pose ? pose.half.map((n) => n.toFixed(2)).join(" ") : "—"}
                </span>
              </Row>
              <Row label="centre">
                <span className="text-cyan-300">
                  {pose ? pose.centre.map((n) => n.toFixed(2)).join(" ") : "—"}
                </span>
              </Row>
              <Row label="flat">
                <span
                  className={
                    pose && pose.flat !== "none" ? "text-lime-400" : "text-neutral-700"
                  }
                >
                  {pose?.flat ?? "none"}
                </span>
              </Row>
              <Row label="rootX">
                <Angle value={pose?.rootX} className="text-amber-300" />
              </Row>
              <Row label="offset y / z">
                <Angle value={pose?.offsetY} className="text-lime-300" />
                <Angle value={pose?.offsetZ} className="text-sky-300" />
              </Row>

              {/* Every joint, set or not: the ones sitting at zero are as much a
                  fact about the pose as the ones that are dialled. */}
              <Head>joints · x spread twist</Head>
              {pose &&
                jointRows(pose).map(([label, joint]) => (
                  <JointRow key={label} name={label} joint={joint} />
                ))}
            </>
          )}
        </div>
      )}

      {/* The toggle. `pointer-events-auto` on this and nothing else, so the
          readout above it never eats a click meant for the world. */}
      <button
        type="button"
        onClick={toggleDevMode}
        className={`pointer-events-auto flex items-center gap-2 rounded border px-1.5 py-0.5 font-mono text-[0.625rem] transition-colors ${
          on
            ? "border-lime-400/40 bg-black/95 text-neutral-300 hover:border-lime-400"
            : "border-neutral-700 bg-black/70 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300"
        }`}
        title="Toggle developer mode (`)"
      >
        <span
          className={`px-1 font-bold tracking-[0.2em] ${
            on ? "bg-lime-400 text-black" : "bg-neutral-700 text-neutral-300"
          }`}
        >
          DEV
        </span>
        {/* Drawn frames, then frame-loop ticks. They differ on purpose: the
            loop runs at the refresh rate and `MAX_FPS` throttles only the
            draw — see `reportDraw` in `src/game/dev.ts`. */}
        {on ? (
          <span>
            <span className="text-lime-300">{fps.toFixed(0)} fps</span>
            <span className="text-neutral-600"> · {tps.toFixed(0)} tick</span>
          </span>
        ) : (
          <span>off</span>
        )}
      </button>
    </div>
  );
}
