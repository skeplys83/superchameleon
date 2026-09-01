import { randomUUID } from "node:crypto";
import type { Client } from "colyseus";
import type { GameRoom } from "./room.ts";
import { cleanChat } from "./clean.ts";
import {
  MESSAGES,
  CHAT_INTERVAL_MS,
  MAX_CHAT_LENGTH,
  FIRE_INTERVAL_MS,
  FIRE_INTERVAL_TOLERANCE,
  MAX_STROKE_BATCH,
  MAX_STROKES,
  MAX_STROKE_LENGTH,
  POSE_COUNT,
  WHISTLE_INTERVAL_MS,
  WHISTLE_TOLERANCE,
  CLING_CEILING,
  CLING_NONE,
} from "../shared/protocol.ts";
import { mapLimit } from "../shared/maps.ts";

const { toServer, toClient } = MESSAGES;

/** Anything non-finite off the wire becomes 0 rather than poisoning the state. */
export const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;

/** A full turn, the widest a Euler angle off the wire is allowed to be. */
const TAU = Math.PI * 2;

/**
 * Three finite numbers, or null. `clamp` alone is not enough for a vector: it
 * turns a NaN into a 0, so an all-NaN position becomes the middle of the map
 * rather than being recognised as junk and refused.
 */
const vec3 = (raw: unknown): [number, number, number] | null => {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw as unknown[];
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [x as number, y as number, z as number];
};

/** A point in the map, bounded the same way a player's own position is. */
const point = (raw: unknown, limit: number): [number, number, number] | null => {
  const v = vec3(raw);
  return v && [clamp(v[0], -limit, limit), clamp(v[1], -5, 30), clamp(v[2], -limit, limit)];
};

/** A rotation off the wire. Bounded so a mark cannot be handed an angle no
 *  renderer expects; the wrap itself is the client's business. */
const angles = (raw: unknown): [number, number, number] | null => {
  const v = vec3(raw);
  return v && [clamp(v[0], -TAU, TAU), clamp(v[1], -TAU, TAU), clamp(v[2], -TAU, TAU)];
};

const MIN_FIRE_GAP_MS = FIRE_INTERVAL_MS * FIRE_INTERVAL_TOLERANCE;
const MIN_WHISTLE_GAP_MS = WHISTLE_INTERVAL_MS * WHISTLE_TOLERANCE;

/** Server-only: the client just renders the graves it is sent. */
const MAX_GRAVES = 200;

type ChatMsg = { text?: unknown };
type StateMsg = {
  p?: unknown;
  yaw?: unknown;
  pitch?: unknown;
  pose?: unknown;
  cling?: unknown;
  upright?: unknown;
};
type PaintMsg = { strokes?: unknown };
type KillMsg = { id?: unknown; position?: unknown };
type ShootMsg = { position?: unknown; rotation?: unknown; origin?: unknown };

