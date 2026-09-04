import { useEffect } from "react";
import {
  onDropped,
  onLeftRoom,
  onMoved,
  onMoveFailed,
  onRoom,
  type RoomInfo,
} from "@/client/net";
import { forgetAllSkins } from "@/client/paint/skin";
import { cancelLock } from "@/client/players/pointerLock";
import { stopAllLoops } from "@/client/sound/engine";
import { clearPlayerDebug } from "@/client/app/dev";

type Handlers = {
  setRoom: (info: RoomInfo) => void;
  setDropped: (dropped: boolean) => void;
  setError: (message: string) => void;
  closeOverlays: () => void;
};

// A change of room is a clean slate — onLeftRoom is the one place that says so.
export function useNetEvents({ setRoom, setDropped, setError, closeOverlays }: Handlers) {
  useEffect(() => onRoom(setRoom), [setRoom]);

  useEffect(
    () =>
      onLeftRoom(() => {
        forgetAllSkins();
        stopAllLoops();
        clearPlayerDebug();
      }),
    [],
  );

  useEffect(() => onMoved(closeOverlays), [closeOverlays]);

  useEffect(
    () => onMoveFailed((reason) => setError(`Could not change room. ${reason}`)),
    [setError],
  );

  useEffect(
    () =>
      onDropped(() => {
        setDropped(true);
        closeOverlays();
        cancelLock();
        stopAllLoops();
        document.exitPointerLock();
      }),
    [setDropped, closeOverlays],
  );
}
