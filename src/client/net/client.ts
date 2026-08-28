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

/** Ever-increasing, across rooms: a chat line's id is only ever a React key,
 *  and one that is never re-used cannot collide with a line still on screen. */
let chatSeq = 0;

/** Mirrors the Player schema declared in server/schema.ts. */
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

/**
 * A seat held for this client in another room. The server sends one per client
 * when a lobby starts, trimmed to what `consumeSeatReservation` reads.
 */
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

/** Open a lobby of your own. */
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

/** Join someone else's lobby by its invite code, which is its room id. */
export async function joinLobby(name: string, code: string) {
  return open((client) =>
    client.joinById(code.trim().toUpperCase(), { name, pid: playerId() }),
  );
}

/** Get back into a room you were in — after a drop, or after being shot. */
export async function rejoin(name: string, roomId: string) {
  const token = getToken();
  return open(async (client) => {
    if (token) {
      try {
        return await client.reconnect(token);
      } catch {
        // The window closed, or the seat was deleted. Go in as somebody new.
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
    // If the browser URL has an explicit port (e.g. http://noah-pick.de:3000 or http://localhost:3000),
    // use advertised game port if different (e.g. dev 2567), otherwise location.port.
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

/** Why a join was refused, as a sentence rather than a number. */
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
  /** Set only while we are waiting to be seated, and read by `onLeave`. */
  let rejectJoin: ((e: Error) => void) | null = null;

  setRoom(joined);
  // Captured now, while the room is healthy. After a drop there is no room left
  // to read it from, which is the only time it is any use.
  setToken(joined.reconnectionToken);

  // The room is untyped on this side, so the callback proxy is described by
  // the shape the server actually sends.
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

    // Whatever this player has already painted on themselves, replayed so a
    // late joiner does not see a blank body. This is also how paint survives
    // the trip out of a lobby: everyone re-sends theirs on arrival.
    player.strokes?.forEach((raw) => {
      const stroke = decodeStroke(raw);
      if (stroke) paint(sessionId, stroke);
    });

    // Mutate the existing target in place so the render loop keeps lerping
    // toward it instead of seeing a brand new object each patch.
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

  // Paint from everyone else. The server does not echo a player their own
  // strokes — those were already drawn locally as the brush moved.
  joined.onMessage(toClient.paint, (msg: { id: string; strokes: string[] }) => {
    if (!msg?.id || !Array.isArray(msg.strokes)) return;
    for (const raw of msg.strokes) {
      const stroke = decodeStroke(raw);
      if (stroke) paint(msg.id, stroke);
    }
  });

  // Graves are state, so this fires for the ones already there when you join
  // as well as for each new one.
  $(joined.state).graves.onAdd((raw, index) => {
    // "x,y,z,name" — the name may contain nothing dangerous but it may contain
    // anything else, so it is taken as the remainder rather than as field 4.
    const [sx, sy, sz, ...rest] = raw.split(",");
    const [x, y, z] = [sx, sy, sz].map(Number);
    if (![x, y, z].every(Number.isFinite)) return;
    emitGrave({
      id: `grave-${index}-${raw}`,
      position: [x, y, z],
      name: rest.join(",") || "someone",
    });
  });

  // Chat is a broadcast and nothing keeps it: there is no log on the server to
  // replay, so this room's conversation begins at the moment we walked in. The
  // rolling copy below is only what is on screen — it dies with the room.
  //
  // The *whole* list is emitted each time rather than the line that arrived,
  // because that is the shape the panel already takes and a whole list has no
  // ordering to reconcile.
  let lines: ChatMessage[] = [];
  joined.onMessage(toClient.chat, (msg: { name?: string; text?: string }) => {
    if (typeof msg?.text !== "string" || !msg.text) return;
    lines = [
      ...lines,
      {
        // A counter, not a position: the trim below shifts every index under
        // it, and a React key that moves between lines re-uses the wrong node.
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

  // The lobby has opened a match and is holding a seat in it for us.
  joined.onMessage(toClient.moveTo, (seat: Seat) => {
    void move(joined, seat);
  });

  joined.onMessage(toClient.moveFailed, (msg: { reason?: string }) => {
    emitMoveFailed(msg?.reason ?? "the match could not be reached");
  });

  joined.onLeave((code) => {
    /** Refused before we were ever seated. */
    if (rejectJoin) {
      setRoom(null);
      clearRemotes();
      emitLeftRoom();
      rejectJoin(new Error(refusal(code)));
      return;
    }

    // Every deliberate exit clears the room handle before it leaves — quitting,
    // dying, being handed to another room — so reaching here still holding it
    // means nobody asked for this. Two consequences: do not wipe the room we
    // have just arrived in, and do tell somebody that the socket died.
    if (getRoom() !== joined) return;
    setRoom(null);
    clearRemotes();
    emitLeftRoom();
    emitDropped();
  });

  // The map, the host and the pending map all live in state, so they are read
  // from a patch rather than returned once: the host can change the map while
  // people arrive, and the Start button changes hands when its owner leaves.
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

  /** Wait for the room to have said who we are before handing it back. */
  const seated = () => {
    const state = joined.state as StateSchema;
    return Boolean(state.map) && Boolean(state.players?.get(joined.sessionId));
  };
  if (!seated()) {
    /** Closed before we could listen. */
    if (!joined.connection.isOpen) {
      setRoom(null);
      clearRemotes();
      throw new Error(refusal());
    }

    try {
      await new Promise<void>((resolve, reject) => {
        // Armed for exactly as long as the wait lasts. Cleared in the `finally`,
        // so a socket that dies *after* we are seated is a drop again — which is
        // the ordinary case and wants the reconnect panel, not an error on a
        // menu the player has long since left.
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
    // The room's answer, not the player's — this is where a hunter finds out
    // they are one.
    role: state.players?.get(room.sessionId)?.role === "hunter" ? "hunter" : "chameleon",
    map: state.map ?? "",
    nextMap: state.nextMap ?? state.map ?? "",
    code: room.roomId,
    isHost: state.hostId === room.sessionId,
    isListed: state.listed === true,
    lobbyCode: state.lobby ?? "",
    timeLeft: state.timeLeft ?? 0,
    // Anything the server has not spelled is treated as the quiet case: a room
    // still waiting, with nobody in it, rather than a room mid-countdown.
    phase: PHASES.includes(state.phase as Phase) ? (state.phase as Phase) : "waiting",
    maxPlayers: state.maxPlayers ?? 0,
    winner: state.winner ?? "",
    playerCount: state.players?.size ?? 0,
  };
}

/** The phases a room may claim to be in. Anything else is treated as waiting. */
const PHASES: Phase[] = ["waiting", "countdown", "hiding", "hunt", "reveal"];

/** Take the seat the lobby reserved for us in its match. */
async function move(from: Room, seat: Seat) {
  const client = getClient();
  if (!client || getRoom() !== from) return;

  try {
    const next = await client.consumeSeatReservation(seat);
    clearRemotes();
    // Before `attach`, never after: the new room replays its graves during it,
    // and every listener clearing room-scoped state hangs off this.
    emitLeftRoom();
    await attach(next);
    void from.leave();
    // Announced only once the new room is wired, so a listener acting on it is
    // looking at the room we actually landed in.
    emitMoved();
  } catch (e) {
    emitMoveFailed(e instanceof Error ? e.message : "could not enter the match");
  }
}

export async function disconnect() {
  const leaving = getRoom();
  setRoom(null);
  setClient(null);
  // A deliberate exit gives up the seat, so the token that would have reclaimed
  // it is worthless. `rejoin` reads it *before* calling this, which is what lets
  // a reconnect still work.
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
