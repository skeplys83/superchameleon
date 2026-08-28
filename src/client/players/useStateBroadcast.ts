import { useEffect, type RefObject } from "react";
import { sendState } from "@/client/net";

const STATE_SEND_MS = 50;

/** What every other client needs in order to draw this body. */
export type NetState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  pose: number;
  /** What they are stuck to — `CLING_*` in `shared/protocol`. */
  cling: number;
  upright: boolean;
};

/**
 * Broadcast on a timer rather than from `useFrame`: a backgrounded tab stops
 * running frames entirely, which would look to everybody else like the player
 * vanishing.
 */
export function useStateBroadcast(netState: RefObject<NetState>) {
  useEffect(() => {
    const send = setInterval(() => {
      const t = netState.current;
      sendState([t.x, t.y, t.z], t.yaw, t.pitch, t.pose, t.cling, t.upright);
    }, STATE_SEND_MS);
    return () => clearInterval(send);
  }, [netState]);
}
