import { useCallback, useEffect, useRef, useState } from "react";
import { POSES } from "@/client/figure/poses";

/**
 * The pose wheel: hold `R`, flick the mouse at a pose, let go.
 *
 * **It owns the whole gesture** — the key, the mouse, and which wedge is lit —
 * and reports only the two things outside it needs: whether it is up, so the
 * world can hold still under it, and the pose that was picked. `figure/poses`
 * is the one import this folder is allowed from inside the Canvas's half of the
 * app, and a label is all that is taken from it.
 *
 * **Everything here is drawn from `POSES.length`.** The wedges, the gaps, the
 * angle each label sits at and the arc the pointer is matched against all come
 * off one number, so adding a row to the table adds a slice.
 */

const SIZE = 360;
const CENTRE = SIZE / 2;
const R_OUT = 168;
const R_IN = 68;
/** Half the gap between two wedges, in radians. */
const GAP = 0.024;
/** How far the mouse has to travel before it means a direction rather than a
 *  twitch. The cursor is locked, so this is raw pointer movement in pixels and
 *  the wheel keeps the pose you came in with until it is cleared. */
const DEADZONE = 34;
/** How far the drift is allowed to run. Past this a long flick is clamped, so
 *  coming back the other way turns the choice round immediately instead of
 *  spending half a screen of movement undoing itself. */
const REACH = 150;

const point = (r: number, a: number) =>
  `${CENTRE + Math.cos(a) * r} ${CENTRE + Math.sin(a) * r}`;

/** One wedge of the ring. Angles run from straight up, clockwise, which is the
 *  order the number keys are in. */
