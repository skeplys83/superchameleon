/** The map ids, and nothing else. The order is the order every list shows. */
export const MAP_IDS = ["lobby", "hospital", "dungeon"] as const;

export type MapId = (typeof MAP_IDS)[number];

/** What a room uses when nobody chose, or chose something this build lacks. */
export const DEFAULT_MAP: MapId = "lobby";

/** Not a map you pick — it is where every lobby waits. */
export const LOBBY_MAP: MapId = "lobby";

/** The maps a match can actually be played on. */
export const MATCH_MAP_IDS = MAP_IDS.filter((id) => id !== LOBBY_MAP);

/**
 * What a match runs when nobody chose, or chose something this build lacks.
 *
 * **Named rather than taken from the head of `MATCH_MAP_IDS`.** It is the head
 * today, but that order is a display order — where a map sits in the menu is a
 * decision about what a player sees first, not about where an unspecified match
 * ends up, and the two drifting apart should take an edit rather than happen by
 * itself. The default also has to be a map every build ships, which the head of
 * the list is not guaranteed to be.
 */
export const DEFAULT_MATCH_MAP: MapId = "hospital";