/** Wire up one room's message handlers. */
export function registerMessages(room: GameRoom) {
  const lastShot = new Map<string, number>();
  const lastWhistle = new Map<string, number>();
  const lastChat = new Map<string, number>();

  /** True at most once per FIRE_INTERVAL_MS per client, and records the shot. */
  const canFire = (sessionId: string) => {
    const now = Date.now();
    if (now - (lastShot.get(sessionId) ?? 0) < MIN_FIRE_GAP_MS) return false;
    lastShot.set(sessionId, now);
    return true;
  };

  /** A seat has gone; stop remembering when it last pulled a trigger. */
  const forget = (sessionId: string) => {
    lastShot.delete(sessionId);
    lastWhistle.delete(sessionId);
    lastChat.delete(sessionId);
  };

  room.onMessage(toServer.state, (client: Client, msg: StateMsg) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || !msg) return;
    const [x, y, z] = Array.isArray(msg.p) ? (msg.p as number[]) : [0, 0, 0];
    // Per map, not per game: the dungeon is 52 across and the lobby 34, and a
    // single bound meant whichever map was bigger had its far end amputated.
    const limit = mapLimit(room.state.map);
    player.x = clamp(x, -limit, limit);
    player.y = clamp(y, -5, 30);
    player.z = clamp(z, -limit, limit);
    player.yaw = Number.isFinite(msg.yaw) ? (msg.yaw as number) : 0;
    player.pitch = Number.isFinite(msg.pitch) ? (msg.pitch as number) : 0;
    player.pose = clamp(Math.trunc(msg.pose as number), 0, POSE_COUNT - 1);
    // Clamped, never stored raw: an out-of-range value would be handed to every
    // client, which reads it as a surface to lie against. Chameleons only,
    // because clinging is what silences your footsteps for everyone else — a
    // hunter who could set it would simply hunt without making a sound.
    player.cling =
      player.role === "chameleon"
        ? clamp(Math.trunc(msg.cling as number), CLING_NONE, CLING_CEILING)
        : CLING_NONE;
    // `=== true` rather than a cast: anything else off the wire — a string, a
    // number, undefined — is a body that lies flat, which is the default.
    player.upright = msg.upright === true;
  });

  // Paint is cosmetic and self-applied: it is stored on the painter and
  // relayed to everyone else, who already have the same brush code.
  room.onMessage(toServer.paint, (client: Client, msg: PaintMsg) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || !Array.isArray(msg?.strokes)) return;

    const strokes = (msg.strokes as unknown[])
      .filter((s): s is string => typeof s === "string" && s.length <= MAX_STROKE_LENGTH)
      .slice(0, MAX_STROKE_BATCH);
    if (!strokes.length) return;

    for (const stroke of strokes) player.strokes.push(stroke);
    const overflow = player.strokes.length - MAX_STROKES;
    if (overflow > 0) player.strokes.splice(0, overflow);

    room.broadcast(toClient.paint, { id: client.sessionId, strokes }, { except: client });
  });

  // A catch, called by the hunter who made it — the same trust model as movement.
  room.onMessage(toServer.kill, (client: Client, msg: KillMsg) => {
    // Nobody is caught in the waiting room. Everyone there is armed — that is
    // what a lobby *is* — and being converted while queuing for a game you
    // have not started would be nonsense. The shot still bangs and still marks
    // the wall; only the consequence is withheld.
    if (room.isLobby) return;
    // The round is decided. The reveal is a thirty-second look at where
    // everybody was, not extra time.
    if (room.state.phase !== "hunt") return;

    const shooter = room.state.players.get(client.sessionId);
    const victimId = String(msg?.id ?? "");
    const victim = room.state.players.get(victimId);
    if (
      !shooter ||
      shooter.role !== "hunter" ||
      !victim ||
      // A hunter cannot catch a hunter, which also makes this safe to send
      // twice: the second one finds a victim who has already converted.
      victim.role !== "chameleon" ||
      victimId === client.sessionId
    ) {
      return;
    }
    if (!canFire(client.sessionId)) return;

    // Where the shooter says they found them, falling back to where the victim
    // actually is — a clamped NaN would bury everybody in the middle of the map.
    const [x, y, z] = point(msg.position, mapLimit(room.state.map)) ?? [
      victim.x,
      victim.y,
      victim.z,
    ];

    // Where somebody was found, and who. The name rides along so the reveal
    // can label the spot rather than showing anonymous markers.
    room.state.graves.push(
      [x.toFixed(2), y.toFixed(2), z.toFixed(2), victim.name].join(","),
    );
    if (room.state.graves.length > MAX_GRAVES) {
      room.state.graves.splice(0, room.state.graves.length - MAX_GRAVES);
    }

    // The conversion itself.
    victim.role = "hunter";
    victim.cling = CLING_NONE;
    victim.pose = 0;
    victim.strokes.clear();
    room.broadcast(toClient.clearSkin, { id: victimId });

    // A catching shot is still a shot: it makes the same bang as one that hit
    // a wall, and it is the only bang for it, since this path relays no mark.
    room.broadcast(toClient.shot, { id: client.sessionId });
    room.broadcast(toClient.caught, { id: victimId, by: shooter.name, position: [x, y, z] });

    // The last one caught ends the round then and there.
    if (room.chameleonsLeft === 0) room.finish("hunters");
  });

  room.onMessage(toServer.clearSkin, (client: Client) => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    player.strokes.clear();
    room.broadcast(toClient.clearSkin, { id: client.sessionId }, { except: client });
  });

  // Marks are cosmetic and expire in three seconds, so they are bounded, relayed
  // and never stored. The bang is a separate broadcast: a mark is at the wall
  // the pellets hit, and a gunshot has to come from the gun.
  room.onMessage(toServer.shoot, (client: Client, msg: ShootMsg) => {
    if (!msg) return;

    // Bounded before the rate limit, so junk costs a spammer nothing and never
    // eats a real shot's turn.
    const limit = mapLimit(room.state.map);
    const position = point(msg.position, limit);
    const origin = point(msg.origin, limit);
    const rotation = angles(msg.rotation);
    if (!position || !origin || !rotation) return;

    if (!canFire(client.sessionId)) return;
    room.broadcast(toClient.mark, { id: randomUUID(), position, rotation, origin });
    room.broadcast(toClient.shot, { id: client.sessionId });
  });

  // A whistle is only a position given away, so it is relayed like a shot:
  // everyone hears it, at whoever let it out. Chameleons only — the mirror of the
  // kill check below, which refuses anyone who is not a hunter.
  room.onMessage(toServer.whistle, (client: Client) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || player.role !== "chameleon") return;
    const now = Date.now();
    if (now - (lastWhistle.get(client.sessionId) ?? 0) < MIN_WHISTLE_GAP_MS) return;
    lastWhistle.set(client.sessionId, now);
    room.broadcast(toClient.whistle, { id: client.sessionId });
  });

  /**
   * Chat is a waiting-room thing, and only a waiting-room thing.
   *
   * A match never carries it: during the hunt everyone who could type is out on
   * the map, and a channel between them is coordination against the one player
   * looking for them. The two lobby phases it *is* allowed in are the two where
   * nobody has a side yet — during `hiding` the lobby holds the drawn hunter
   * alone, and there is nobody to talk to and a log everyone will come back to.
   *
   * **Broadcast, and kept nowhere.** It used to live in room state so that
   * somebody arriving mid-conversation was handed it; a lobby is now a room you
   * can only hear while you are standing in it, and a latecomer starts on an
   * empty box. Nothing is stored, so there is no history to leak into the next
   * round either.
   */
  room.onMessage(toServer.chat, (client: Client, msg: ChatMsg) => {
    if (!room.isLobby) return;
    if (room.state.phase !== "waiting" && room.state.phase !== "countdown") return;

    const player = room.state.players.get(client.sessionId);
    if (!player || typeof msg?.text !== "string") return;

    // Control characters out before the length is measured, so padding a
    // message with them cannot push real text past the cap. Newlines are in
    // there too: one message is one line.
    const text = msg.text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
    if (!text) return;

    // After the trim, so the filter reads the same string everyone else will —
    // and masking never lengthens it past the cap, because a grawlix is one
    // character per character.
    const clean = cleanChat(text);

    const now = Date.now();
    if (now - (lastChat.get(client.sessionId) ?? 0) < CHAT_INTERVAL_MS) return;
    lastChat.set(client.sessionId, now);

    // To the sender too: nobody renders their own line locally, so this is the
    // one delivery and everyone in the room sees the same list in the same
    // order.
    room.broadcast(toClient.chat, { name: player.name, text: clean });
  });

  return { forget };
}
