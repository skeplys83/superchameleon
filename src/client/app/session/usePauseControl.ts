import { useCallback, useEffect, useState } from "react";
import { cancelLock, lockTargetEl, requestLock } from "@/client/players/pointerLock";
import { setAudioSuspended } from "@/client/sound/engine";
import { useLatestRef } from "./useLatestRef";

type Options = {
  joined: boolean;
  dropped: boolean;
  /** An ad is on screen. It is not a pause — there is no menu and nothing to
   *  resume — but it wants the same two things a pause does. */
  adBreak?: boolean;
};

/**
 * The pause menu, the palette and the pointer lock — one hook, because they are
 * one mechanism.
 *
 * **`paused`, `painting` and `chatting` are mutually exclusive, and every path
 * has to keep them that way.** (`adBreak` is not one of them — it is not a
 * state this hook owns but one handed in, and it overlaps all three freely. It
 * is here because it wants the two things a pause wants, the cursor and the
 * silence, and having two writers decide those is how they end up disagreeing.) Opening the palette clears the pause; Esc closes
 * the palette before it will pause; the hunter's lock handler refuses to pause
 * while it is open. Losing the window was once the exception — it set `paused` and left
 * `painting` alone, which hid the pause menu *and* the palette while the keys
 * stayed dead, so a chameleon came back to a game that ignored them until they
 * pressed Esc to shut an invisible palette and only then found something to
 * resume. Owning both states here is what stops a future path forgetting.
 */
