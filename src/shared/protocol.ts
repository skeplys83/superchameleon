
export type Role = "chameleon" | "hunter";

export type Phase = "waiting" | "countdown" | "hiding" | "hunt" | "reveal";

// Split by direction: four names (paint/chat/whistle/clearSkin) appear both
// ways with different payloads. Both ends destructure this; no string literal
// under src/ names a message.
export const MESSAGES = {
  toServer: {
    state: "state",
    paint: "paint",
    clearSkin: "clearSkin",
    kill: "kill",
    shoot: "shoot",
    whistle: "whistle",
    chat: "chat",
    start: "start",
    setMap: "setMap",
  },
  toClient: {
    paint: "paint",
    clearSkin: "clearSkin",
    shot: "shot",
    mark: "mark",
    caught: "caught",
    whistle: "whistle",
    chat: "chat",
    moveTo: "moveTo",
    moveFailed: "moveFailed",
  },
} as const;

export type ClientMessage = keyof typeof MESSAGES.toServer;

export type ServerMessage = keyof typeof MESSAGES.toClient;

export const ROOM_HALF = 20;

// Ordered so `cling !== CLING_NONE` still means "is clinging".
export const CLING_NONE = 0;
export const CLING_WALL = 1;
export const CLING_CEILING = 2;

export const ROOM_LIMIT = 19.9;

export const POSE_COUNT = 5;

export const MAX_STROKES = 1500;

export const FIRE_INTERVAL_MS = 800;

// Slack the server gives the client's clock.
export const FIRE_INTERVAL_TOLERANCE = 0.85;

export const WHISTLE_INTERVAL_MS = 45_000;

export const WHISTLE_TOLERANCE = 0.8;

export const MAX_STROKE_BATCH = 64;

// encodeStroke produces ~30 chars; anything longer is not a stroke.
export const MAX_STROKE_LENGTH = 40;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const DEFAULT_PLAYERS = 8;

export const COUNTDOWN_SECONDS = 5;

export const HIDE_SECONDS = 40;

export const REVEAL_SECONDS = 20;

export const HUNT_URGENT_SECONDS = 30;

export const MUSIC_DELAY_MS = 5000;

export const GONG_STRIKES = 3;
export const GONG_GAP_MS = 220;
export const GONG_FALLOFF = 0.75;

export const LEAVE_IN_PROGRESS = 4001;

export const LEAVE_STARTING = 4002;

// Chat is a broadcast; the server keeps none of it.
export const CHAT_HISTORY = 30;

export const MAX_CHAT_LENGTH = 140;

export const CHAT_INTERVAL_MS = 700;
