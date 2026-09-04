import { useEffect, type RefObject } from "react";
import { sendState } from "@/client/net";

const STATE_SEND_MS = 50;

export type NetState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  pose: number;
  cling: number;
  upright: boolean;
};

// setInterval, not useFrame — a backgrounded tab runs no frames and would
// look like the player vanishing.
export function useStateBroadcast(netState: RefObject<NetState>) {
  useEffect(() => {
    const send = setInterval(() => {
      const t = netState.current;
      sendState([t.x, t.y, t.z], t.yaw, t.pitch, t.pose, t.cling, t.upright);
    }, STATE_SEND_MS);
    return () => clearInterval(send);
  }, [netState]);
}
