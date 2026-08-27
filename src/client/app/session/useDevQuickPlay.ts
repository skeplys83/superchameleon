import { useCallback, useEffect, useRef, useState } from "react";
import { generateInviteLink } from "@/client/app/crazygames";
import { DEV } from "@/client/app/dev";
import { sendStart, type RoomInfo } from "@/client/net";
import type { MapId } from "@/shared/mapIds";
import { MIN_PLAYERS } from "@/shared/protocol";

/**
 * The map Quick play opens, named rather than taken from `DEFAULT_MATCH_MAP`:
 * this button exists to get to the map being worked on, and the default is the
 * one every build ships. Both are dev-only, so pointing it at a `DEV_ONLY_MAPS`
 * entry is fine — the whole file is dropped from a production build.
 */
const QUICK_PLAY_MAP: MapId = "hospital";

/** The second window is named, so pressing the button twice reuses it rather
 *  than filling the screen with tabs. */
const WINDOW = "superchameleon-dev-second";
const WINDOW_FEATURES = "width=1100,height=760";

/**
 * Developer mode: one click from the start menu to two players standing in the
 * map.
 *
 * **There is no way to skip the lobby, and this does not try.** A match accepts
 * a role only when it carries the pass its lobby minted, so the only door into
 * one is a lobby that started a round. What this does instead is drive the
 * ordinary path fast: open an unlisted two-player lobby, bring a second window
 * to it through the `?code=` invite everybody else uses, and press Start the
 * moment the second player is seated. Five seconds of countdown later, both
 * windows are in the map.
 *
 * **Nothing about the server changes for it**, which is the point. A solo
 * version *sounds* smaller and is not: `MIN_PLAYERS` is checked in three
 * places, and past them the draw would make the only player the hunter and
 * leave zero chameleons — which ends the round immediately, by the same rules
 * that decide every real one. A dev-only fork of the win conditions is the last
 * thing that should exist on the server.
 *
 * **Which window gets the gun is a coin flip**, and deliberately not
 * negotiable: the draw is the server's, and a client that could choose is
 * exactly what the pass rule exists to prevent. You get one of each either way.
 *
 * Gated on `DEV`, which vite substitutes — so this whole file is dead code the
 * bundler drops from a production build. See `app/dev.ts`.
 */
export function useDevQuickPlay(room: RoomInfo | null) {
  const [armed, setArmed] = useState(false);
  const second = useRef<Window | null>(null);
  const pointed = useRef(false);
  const sent = useRef(false);

  /**
   * Called from the button's click handler, and the popup is opened *here*
   * rather than once the code arrives — a popup opened from an effect a few
   * hundred milliseconds later is not in the gesture any more, and every
   * browser blocks it. It parks on `about:blank` until there is a code to send
   * it to.
   */
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
      // The unwrapped `create`, never the menu's: the menu's wrapper asks for an
      // ad, and an ad break here would pause the game between the two halves of
      // this flow.
      open(QUICK_PLAY_MAP, false, MIN_PLAYERS);
    },
    [],
  );

  useEffect(() => {
    if (!DEV || !armed || !room || room.mode !== "lobby") return;

    // The code only exists once the room has arrived, which is what the parked
    // window has been waiting for. Tracked by a flag rather than by reading the
    // window's own `href`: this effect runs on every room patch, and a window
    // still mid-navigation still reads `about:blank` — which sends it there
    // again, and again.
    if (!pointed.current && second.current && !second.current.closed) {
      pointed.current = true;
      second.current.location.replace(generateInviteLink(room.code));
    }

    // `sendStart` is refused for anyone but the host and below `MIN_PLAYERS`, so
    // this waits for the seat rather than firing hopefully. Guarded by a ref as
    // well: room state updates several times a second and the countdown does
    // not begin on the same tick the message goes out.
    if (!sent.current && room.isHost && room.phase === "waiting"
        && room.playerCount >= MIN_PLAYERS) {
      sent.current = true;
      sendStart();
      setArmed(false);
    }
  }, [armed, room]);

  return start;
}
