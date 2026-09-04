import { useEffect } from "react";
import { preloadMap } from "@/client/world/preload";
import { preloadMusic, unlockAudio } from "@/client/sound/engine";
import type { RoomInfo } from "@/client/net";

// Map + music, fetched ahead of the player. No loading screen — the lobby is
// free budget and a spinner would undo the point.
export function useRoundAssets(room: RoomInfo | null) {
  const nextMap = room?.nextMap;
  const counting = room?.phase === "countdown";

  useEffect(() => {
    if (!nextMap) return;
    preloadMap(nextMap);
    void preloadMusic();
  }, [nextMap, counting]);
}

// An instant-multiplayer launch has no join click — take the first gesture
// of any kind, else the whole game is silently mute.
export function useAudioUnlockOnGesture() {
  useEffect(() => {
    const unlockOnGesture = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", unlockOnGesture);
      window.removeEventListener("keydown", unlockOnGesture);
    };
    window.addEventListener("pointerdown", unlockOnGesture);
    window.addEventListener("keydown", unlockOnGesture);
    return () => {
      window.removeEventListener("pointerdown", unlockOnGesture);
      window.removeEventListener("keydown", unlockOnGesture);
    };
  }, []);
}
