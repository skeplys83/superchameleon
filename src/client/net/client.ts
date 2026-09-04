import { Client, getStateCallbacks, type Room } from "colyseus.js";
import {
  CHAT_HISTORY,
  MESSAGES,
  LEAVE_IN_PROGRESS,
  LEAVE_STARTING,
  type Phase,
  type Role,
} from "@/shared/protocol";
import { clearSkin, decodeStroke, forgetSkin, paint } from "@/client/paint/skin";
import { getClient, getRoom, getToken, setClient, setRoom, setToken } from "./connection";
import { playerId } from "./identity";
import { clearRemotes, emitRoster, remotes } from "./remotes";
import {
  emitCaught,
  emitChat,
  emitGrave,
  emitLeftRoom,
  emitMark,
  emitDropped,
  emitMoved,
  emitMoveFailed,
  emitRoom,
  emitShot,
  emitWhistle,
  type ChatMessage,
  type NetMark,
  type RoomInfo,
} from "./events";
import { getAdvertisedGamePort } from "./sessions";

const { toClient } = MESSAGES;

// Ever-increasing so a React key cannot collide with a line still on screen.
let chatSeq = 0;

type PlayerSchema = {
  name: string;
  role: Role;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  pose: number;
  cling: number;
  upright: boolean;
  strokes: { forEach(cb: (raw: string) => void): void };
};

type StateSchema = {
  map?: string;
  mode?: string;
  nextMap?: string;
  hostId?: string;
  listed?: boolean;
  lobby?: string;
  timeLeft?: number;
  phase?: string;
  winner?: string;
  maxPlayers?: number;
  players?: { get(id: string): PlayerSchema | undefined; size?: number };
};

type Callbacks = {
  players: {
    onAdd(cb: (player: PlayerSchema, sessionId: string) => void): void;
    onRemove(cb: (player: PlayerSchema, sessionId: string) => void): void;
  };
  graves: {
    onAdd(cb: (raw: string, index: number) => void): void;
  };
  onChange(cb: () => void): void;
};

type Seat = {
  sessionId: string;
  room: {
    roomId: string;
    name: string;
    publicAddress?: string;
    clients: number;
    maxClients: number;
  };
};

export async function createLobby(
  name: string,
  map: string,
  listed: boolean,
  maxPlayers: number,
) {
  return open((client) =>
    client.create("lobby", { name, map, listed, maxPlayers, pid: playerId() }),
  );
}

export async function joinLobby(name: string, code: string) {
  return open((client) =>
    client.joinById(code.trim().toUpperCase(), { name, pid: playerId() }),
  );
}

export async function rejoin(name: string, roomId: string) {
  const token = getToken();
  return open(async (client) => {
    if (token) {
      try {
        return await client.reconnect(token);
      } catch {
        // Window closed or seat deleted — go in as somebody new.
      }
    }
    return client.joinById(roomId, { name, pid: playerId() });
  });
}

async function open(join: (client: Client) => Promise<Room>) {
  await disconnect();
  const isHttps = location.protocol === "https:";
  const proto = isHttps ? "wss:" : "ws:";

  const advertised = getAdvertisedGamePort();
  let portStr = "";
  if (location.port) {
    const p =
      advertised && advertised !== Number(location.port) && !isHttps
        ? advertised
        : location.port;
    portStr = `:${p}`;
  } else if (advertised && advertised !== (isHttps ? 443 : 80) && advertised !== 3000) {
    portStr = `:${advertised}`;
  }

  const client = new Client(`${proto}//${location.hostname}${portStr}`);
  setClient(client);
  const joined = await join(client);
  return attach(joined);
}

function refusal(code?: number) {
  if (code === LEAVE_STARTING) {
    return "That game is starting — it will take players again once the round is over.";
  }
  if (code === LEAVE_IN_PROGRESS) {
    return "That game has a round in progress. Try again when it finishes.";
  }
  return "The server closed the connection.";
}

