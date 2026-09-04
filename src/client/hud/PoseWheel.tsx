import { useCallback, useEffect, useRef, useState } from "react";
import { POSES } from "@/client/figure/poses";

// Hold R, flick, release. Owns the whole gesture. Everything is drawn from
// POSES.length.

const SIZE = 360;
const CENTRE = SIZE / 2;
const R_OUT = 168;
const R_IN = 68;
const GAP = 0.024;
// Raw pointer travel — cursor is locked.
const DEADZONE = 34;
// Clamp so a return flick reverses the choice immediately.
const REACH = 150;

const point = (r: number, a: number) =>
  `${CENTRE + Math.cos(a) * r} ${CENTRE + Math.sin(a) * r}`;

// Straight up, clockwise — matches the number-key order.
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
  enabled: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (index: number) => void;
  // Getter — the pose lives in the frame loop and does not re-render this tree.
  current: () => number;
}) {
  const n = POSES.length;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(0);
  const [aiming, setAiming] = useState(false);
  // Accumulated pointer movement — no cursor to read (locked).
  const drift = useRef({ x: 0, y: 0 });
  // Refs — the key-up handler must not be re-bound mid-gesture.
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
      // Open on the pose already held — letting go without moving is a no-op.
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
      const angle = Math.atan2(d.x, -d.y);
      const step = (Math.PI * 2) / n;
      const next = ((Math.round(angle / step) % n) + n) % n;
      if (next === choiceRef.current) return;
      choiceRef.current = next;
      setChoice(next);
    };

    // Tab-away swallows the key-up — close so the next R does not think we are
    // already open.
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
  // Needle points at the committed wedge, not the raw pointer.
  const aim = -Math.PI / 2 + choice * step;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25">
      {/* Sized in rem; viewBox keeps every coordinate in user space so the
          whole wheel rides root scale. DEADZONE/REACH stay in raw pixels. */}
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
