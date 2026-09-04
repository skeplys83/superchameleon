import { useEffect, useRef } from "react";
import { playSound, preloadMusic, startLoop, stopLoop } from "@/client/sound/engine";
import {
  GONG_FALLOFF,
  GONG_GAP_MS,
  GONG_STRIKES,
  HUNT_URGENT_SECONDS,
  MUSIC_DELAY_MS,
} from "@/shared/protocol";
import type { Phase } from "@/shared/protocol";

// All driven by phase change (no "match over" message — the phase IS the news).
export function useRoundAudio(phase: Phase | undefined, secondsLeft: number) {
  const ticking =
    phase === "countdown" ||
    phase === "hiding" ||
    (phase === "hunt" && secondsLeft <= HUNT_URGENT_SECONDS);
  useEffect(() => {
    if (!ticking || secondsLeft <= 0) return;
    playSound("tick");
  }, [ticking, secondsLeft]);

  const lastPhase = useRef<string | undefined>(undefined);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = phase;

    // Each bed owns one phase. Ordered stop-then-start so the two never sound
    // together; covers a late arrival too.
    if (phase !== "hiding") stopLoop("hideMusic");
    if (phase !== "hunt") stopLoop("huntMusic");

    if (!phase || before === phase) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Both music files are `deferred`, so preload may still be running.
    // preloadMusic is idempotent; recheck the phase after the wait.
    const startWhenLoaded = (name: "hideMusic" | "huntMusic", forPhase: Phase) => {
      void preloadMusic().then(() => {
        if (phaseRef.current !== forPhase) return;
        startLoop(name);
      });
    };

    // Same bed both sides — nobody can tell from the audio which side they are on.
    if (phase === "hiding") startWhenLoaded("hideMusic", "hiding");

    if (phase === "hunt") {
      const fromTheBell = before === "hiding";
      if (fromTheBell) {
        playSound("bell");
      }
      timers.push(
        setTimeout(
          () => {
            // Re-check at fire time — a hot reload may outlive its scheduler.
            if (phaseRef.current !== "hunt") return;
            startWhenLoaded("huntMusic", "hunt");
          },
          // Delay so the bell rings alone; late arrivals skip the wait.
          fromTheBell ? MUSIC_DELAY_MS : 0,
        ),
      );
    }

    // Three overlapping strikes tapered so the first is the loudest moment.
    if (phase === "reveal" && before) {
      for (let i = 0; i < GONG_STRIKES; i++) {
        const gain = GONG_FALLOFF ** i;
        if (i === 0) playSound("gong", { gain });
        else
          timers.push(
            setTimeout(() => playSound("gong", { gain }), i * GONG_GAP_MS),
          );
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [phase]);
}
