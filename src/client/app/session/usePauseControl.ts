import { useCallback, useEffect, useState } from "react";
import { cancelLock, lockTargetEl, requestLock } from "@/client/players/pointerLock";
import { setAudioSuspended } from "@/client/sound/engine";
import { useLatestRef } from "./useLatestRef";

type Options = {
  joined: boolean;
  dropped: boolean;
  // Not a pause, but wants the same two things (cursor and silence).
  adBreak?: boolean;
};

// paused / painting / chatting are mutually exclusive and every path here
// keeps them that way — losing the window once set paused and left painting
// alone, hiding both overlays while the keys stayed dead.
export function usePauseControl({ joined, dropped, adBreak = false }: Options) {
  const [paused, setPaused] = useState(false);
  const [painting, setPainting] = useState(false);
  const [chatting, setChatting] = useState(false);

  const paintingRef = useLatestRef(painting);
  const pausedRef = useLatestRef(paused);
  const chattingRef = useLatestRef(chatting);
  const adBreakRef = useLatestRef(adBreak);

  const setPaintOpen = useCallback((open: boolean) => {
    setPainting(open);
    if (!open) return;
    setPaused(false);
    setChatting(false);
    cancelLock();
    document.exitPointerLock();
  }, []);

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
  }, []);

  const closeOverlays = useCallback(() => {
    setPaused(false);
    setPainting(false);
    setChatting(false);
  }, []);

  useEffect(() => {
    if (!joined) return;
    const away = () => {
      setPaused(true);
      setPainting(false);
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

  // Ad has to actively TAKE the lock — the effect below only stops asking.
  // Cancel first: requestLock retries for ~2s.
  useEffect(() => {
    if (!paused && !adBreak) return;
    cancelLock();
    document.exitPointerLock();
  }, [paused, adBreak]);

  // Pause silences the room. Ad uses the same call so two writers cannot
  // disagree when an ad ends while the pause menu is up.
  useEffect(() => {
    setAudioSuspended(paused || adBreak);
  }, [paused, adBreak]);

  useEffect(() => {
    if (!joined) return;
    if (paused || painting || chatting || dropped || adBreak) {
      cancelLock();
      document.exitPointerLock();
      return;
    }
    requestLock();
  }, [joined, paused, painting, chatting, dropped, adBreak]);

  // Esc closes what is open — it does NOT open the pause menu (losing the
  // lock does, below). hasFocus: a pause from losing the window is dismissed
  // by coming back to it, not by a stray keystroke while backgrounded.
  useEffect(() => {
    if (!joined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || e.repeat || dropped) return;
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

  useEffect(() => {
    if (!joined || dropped) return;
    let held = document.pointerLockElement === lockTargetEl();
    const onLockChange = () => {
      if (document.pointerLockElement) {
        held = true;
        setPaused(false);
        return;
      }
      // An ad handing the lock back must not be read as Esc — else the pause
      // menu opens behind the ad.
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
