import { useCallback, useEffect, useState } from "react";
import { initGameDistribution, onAdBreak, showAd } from "@/client/app/gamedistribution";

// Init on mount; ads only ever play from a click. Placements: pre-roll on the
// click that enters a game (runs over the loading screen), mid-roll on Leave
// from the pause menu. The host's Start button is NOT a placement — the
// countdown runs on a server clock and an ad would drop the start of hiding.
export function useGameDistribution() {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    initGameDistribution();
    return onAdBreak(setPlaying);
  }, []);

  const requestAd = useCallback(() => {
    showAd();
  }, []);

  return { adBreak: playing, requestAd };
}
