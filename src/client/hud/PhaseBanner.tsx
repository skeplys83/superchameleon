import type { Phase, Role } from "@/shared/protocol";
import { HUNT_URGENT_SECONDS } from "@/shared/protocol";
import { LABEL as CAPS } from "./ui";

/** The clock, and what it is counting towards. */
const LABEL: Record<Phase, { chameleon: string; hunter: string } | null> = {
  waiting: null,
  countdown: null,
  hiding: { chameleon: "Hide", hunter: "They are hiding" },
  hunt: { chameleon: "Stay hidden", hunter: "Find them" },
  reveal: null,
};

export function PhaseBanner({
  phase,
  seconds,
  role,
}: {
  phase: Phase;
  seconds: number;
  role: Role;
}) {
  const label = LABEL[phase];
  // The lobby has its own panel with its own countdown, and the reveal has the
  // round-over card. This is only for the two phases with a world under them.
  if (!label) return null;

  /** The last stretch of a hunt. The tick runs throughout; this is the colour. */
  const urgent = phase === "hunt" && seconds <= HUNT_URGENT_SECONDS;
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    // Not positioned here: `Game.tsx` stacks this under the lobby panel when
    // there is one, so the gap is laid out rather than guessed at.
    <div
      className={`pointer-events-none select-none rounded-xl px-5 py-2 text-center backdrop-blur ${
        phase === "hiding"
          ? "bg-emerald-950/80 text-emerald-200"
          : urgent
            ? "bg-rose-950/85 text-rose-200"
            : "bg-black/60 text-neutral-100"
      }`}
    >
      <div className={`opacity-80 ${CAPS}`}>
        {role === "hunter" ? label.hunter : label.chameleon}
      </div>
      <div className="font-mono text-2xl font-extrabold leading-tight tabular-nums">
        {mm}:{ss}
      </div>
    </div>
  );
}
