/** The map ids, and nothing else. The order is the order every list shows. */
export const MAP_IDS = ["arena", "hospital", "dungeon"] as const;

export type MapId = (typeof MAP_IDS)[number];

/** What a room uses when nobody chose, or chose something this build lacks. */
export const DEFAULT_MAP: MapId = "arena";

/** The arena is not a map you pick — it is where every lobby waits. */
export const LOBBY_MAP: MapId = "arena";

/** The maps a match can actually be played on. */
export const MATCH_MAP_IDS = MAP_IDS.filter((id) => id !== LOBBY_MAP);

/**
 * What a match runs when nobody chose, or chose something this build lacks.
 *
 * **Named rather than taken from the head of `MATCH_MAP_IDS`.** The hospital
 * sits first there now, and it is in `DEV_ONLY_MAPS` — a production client that
 * fell back to the head of the list would be sent to a map its own menus refuse
 * to offer. The default has to be a map every build ships.
 */
export const DEFAULT_MATCH_MAP: MapId = "dungeon";
