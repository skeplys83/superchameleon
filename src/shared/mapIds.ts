// Order is the order every list shows.
export const MAP_IDS = ["lobby", "hospital", "dungeon"] as const;

export type MapId = (typeof MAP_IDS)[number];

export const DEFAULT_MAP: MapId = "lobby";

export const LOBBY_MAP: MapId = "lobby";

export const MATCH_MAP_IDS = MAP_IDS.filter((id) => id !== LOBBY_MAP);

// Named, not taken from the head of MATCH_MAP_IDS — that order is for display.
export const DEFAULT_MATCH_MAP: MapId = "hospital";
