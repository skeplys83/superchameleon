import { Server } from "colyseus";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ServerRoom } from "colyseus";
import type { Room as ClientRoom } from "colyseus.js";
import { defineRooms } from "../rooms.ts";
import type { GameRoom } from "../room.ts";
import type { GameState } from "../schema.ts";

export type { GameRoom };

/** Boot the same room definitions `index.ts` serves. */
export async function bootTestServer(): Promise<ColyseusTestServer> {
  const gameServer = new Server();
  defineRooms(gameServer);
  return boot(gameServer);
}

/** The room instance behind a client's connection, typed as ours. */
export const roomOf = (colyseus: ColyseusTestServer, roomId: string) =>
  colyseus.getRoomById(roomId) as unknown as GameRoom & ServerRoom<GameState>;

/**
 * The private members a test is allowed to reach for. Named rather than `any`,
 * so the day one of them is renamed the tests fail to compile instead of
 * silently asserting nothing.
 */
type Internals = {
  start(): Promise<void>;
  finish(winner: "chameleons" | "hunters"): void;
  roundAborted(id: string): Promise<void>;
  hunterId: string;
  matchId: string | null;
};

export const inner = (room: unknown) => room as unknown as Internals;

export type Client = ClientRoom<GameState>;

/**
 * Every chat line a client is *told*, in order. Chat is a broadcast and the
 * server keeps no copy, so there is no state for a test to read it out of —
 * listening is the only way to see it, which is the point of the change.
 */
export function heard(client: Client) {
  const lines: { name: string; text: string }[] = [];
  client.onMessage("chat", (line: { name: string; text: string }) => lines.push(line));
  return lines;
}

/**
 * Every message of one type a client is *told*, in order. The generic half of
 * `heard`: a relay keeps nothing in state either, so listening is the only way
 * to see what the room actually sent.
 */
export function told<T>(client: Client, type: string) {
  const messages: T[] = [];
  client.onMessage(type, (msg: T) => messages.push(msg));
  return messages;
}

/** Give the room loop a few ticks to settle. */
export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect and wait for the first state to land. `waitForNextPatch` is no use
 * here: a room that has not changed sends no patch, so it simply hangs.
 */
export async function connected<T extends { state: unknown }>(joining: Promise<T>) {
  const room = await joining;
  await settle();
  return room;
}
