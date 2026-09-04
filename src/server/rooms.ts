import type { Server } from "colyseus";
import { GameRoom } from "./room.ts";

// Called by both index.ts and the tests, so tests exercise production wiring.
export function defineRooms(gameServer: Server) {
  gameServer.define("lobby", GameRoom);
  gameServer.define("match", GameRoom);
}