function wedgePath(i: number, n: number) {
  const step = (Math.PI * 2) / n;
  const mid = -Math.PI / 2 + i * step;
  const a0 = mid - step / 2 + GAP;
  const a1 = mid + step / 2 - GAP;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${point(R_IN, a0)}`,
    `L ${point(R_OUT, a0)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${point(R_OUT, a1)}`,
    `L ${point(R_IN, a1)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${point(R_IN, a0)}`,
    "Z",
  ].join(" ");
}

export function PoseWheel({
  enabled,
  onOpenChange,
  onPick,
  current,
}: {
  /** Whether the key is live at all — a chameleon, playing, with no overlay up. */
  enabled: boolean;
  /** The world holds still while this is open, so the caller has to know. */
  onOpenChange: (open: boolean) => void;
  onPick: (index: number) => void;
  /** The pose being held, which is what the wheel opens on. **A getter**: the
   *  pose lives in the frame loop's half of the app and changing it does not
   *  re-render this tree, so a number here would be whatever it was when the
   *  HUD last drew. */
  current: () => number;
}) {
  const n = POSES.length;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(0);
  /** Whether the pointer has left the deadzone yet — the difference between
   *  "still holding what I had" and "aiming at this one". */
  const [aiming, setAiming] = useState(false);
  /** Accumulated pointer movement since the wheel opened. There is no cursor to
   *  read — this is a locked pointer — so the direction is integrated from the
   *  deltas, and clamped so it cannot wander out of reach. */
  const drift = useRef({ x: 0, y: 0 });
  /** Read by the key-up handler, which must not be re-bound on every mouse
   *  move: a listener replaced mid-gesture is a gesture that never finishes. */
  const choiceRef = useRef(0);
  const openRef = useRef(false);

  const close = useCallback(
    (commit: boolean) => {
      if (!openRef.current) return;
      openRef.current = false;
      setOpen(false);
      onOpenChange(false);
      if (commit) onPick(choiceRef.current);
    },
    [onOpenChange, onPick],
  );

  // The wheel cannot outlive the state that allowed it: a caught chameleon, a
  // round ending, a menu opening. Dismissed without committing — the player
  // never let go of the key, so they never chose anything.
  useEffect(() => {
    if (!enabled) close(false);
  }, [enabled, close]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && openRef.current) {
        close(false);
        return;
      }
      if (e.code !== "KeyR" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (openRef.current) return;
      openRef.current = true;
      drift.current.x = 0;
      drift.current.y = 0;
      setAiming(false);
      // Opened on the pose already being held, so letting go without moving is
      // deliberately a no-op rather than a jump to whatever is at the top.
      const held = current();
      choiceRef.current = held;
      setChoice(held);
      setOpen(true);
      onOpenChange(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "KeyR") return;
      close(true);
    };

    const onMove = (e: MouseEvent) => {
      if (!openRef.current) return;
      const d = drift.current;
      d.x += e.movementX;
      d.y += e.movementY;
      const len = Math.hypot(d.x, d.y);
      if (len > REACH) {
        d.x = (d.x / len) * REACH;
        d.y = (d.y / len) * REACH;
      }
      if (len < DEADZONE) return;
      setAiming(true);
      // Zero is straight up and the angle grows clockwise, matching the wedges.
      const angle = Math.atan2(d.x, -d.y);
      const step = (Math.PI * 2) / n;
      const next = ((Math.round(angle / step) % n) + n) % n;
      if (next === choiceRef.current) return;
      choiceRef.current = next;
      setChoice(next);
    };

    // A key held while the tab goes away never sends its key-up, and a wheel
    // left on screen would swallow the next R as an already-open one.
    const onBlur = () => close(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, current, n, close, onOpenChange]);

  if (!open) return null;

  const step = (Math.PI * 2) / n;
  const labelR = (R_IN + R_OUT) / 2;
  /** The needle points at the wedge that is lit rather than at the raw pointer:
   *  the drift lives in a ref, which render may not read, and the wedge is the
   *  thing the gesture is actually going to commit. */
  const aim = -Math.PI / 2 + choice * step;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25">
      {/* Sized in rem, not in `SIZE`: the viewBox keeps every coordinate below in
          user space, so the whole wheel — wedges, needle and the three font sizes
          that are user units — rides the root scale in one step. `DEADZONE` and
          `REACH` are untouched by that: the cursor is locked, so they are raw
          pointer movement and never measured against what is drawn. */}
      <svg className="h-[22.5rem] w-[22.5rem]" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {POSES.map((p, i) => {
          const mid = -Math.PI / 2 + i * step;
          const lit = i === choice;
          return (
            <g key={p.key}>
              <path
                d={wedgePath(i, n)}
                className={
                  lit
                    ? "fill-emerald-400/35 stroke-emerald-300/80"
                    : "fill-black/55 stroke-white/15"
                }
                strokeWidth={1.5}
              />
              <text
                x={CENTRE + Math.cos(mid) * labelR}
                y={CENTRE + Math.sin(mid) * labelR - 5}
                textAnchor="middle"
                className={`fill-current text-[13px] font-semibold ${
                  lit ? "text-white" : "text-neutral-300"
                }`}
              >
                {p.label}
              </text>
              <text
                x={CENTRE + Math.cos(mid) * labelR}
                y={CENTRE + Math.sin(mid) * labelR + 12}
                textAnchor="middle"
                className={`fill-current font-mono text-[11px] ${
                  lit ? "text-emerald-200" : "text-neutral-500"
                }`}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
        {/* Where the mouse is pointing, so the flick has something to aim. */}
        {aiming && (
          <line
            x1={CENTRE}
            y1={CENTRE}
            x2={CENTRE + Math.cos(aim) * (R_IN - 6)}
            y2={CENTRE + Math.sin(aim) * (R_IN - 6)}
            className="stroke-emerald-300/70"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={R_IN - 8}
          className="fill-black/70 stroke-white/15"
          strokeWidth={1.5}
        />
        <text
          x={CENTRE}
          y={CENTRE + 5}
          textAnchor="middle"
          className="fill-current text-[15px] font-semibold text-white"
        >
          {POSES[choice].label}
        </text>
      </svg>
    </div>
  );
}
