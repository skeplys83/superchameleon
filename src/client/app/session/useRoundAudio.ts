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

/**
 * Everything the round itself makes a noise about: the clock's tick, the bell
 * when hiding ends, the gong that closes it, and the one music bed each of the
 * two playable phases owns. All of it is driven by the phase changing rather
 * than by a message — there is no "match over" message,
 * and adding one would only be a second thing that can disagree with the phase.
 */
export function useRoundAudio(phase: Phase | undefined, secondsLeft: number) {
  /** One tick per second of a countdown, for everybody at once. */
  const ticking =
    phase === "countdown" ||
    phase === "hiding" ||
    (phase === "hunt" && secondsLeft <= HUNT_URGENT_SECONDS);
  useEffect(() => {
    if (!ticking || secondsLeft <= 0) return;
    playSound("tick");
  }, [ticking, secondsLeft]);

  const lastPhase = useRef<string | undefined>(undefined);
  /** The phase as of *now*, for anything scheduled to check before it fires. */
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = phase;

    // **Each bed belongs to one phase and to nothing else**, so this is a fact
    // about the phase rather than about the transition into it. Both stop the
    // moment the round is decided rather than playing under the gong and the
    // reveal, and each starts below for somebody who arrives part-way in and
    // never heard the transition — a reconnection, or a caught player coming
    // back. Ordered stop-then-start: the two are never sounding together.
    if (phase !== "hiding") stopLoop("hideMusic");
    if (phase !== "hunt") stopLoop("huntMusic");

    if (!phase || before === phase) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    /**
     * Both files are `deferred`, so the buffer may still be decoding when its
     * phase opens — and `startLoop` silently does nothing without one, which
     * would cost the whole phase its music rather than the first second of it.
     * `preloadMusic` is idempotent, so awaiting it here is a no-op once loaded
     * and a wait for the fetch otherwise. The phase is re-checked when it
     * settles, because it may have moved on while we waited.
     */
    const startWhenLoaded = (name: "hideMusic" | "huntMusic", forPhase: Phase) => {
      void preloadMusic().then(() => {
        if (phaseRef.current !== forPhase) return;
        // `startLoop` is a no-op when that name is already going, so arriving
        // twice is harmless. It loops forever: whoever starts it stops it, and
        // the phase length is nothing the sound engine knows or needs to.
        startLoop(name);
      });
    };

    // The chameleons are scattering and the hunter is alone in the lobby. Same
    // bed for both, so nobody can tell from the audio which side they are on.
    if (phase === "hiding") startWhenLoaded("hideMusic", "hiding");

    if (phase === "hunt") {
      /** Straight out of the hiding phase, rather than arriving part-way in. */
      const fromTheBell = before === "hiding";
      if (fromTheBell) {
        // Hiding is over and the hunter is on their way in.
        playSound("bell");
      }
      timers.push(
        setTimeout(
          () => {
            // Checked at fire time, not at schedule time. The cleanup below
            // covers the ordinary case; this covers a call that outlived the
            // code that scheduled it, which is what a hot reload produces.
            if (phaseRef.current !== "hunt") return;
            startWhenLoaded("huntMusic", "hunt");
          },
          // The delay is there to let the bell ring alone. Nobody arriving
          // late heard the bell, so there is nothing to wait for.
          fromTheBell ? MUSIC_DELAY_MS : 0,
        ),
      );
    }

    // The round is decided, either way: three strikes, overlapping into one
    // long fall rather than three separate noises. Only on the transition —
    // somebody who loads straight into a reveal did not watch it end.
    if (phase === "reveal" && before) {
      for (let i = 0; i < GONG_STRIKES; i++) {
        // Tapered: the strikes overlap and add, so a flat gain would make the
        // last one the loudest moment of the round rather than the first.
        const gain = GONG_FALLOFF ** i;
        if (i === 0) playSound("gong", { gain });
        else
          timers.push(
            setTimeout(() => playSound("gong", { gain }), i * GONG_GAP_MS),
          );
      }
    }

    /** Everything scheduled here is cancelled when the phase moves on. */
    return () => timers.forEach(clearTimeout);
  }, [phase]);
}