async function attach(joined: Room): Promise<RoomInfo> {
  let rejectJoin: ((e: Error) => void) | null = null;

  setRoom(joined);
  // Captured now: after a drop there is no room to read it from.
  setToken(joined.reconnectionToken);

  const $ = getStateCallbacks(joined) as unknown as (target: unknown) => Callbacks;

  $(joined.state).players.onAdd((player, sessionId) => {
    if (sessionId === joined.sessionId) return;

    remotes.set(sessionId, {
      id: sessionId,
      name: player.name,
      role: player.role,
      target: {
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch,
        pose: player.pose,
        cling: player.cling,
        upright: player.upright,
      },
    });
    emitRoster();

    // Replays this player's paint on join — also how paint survives the trip
    // out of a lobby.
    player.strokes?.forEach((raw) => {
      const stroke = decodeStroke(raw);
      if (stroke) paint(sessionId, stroke);
    });

    // Mutate in place so the render loop keeps lerping.
    $(player).onChange(() => {
      const remote = remotes.get(sessionId);
      if (!remote) return;
      remote.target.x = player.x;
      remote.target.y = player.y;
      remote.target.z = player.z;
      remote.target.yaw = player.yaw;
      remote.target.pitch = player.pitch;
      remote.target.pose = player.pose;
      remote.target.cling = player.cling;
      remote.target.upright = player.upright;
    });
  });

  $(joined.state).players.onRemove((_player, sessionId) => {
    forgetSkin(sessionId);
    if (remotes.delete(sessionId)) emitRoster();
  });

  joined.onMessage(toClient.paint, (msg: { id: string; strokes: string[] }) => {
    if (!msg?.id || !Array.isArray(msg.strokes)) return;
    for (const raw of msg.strokes) {
      const stroke = decodeStroke(raw);
      if (stroke) paint(msg.id, stroke);
    }
  });

  // Graves are state — fires for existing ones on join too.
  $(joined.state).graves.onAdd((raw, index) => {
    // "x,y,z,name" — name may contain commas, so take it as the remainder.
    const [sx, sy, sz, ...rest] = raw.split(",");
    const [x, y, z] = [sx, sy, sz].map(Number);
    if (![x, y, z].every(Number.isFinite)) return;
    emitGrave({
      id: `grave-${index}-${raw}`,
      position: [x, y, z],
      name: rest.join(",") || "someone",
    });
  });

  // Chat: broadcast, kept nowhere on the server. This rolling list is what's
  // on screen and dies with the room. Whole list is emitted each time.
  let lines: ChatMessage[] = [];
  joined.onMessage(toClient.chat, (msg: { name?: string; text?: string }) => {
    if (typeof msg?.text !== "string" || !msg.text) return;
    lines = [
      ...lines,
      {
        // Counter, not a position — a trim would shift positions.
        id: String(chatSeq++),
        name: typeof msg.name === "string" && msg.name ? msg.name : "someone",
        text: msg.text,
      },
    ].slice(-CHAT_HISTORY);
    emitChat(lines);
  });

  joined.onMessage(toClient.shot, (msg: { id: string }) => {
    if (msg?.id) emitShot(msg.id);
  });

  joined.onMessage(toClient.whistle, (msg: { id: string }) => {
    if (msg?.id) emitWhistle(msg.id);
  });

  joined.onMessage(
    toClient.caught,
    (msg: { id: string; by: string; position?: [number, number, number] }) => {
      if (!msg?.id) return;
      emitCaught(msg.id, msg.by ?? "a hunter", msg.position);
    },
  );

  joined.onMessage(toClient.clearSkin, (msg: { id: string }) => {
    if (msg?.id) clearSkin(msg.id);
  });

  joined.onMessage(toClient.mark, (mark: NetMark) => {
    emitMark(mark);
  });

  joined.onMessage(toClient.moveTo, (seat: Seat) => {
    void move(joined, seat);
  });

  joined.onMessage(toClient.moveFailed, (msg: { reason?: string }) => {
    emitMoveFailed(msg?.reason ?? "the match could not be reached");
  });

  joined.onLeave((code) => {
    if (rejectJoin) {
      setRoom(null);
      clearRemotes();
      emitLeftRoom();
      rejectJoin(new Error(refusal(code)));
      return;
    }

    // Every deliberate exit clears the room handle first; reaching here still
    // holding it means the socket died.
    if (getRoom() !== joined) return;
    setRoom(null);
    clearRemotes();
    emitLeftRoom();
    emitDropped();
  });

  let last = "";
  const publish = () => {
    const info = describe(joined);
    const key = [
      info.mode,
      info.role,
      info.map,
      info.nextMap,
      info.code,
      info.isHost,
      info.isListed,
      info.lobbyCode,
      info.timeLeft,
      info.phase,
      info.maxPlayers,
      info.playerCount,
      info.winner,
    ].join("|");
    if (key === last) return;
    last = key;
    emitRoom(info);
  };
  joined.onStateChange(publish);

  const seated = () => {
    const state = joined.state as StateSchema;
    return Boolean(state.map) && Boolean(state.players?.get(joined.sessionId));
  };
  if (!seated()) {
    if (!joined.connection.isOpen) {
      setRoom(null);
      clearRemotes();
      throw new Error(refusal());
    }

    try {
      await new Promise<void>((resolve, reject) => {
        // Armed only for the wait — a later socket death is a drop.
        rejectJoin = reject;
        const check = () => {
          if (!seated()) return;
          joined.onStateChange.remove(check);
          resolve();
        };
        joined.onStateChange(check);
      });
    } finally {
      rejectJoin = null;
    }
  }
  publish();
  return describe(joined);
}

function describe(room: Room): RoomInfo {
  const state = room.state as StateSchema;
  return {
    mode: state.mode === "match" ? "match" : "lobby",
    // Server's answer, not the player's.
    role: state.players?.get(room.sessionId)?.role === "hunter" ? "hunter" : "chameleon",
    map: state.map ?? "",
    nextMap: state.nextMap ?? state.map ?? "",
    code: room.roomId,
    isHost: state.hostId === room.sessionId,
    isListed: state.listed === true,
    lobbyCode: state.lobby ?? "",
    timeLeft: state.timeLeft ?? 0,
    phase: PHASES.includes(state.phase as Phase) ? (state.phase as Phase) : "waiting",
    maxPlayers: state.maxPlayers ?? 0,
    winner: state.winner ?? "",
    playerCount: state.players?.size ?? 0,
  };
}

const PHASES: Phase[] = ["waiting", "countdown", "hiding", "hunt", "reveal"];

async function move(from: Room, seat: Seat) {
  const client = getClient();
  if (!client || getRoom() !== from) return;

  try {
    const next = await client.consumeSeatReservation(seat);
    clearRemotes();
    // Before attach — the new room replays graves during it.
    emitLeftRoom();
    await attach(next);
    void from.leave();
    // After wiring, so a listener acting on this looks at the new room.
    emitMoved();
  } catch (e) {
    emitMoveFailed(e instanceof Error ? e.message : "could not enter the match");
  }
}

export async function disconnect() {
  const leaving = getRoom();
  setRoom(null);
  setClient(null);
  // rejoin reads the token BEFORE calling this.
  setToken(null);
  if (leaving) {
    try {
      await leaving.leave();
    } catch {
      // already gone
    }
  }
  clearRemotes();
  emitLeftRoom();
}
