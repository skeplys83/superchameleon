import { matchMaker } from "colyseus";

// No I/O/0/1 — pairs that get read back wrong.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 4;
const TRIES = 12;

const draw = (length: number) =>
  Array.from(
    { length },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join("");

export async function freeRoomCode() {
  for (let i = 0; i < TRIES; i++) {
    const code = draw(LENGTH);
    if ((await matchMaker.query({ roomId: code })).length === 0) return code;
  }
  return draw(LENGTH + 2);
}

export const normaliseCode = (raw: string) =>
  raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
