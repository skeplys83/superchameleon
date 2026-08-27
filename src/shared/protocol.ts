
/**
 * Which side you are on. It is protocol, not decoration: the server stores it in
 * schema and checks it before honouring a kill.
 */
export type Role = "chameleon" | "hunter";

/** What a room is doing right now, as opposed to which kind of room it is. */
export type Phase = "waiting" | "countdown" | "hiding" | "hunt" | "reveal";

/**
 * Every message name that crosses the wire, in one table.
 *
 * The names used to be bare string literals at both ends — `send("shoot")` in
 * `client/net/send.ts` and `onMessage("shoot")` in `server/messages.ts`, with
 * nothing between them. A rename on one side left the other sending into a room
 * with no handler: no type error, no failing test, just a feature that quietly
 * stopped happening. Everything else in the protocol lives here, so these do
 * too, and both ends now break at compile time instead.
 *
 * **Split by direction, because four names appear in both.** `paint`, `chat`,
 * `whistle` and `clearSkin` travel each way with different payloads — upstream
 * they are a request from one player, downstream they are the room telling
 * everybody what happened. Colyseus keeps the two directions in separate
 * namespaces, so this is a real distinction and not a naming accident.
 */
export const MESSAGES = {
  /** client → server. What a player may ask for. */
  toServer: {
    /** Position, look, pose and cling, every frame. */
    state: "state",
    /** A batch of encoded brush strokes. */
    paint: "paint",
    /** Wipe my own skin back to white. */
    clearSkin: "clearSkin",
    /** I hit somebody. Honoured only from a hunter, in a match, during `hunt`. */
    kill: "kill",
    /** I pulled the trigger — relayed as `shot` plus a `mark`. */
    shoot: "shoot",
    /** I whistled. Chameleons only. */
    whistle: "whistle",
    /** Say something. Lobby only, and only before a round is underway. */
    chat: "chat",
    /** Begin the countdown. Host only. */
    start: "start",
    /** Choose the map the next round runs on. Host only. */
    setMap: "setMap",
  },
  /** server → client. What the room tells you. */
  toClient: {
    /** Somebody else's strokes. Never echoed to the painter. */
    paint: "paint",
    /** Somebody's skin went back to white. */
    clearSkin: "clearSkin",
    /** A gun went off, at this player. Separate from `mark`: the bang comes
     *  from the gun and the hole is over at the wall. */
    shot: "shot",
    /** Where the pellets landed. Cosmetic, expires client-side, never stored. */
    mark: "mark",
    /** A chameleon was caught and is a hunter now. */
    caught: "caught",
    /** Somebody whistled, at this player. */
    whistle: "whistle",
    /** One line of lobby chat. Sent to the speaker too. */
    chat: "chat",
    /** A seat is held for you in another room; go there. */
    moveTo: "moveTo",
    /** It could not be held, and here is why. */
    moveFailed: "moveFailed",
  },
} as const;

/** What a client may send. */
export type ClientMessage = keyof typeof MESSAGES.toServer;

/** What a client may receive. */
export type ServerMessage = keyof typeof MESSAGES.toClient;

/** Half-extent of the arena interior. `world/Room.tsx` builds the shell from it. */
export const ROOM_HALF = 20;

/**
 * What a chameleon is stuck to, and therefore which way up they are drawn.
 *
 * It replaced a boolean because the figure needs three answers where the
 * footsteps only needed two: a pose that lies flat lies flat on a floor and on
 * a ceiling, and stands up to climb a wall. Ordered so `cling !== CLING_NONE`
 * is still "is clinging", which is all `sound/` ever asks.
 */
export const CLING_NONE = 0;
export const CLING_WALL = 1;
export const CLING_CEILING = 2;

/** How far out the server lets a player claim to be. */
export const ROOM_LIMIT = 19.9;

/**
 * How many poses exist. `figure/poses.ts` holds the actual table and throws on
 * import if its length disagrees with this, so the two can never drift.
 */
export const POSE_COUNT = 5;

export const MAX_STROKES = 1500;

/** Minimum gap between two shots, in milliseconds. */
export const FIRE_INTERVAL_MS = 800;

/** How much slack the server gives the client's clock. */
export const FIRE_INTERVAL_TOLERANCE = 0.85;

/** How often each player whistles, from the moment they join. */
export const WHISTLE_INTERVAL_MS = 45_000;

/** Slack on the whistle rate, for the same clock-jitter reason as firing. */
export const WHISTLE_TOLERANCE = 0.8;

/** Most strokes the server will take from a single `paint` message. */
export const MAX_STROKE_BATCH = 64;

/**
 * Longest encoded stroke the server will accept. `encodeStroke` in
 * `paint/skin.ts` produces about 30 characters; anything longer is not a stroke.
 */
export const MAX_STROKE_LENGTH = 40;

/** The hard bounds on a lobby's size — not the size of any given lobby. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/** How long the lobby counts down before a round begins. */
export const COUNTDOWN_SECONDS = 5;

/** How long the chameleons get on the map before the hunter is let in. */
export const HIDE_SECONDS = 40;

export const REVEAL_SECONDS = 20;

/** The closing stretch of a hunt: the clock turns red and the tick starts. */
export const HUNT_URGENT_SECONDS = 30;

/** How long after the bell the music starts. */
export const MUSIC_DELAY_MS = 5000;

/** How many times the gong strikes when a round is decided, and how far apart. */
export const GONG_STRIKES = 3;
export const GONG_GAP_MS = 220;
/** How much quieter each strike is than the one before it. */
export const GONG_FALLOFF = 0.75;

/** A round is running in this game, and you were not part of it. */
export const LEAVE_IN_PROGRESS = 4001;

/** This lobby is already counting down. */
export const LEAVE_STARTING = 4002;

/** How many lines of lobby chat a client keeps on screen. Nothing is kept on
 *  the server — chat is a broadcast, and a latecomer is handed none of it. */
export const CHAT_HISTORY = 30;

/** Longest message the server will take. */
export const MAX_CHAT_LENGTH = 140;

/** Minimum gap between two messages from one client, in milliseconds. */
export const CHAT_INTERVAL_MS = 700;
