import { getRoom } from "./connection";
import { MAX_STROKE_BATCH, MESSAGES } from "@/shared/protocol";

const { toServer } = MESSAGES;

/** Everything this client tells the room. */

export function sendState(
  p: [number, number, number],
  yaw: number,
  pitch: number,
  pose: number,
  cling: number,
  upright: boolean,
) {
  getRoom()?.send(toServer.state, { p, yaw, pitch, pose, cling, upright });
}

export function sendPaint(strokes: string[]) {
  const room = getRoom();
  if (!room) return;
  for (let i = 0; i < strokes.length; i += MAX_STROKE_BATCH) {
    room.send(toServer.paint, { strokes: strokes.slice(i, i + MAX_STROKE_BATCH) });
  }
}

/** Tells the room you whistled. The server relays it to everyone, positioned at
 *  you — see `sound/`. */
export function sendWhistle() {
  getRoom()?.send(toServer.whistle);
}

/** Start the match. */
export function sendStart() {
  getRoom()?.send(toServer.start);
}

/** Change the map the lobby will start on. Host only, server-checked. */
export function sendMap(map: string) {
  getRoom()?.send(toServer.setMap, { map });
}

export function sendClearSkin() {
  getRoom()?.send(toServer.clearSkin);
}

export function sendKill(id: string, position: [number, number, number]) {
  getRoom()?.send(toServer.kill, { id, position });
}

export function sendShoot(
  position: [number, number, number],
  rotation: [number, number, number],
  origin: [number, number, number],
) {
  getRoom()?.send(toServer.shoot, { position, rotation, origin });
}

/** Say something in the lobby. Refused anywhere else, and outside the two
 *  phases where nobody has a side yet — see `server/messages.ts`. */
export function sendChat(text: string) {
  getRoom()?.send(toServer.chat, { text });
}