export function usePauseControl({ joined, dropped, adBreak = false }: Options) {
  const [paused, setPaused] = useState(false);
  // `painting` means the palette is up. Hovering your own body opens it, and
  // from then on it stays open until it is minimised — a palette that closed
  // itself while you were mixing a colour would be maddening.
  const [painting, setPainting] = useState(false);
  // `chatting` means the lobby chat box has the keyboard. It is the third
  // overlay and it behaves like the palette: the cursor comes back, the lock
  // goes, and `Game.tsx` feeds it into `Scene`'s `paused` so the movement keys
  // stop while you are typing into them.
  const [chatting, setChatting] = useState(false);

  // Paint mode deliberately gives the cursor back, so the lock handler below
  // must not read that as "the player wants the pause menu".
  const paintingRef = useLatestRef(painting);
  const pausedRef = useLatestRef(paused);
  const chattingRef = useLatestRef(chatting);
  const adBreakRef = useLatestRef(adBreak);

  /** Opening the panel hands the cursor back so you can draw. Closing it takes
   *  nothing back here — clearing `painting` is enough, because the lock effect
   *  below owns re-locking for every way into play, this one included. */
  const setPaintOpen = useCallback((open: boolean) => {
    setPainting(open);
    if (!open) return;
    setPaused(false);
    setChatting(false);
    cancelLock();
    document.exitPointerLock();
  }, []);

  /** The chat box, on the same terms as the palette: it wants the cursor and
   *  the keyboard, so it takes the lock away and shuts the other two overlays. */
  const setChatOpen = useCallback((open: boolean) => {
    setChatting(open);
    if (!open) return;
    setPaused(false);
    setPainting(false);
    cancelLock();
    document.exitPointerLock();
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    // The lock effect below takes the lock back; this only clears the menu.
  }, []);

  /** Both overlays down at once: a room change, a drop, a fresh join. */
  const closeOverlays = useCallback(() => {
    setPaused(false);
    setPainting(false);
    setChatting(false);
  }, []);

  /** Losing the window pauses the game, whoever you are. */
  useEffect(() => {
    if (!joined) return;
    const away = () => {
      setPaused(true);
      setPainting(false);
      // Cleared for the same reason as the palette: coming back to a paused
      // game that is also still holding the keyboard for a box you cannot see
      // is the bug this hook exists to prevent.
      setChatting(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") away();
    };
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [joined]);

  // Pausing always hands the cursor back, whichever role you are, so the menu
  // buttons are reachable. A chameleon never held the lock, so this is a no-op
  // for them; a hunter usually lost it to Esc already, but not if something
  // else raised the menu.
  //
  // An ad takes it for the same reason and has to *take* it: the lock effect
  // below only stops asking, and a hunter mid-hunt is already holding one.
  useEffect(() => {
    if (!paused && !adBreak) return;
    // Cancel first: `requestLock` keeps retrying for about two seconds, and a
    // retry landing after the menu opened would snatch the cursor back off it.
    cancelLock();
    document.exitPointerLock();
  }, [paused, adBreak]);

  // Pause silences the room too. Without this a shot fired the instant before
  // Esc keeps ringing behind the menu. An ad silences it for the same reason
  // and through the same call — two writers would fight over whether the game
  // is audible when an ad ends while the pause menu is up.
  useEffect(() => {
    setAudioSuspended(paused || adBreak);
  }, [paused, adBreak]);

  // **Both roles hold the lock now.** A chameleon's body turns to face the
  // camera as they walk, so the camera is the steering and a cursor drifting
  // into a corner of the screen is a wall you cannot look past. The cursor
  // comes back for exactly the three things that want it — the pause menu, the
  // chat box, and paint mode, which is what `F` is for.
  useEffect(() => {
    if (!joined) return;
    // An ad you cannot click because the cursor is captured is worse than no
    // ad, so the lock goes for the length of the break like it does for a menu.
    if (paused || painting || chatting || dropped || adBreak) {
      // Made to let go, not merely not asked to take: the caller that opened
      // the overlay usually did this already, and doing it here as well is what
      // covers the paths that did not.
      cancelLock();
      document.exitPointerLock();
      return;
    }
    requestLock();
  }, [joined, paused, painting, chatting, dropped, adBreak]);

  /**
   * Esc closes what is open. It does not *open* the pause menu any more —
   * losing the lock does, below.
   *
   * **That is the pointer lock talking.** Now that both roles hold one, a
   * playing player's Esc never reaches here at all: the browser spends it
   * releasing the lock. Were it to reach here and pause, resuming would ask for
   * the lock back in the same keypress that just gave it up, which the browser
   * refuses — leaving a player looking around with no lock and no way back. So
   * the key is only ever read while the cursor is already free.
   *
   * `hasFocus` is the "with the mouse" half: a pause that came from losing the
   * window should be dismissed by coming *back* to it, not by a keystroke that
   * arrives while the page is still in the background.
   */
  useEffect(() => {
    if (!joined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || e.repeat || dropped) return;
      // The box first: while it is open the lock is already released, so this
      // is the one Esc that is certain to have reached the app.
      if (chattingRef.current) {
        setChatOpen(false);
        return;
      }
      if (paintingRef.current) {
        setPaintOpen(false);
        return;
      }
      if (pausedRef.current && document.hasFocus()) setPaused(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [joined, dropped, setPaintOpen, setChatOpen, paintingRef, pausedRef, chattingRef]);

  // Esc releases the pointer lock rather than reaching the app, so losing the
  // lock is what actually means "the player wants out" — for both roles, since
  // both hold one.
  useEffect(() => {
    if (!joined || dropped) return;
    /** Whether this hunter has ever actually held the lock. */
    let held = document.pointerLockElement === lockTargetEl();
    const onLockChange = () => {
      if (document.pointerLockElement) {
        held = true;
        setPaused(false);
        return;
      }
      // An ad is not the player asking for a menu. Without this the break above
      // hands the lock back, this reads that as Esc, and the pause menu opens
      // *behind* the ad — to be found on top of the game once it finishes.
      if (
        held &&
        !paintingRef.current &&
        !chattingRef.current &&
        !adBreakRef.current
      ) {
        setPaused(true);
      }
      held = false;
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [joined, dropped, paintingRef, chattingRef, adBreakRef]);

  return {
    paused,
    painting,
    chatting,
    pausedRef,
    paintingRef,
    chattingRef,
    resume,
    setPaintOpen,
    setChatOpen,
    closeOverlays,
  };
}
