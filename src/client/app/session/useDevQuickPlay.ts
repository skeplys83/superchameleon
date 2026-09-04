import { useCallback, useEffect, useRef, useState } from "react";
import { generateInviteLink } from "@/client/app/crazygames";
import { DEV } from "@/client/app/dev";
import { sendStart, type RoomInfo } from "@/client/net";
import type { MapId } from "@/shared/mapIds";
import { MIN_PLAYERS } from "@/shared/protocol";

// Named — dropped from production, so it may name a DEV_ONLY_MAPS entry.
const QUICK_PLAY_MAP: MapId = "hospital";

const WINDOW = "superchameleon-dev-second";
const WINDOW_FEATURES = "width=1100,height=760";

// One click → two players in the map. Drives the ordinary path fast; nothing
// about the server changes for it (the pass rule would refuse a solo skip).
// DEV-gated so the whole file drops from production.
export function useDevQuickPlay(room: RoomInfo | null) {
  const [armed, setArmed] = useState(false);
  const second = useRef<Window | null>(null);
  const pointed = useRef(false);
  const sent = useRef(false);

  // Popup opened in the click handler — a popup from an effect is out of the
  // gesture and browsers block it. Parks on about:blank until there is a code.
  const start = useCallback(
    (open: (map: string, listed: boolean, maxPlayers: number) => void) => {
      if (!DEV) return;
      sent.current = false;
      pointed.current = false;
      second.current = window.open("about:blank", WINDOW, WINDOW_FEATURES);
      if (!second.current) {
        console.warn("[dev] the second window was blocked — allow popups for this origin");
      }
      setArmed(true);
      // Unwrapped `create` — the menu's wrapper requests an ad.
      open(QUICK_PLAY_MAP, false, MIN_PLAYERS);
    },
    [],
  );

  useEffect(() => {
    if (!DEV || !armed || !room || room.mode !== "lobby") return;

    // Ref-gated: reading href would still return about:blank mid-navigation.
    if (!pointed.current && second.current && !second.current.closed) {
      pointed.current = true;
      second.current.location.replace(generateInviteLink(room.code));
    }

    if (!sent.current && room.isHost && room.phase === "waiting"
        && room.playerCount >= MIN_PLAYERS) {
      sent.current = true;
      sendStart();
      setArmed(false);
    }
  }, [armed, room]);

  return start;
}
