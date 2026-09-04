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

// Non-finite → 0. NaN would otherwise poison the state.
export const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;

const TAU = Math.PI * 2;

// Refuse NaN outright — clamp alone would turn an all-NaN position into the
// middle of the map.
const vec3 = (raw: unknown): [number, number, number] | null => {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw as unknown[];
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [x as number, y as number, z as number];
};

const point = (raw: unknown, limit: number): [number, number, number] | null => {
  const v = vec3(raw);
  return v && [clamp(v[0], -limit, limit), clamp(v[1], -5, 30), clamp(v[2], -limit, limit)];
};

const angles = (raw: unknown): [number, number, number] | null => {
  const v = vec3(raw);
  return v && [clamp(v[0], -TAU, TAU), clamp(v[1], -TAU, TAU), clamp(v[2], -TAU, TAU)];
};

const MIN_FIRE_GAP_MS = FIRE_INTERVAL_MS * FIRE_INTERVAL_TOLERANCE;
const MIN_WHISTLE_GAP_MS = WHISTLE_INTERVAL_MS * WHISTLE_TOLERANCE;

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

export function registerMessages(room: GameRoom) {
  const lastShot = new Map<string, number>();
  const lastWhistle = new Map<string, number>();
  const lastChat = new Map<string, number>();

  const canFire = (sessionId: string) => {
    const now = Date.now();
    if (now - (lastShot.get(sessionId) ?? 0) < MIN_FIRE_GAP_MS) return false;
    lastShot.set(sessionId, now);
    return true;
  };

  const forget = (sessionId: string) => {
    lastShot.delete(sessionId);
    lastWhistle.delete(sessionId);
    lastChat.delete(sessionId);
  };

  room.onMessage(toServer.state, (client: Client, msg: StateMsg) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || !msg) return;
    const [x, y, z] = Array.isArray(msg.p) ? (msg.p as number[]) : [0, 0, 0];
    // Per-map: dungeon 52, lobby 34 — one global bound amputated whichever was bigger.
    const limit = mapLimit(room.state.map);
    player.x = clamp(x, -limit, limit);
    player.y = clamp(y, -5, 30);
    player.z = clamp(z, -limit, limit);
    player.yaw = Number.isFinite(msg.yaw) ? (msg.yaw as number) : 0;
    player.pitch = Number.isFinite(msg.pitch) ? (msg.pitch as number) : 0;
    player.pose = clamp(Math.trunc(msg.pose as number), 0, POSE_COUNT - 1);
    // Hunters get CLING_NONE — clinging silences footsteps.
    player.cling =
      player.role === "chameleon"
        ? clamp(Math.trunc(msg.cling as number), CLING_NONE, CLING_CEILING)
        : CLING_NONE;
    // === true rather than a cast: anything else off the wire is the default (lying).
    player.upright = msg.upright === true;
  });

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

  room.onMessage(toServer.kill, (client: Client, msg: KillMsg) => {
    // No catches in the lobby (everyone is armed there) or in reveal.
    if (room.isLobby) return;
    if (room.state.phase !== "hunt") return;

    const shooter = room.state.players.get(client.sessionId);
    const victimId = String(msg?.id ?? "");
    const victim = room.state.players.get(victimId);
    if (
      !shooter ||
      shooter.role !== "hunter" ||
      !victim ||
      // Hunter-on-hunter → also makes double-kill safe.
      victim.role !== "chameleon" ||
      victimId === client.sessionId
    ) {
      return;
    }
    if (!canFire(client.sessionId)) return;

    // Shooter's word, falling back to victim's own position — a clamped NaN
    // would bury everybody in the middle of the map.
    const [x, y, z] = point(msg.position, mapLimit(room.state.map)) ?? [
      victim.x,
      victim.y,
      victim.z,
    ];

    room.state.graves.push(
      [x.toFixed(2), y.toFixed(2), z.toFixed(2), victim.name].join(","),
    );
    if (room.state.graves.length > MAX_GRAVES) {
      room.state.graves.splice(0, room.state.graves.length - MAX_GRAVES);
    }

    victim.role = "hunter";
    victim.cling = CLING_NONE;
    victim.pose = 0;
    victim.strokes.clear();
    room.broadcast(toClient.clearSkin, { id: victimId });

    // A catching shot is still a shot: the only bang for it, since this path
    // relays no mark.
    room.broadcast(toClient.shot, { id: client.sessionId });
    room.broadcast(toClient.caught, { id: victimId, by: shooter.name, position: [x, y, z] });

    if (room.chameleonsLeft === 0) room.finish("hunters");
  });

  room.onMessage(toServer.clearSkin, (client: Client) => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;
    player.strokes.clear();
    room.broadcast(toClient.clearSkin, { id: client.sessionId }, { except: client });
  });

  room.onMessage(toServer.shoot, (client: Client, msg: ShootMsg) => {
    if (!msg) return;

    // Bounded before rate-limit so junk costs nothing.
    const limit = mapLimit(room.state.map);
    const position = point(msg.position, limit);
    const origin = point(msg.origin, limit);
    const rotation = angles(msg.rotation);
    if (!position || !origin || !rotation) return;

    if (!canFire(client.sessionId)) return;
    room.broadcast(toClient.mark, { id: randomUUID(), position, rotation, origin });
    room.broadcast(toClient.shot, { id: client.sessionId });
  });

  room.onMessage(toServer.whistle, (client: Client) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || player.role !== "chameleon") return;
    const now = Date.now();
    if (now - (lastWhistle.get(client.sessionId) ?? 0) < MIN_WHISTLE_GAP_MS) return;
    lastWhistle.set(client.sessionId, now);
    room.broadcast(toClient.whistle, { id: client.sessionId });
  });

  // Chat: lobby only, waiting/countdown only, broadcast, kept nowhere.
  room.onMessage(toServer.chat, (client: Client, msg: ChatMsg) => {
    if (!room.isLobby) return;
    if (room.state.phase !== "waiting" && room.state.phase !== "countdown") return;

    const player = room.state.players.get(client.sessionId);
    if (!player || typeof msg?.text !== "string") return;

    // Control chars out before length is measured — padding cannot push real
    // text past the cap.
    const text = msg.text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
    if (!text) return;

    const clean = cleanChat(text);

    const now = Date.now();
    if (now - (lastChat.get(client.sessionId) ?? 0) < CHAT_INTERVAL_MS) return;
    lastChat.set(client.sessionId, now);

    // To the sender too — nobody renders their own line locally.
    room.broadcast(toClient.chat, { name: player.name, text: clean });
  });

  return { forget };
}
