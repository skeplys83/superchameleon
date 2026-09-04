import { ROOM_HALF, ROOM_LIMIT } from "./protocol.ts";
import {
  DEFAULT_MAP,
  DEFAULT_MATCH_MAP,
  LOBBY_MAP,
  MAP_IDS,
  MATCH_MAP_IDS,
  type MapId,
} from "./mapIds.ts";

export { DEFAULT_MAP, DEFAULT_MATCH_MAP, LOBBY_MAP, type MapId };

export type ToneMappingName =
  | "NoToneMapping"
  | "LinearToneMapping"
  | "ReinhardToneMapping"
  | "CineonToneMapping"
  | "ACESFilmicToneMapping"
  | "AgXToneMapping"
  | "NeutralToneMapping";

export type ShadowMapTypeName =
  | "BasicShadowMap"
  | "PCFShadowMap"
  | "PCFSoftShadowMap"
  | "VSMShadowMap";

export type OutputColorSpaceName =
  | "NoColorSpace"
  | "SRGBColorSpace"
  | "LinearSRGBColorSpace";

export type LightOptions = {
  scale?: number;
  decay?: number;
  distance?: number;
  shadow?: {
    // Set → every lamp is a candidate and the budget follows the camera.
    // Unset → only `shadow_`-named lamps cast.
    budget?: number;
    intensity?: number;
    radius?: number;
    blurSamples?: number;
    bias?: number;
    normalBias?: number;
    mapSize?: number;
    exclude?: string[];
  };
  ambient?: { color?: string; intensity: number };
  hemisphere?: { sky?: string; ground?: string; intensity: number };
};

export type MapRenderConfig = {
  lights?: LightOptions;
  // Rough 1, no metalness. A glossy surface has no one colour to match.
  matte?: boolean;
  toneMapping?: ToneMappingName;
  exposure?: number;
  outputColorSpace?: OutputColorSpaceName;
  antialias?: boolean;
  dpr?: number | [number, number];
  shadows?: {
    enabled?: boolean;
    type?: ShadowMapTypeName;
  };
  fog?: { color: string; near: number; far: number } | null;
};

export type GameMap = {
  id: MapId;
  name: string;
  blurb: string;
  src: string;
  spawn: [number, number, number];
  bound: number;
  roundSeconds: number;
  sky: boolean;
  background: string;
  render: MapRenderConfig;
};

export const MAPS: Record<MapId, GameMap> = {
  lobby: {
    id: "lobby",
    name: "Lobby",
    blurb: "A stone cavern that closes over your head, and a walled ring with four doors.",
    src: "/maps/lobby.glb",
    spawn: [0, 2, 0],
    bound: 11,
    roundSeconds: 120,
    sky: false,
    background: "#05060a",
    render: {
      lights: {
        // Six lamps in a ring at the floor; hemisphere ground colour lights the
        // dome above (every boulder faces down).
        scale: 0.7,
        ambient: { color: "#8f9aa8", intensity: 0.24 },
        hemisphere: { sky: "#aab4c2", ground: "#4a5058", intensity: 0.18 },
        shadow: { budget: 1, mapSize: 1024, radius: 6, exclude: ["wall", "floor"] },
      },
      toneMapping: "NeutralToneMapping",
      exposure: 0.42,
      outputColorSpace: "SRGBColorSpace",
      antialias: true,
      dpr: [1, 1.5],
      shadows: { enabled: true, type: "PCFShadowMap" },
      fog: { color: "#05060a", near: 12, far: 40 },
    },
  },
  dungeon: {
    id: "dungeon",
    name: "Dungeon",
    blurb: "A double-height hall, four hallways out of it, and a corridor looping them.",
    src: "/maps/dungeon.glb",
    spawn: [0, 2, 0],
    bound: 36,
    roundSeconds: 300,
    sky: false,
    background: "#0b0b0f",
    render: {
      lights: {
        scale: 0.05,
        distance: 16,
        ambient: { intensity: 0.5, color: "#ffffff" },
      },
      toneMapping: "AgXToneMapping",
      exposure: 1.0,
      outputColorSpace: "SRGBColorSpace",
      antialias: true,
      dpr: [1, 1.5],
      shadows: { enabled: true, type: "PCFShadowMap" },
      fog: null,
    },
  },
  hospital: {
    id: "hospital",
    name: "Hospital",
    blurb: "An entrance hall, a waiting room, and two ward wings off double-height corridors.",
    src: "/maps/hospital.glb",
    spawn: [0, 3.2, 0],
    // Built on 2m grid × 1.6 — walls at 4m like the dungeon; collision reaches 44.
    bound: 45,
    roundSeconds: 240,
    sky: false,
    background: "#0b0f0d",
    render: {
      lights: {
        // 24 point lamps. Spots were tried and reverted — a spot's cone leaves
        // most of a room dark; the budget spends by lamp count instead.
        scale: 0.07,
        distance: 26,
        // Down from 0.3 to let shadows read. If a painted body reads as a
        // silhouette, raise this first.
        ambient: { intensity: 0.28, color: "#eaf2ee" },
        hemisphere: { sky: "#f2f7f4", ground: "#4c5a52", intensity: 0.1 },
        shadow: {
          budget: 3,
          intensity: 1.0,
          radius: 8,
          // mapSize must stay 1024: point light = cube = mapSize*4 × mapSize*2
          // — 4096×2048 at 1024 is already ~33 MB a lamp.
          // Shell (wall/floor/ceiling) receives but does not cast.
          exclude: ["wall", "floor", "ceiling"],
        },
      },
      matte: true,
      // Neutral over AgX — AgX's toe crushes a dim ward into a murky flat.
      toneMapping: "NeutralToneMapping",
      // Headroom — a clipped wall has no shading left to match.
      exposure: 0.7,
      outputColorSpace: "SRGBColorSpace",
      antialias: true,
      dpr: [1, 1.5],
      // Off: point lights = 6 passes each. Turn on once they are spots.
      // PCFShadowMap (not PCFSoftShadowMap): the soft variant is deprecated in
      // three 0.185; softness comes from shadow.radius.
      shadows: { enabled: false, type: "PCFShadowMap" },
      fog: null,
    },
  },
};

export const MAP_LIST: GameMap[] = MAP_IDS.map((id) => MAPS[id]);

export const MATCH_MAP_LIST: GameMap[] = MATCH_MAP_IDS.map((id) => MAPS[id]);

// Filters maps from the menu, not from the server (which cannot tell which
// build asked). Empty today.
export const DEV_ONLY_MAPS: ReadonlySet<MapId> = new Set<MapId>();

export const playableMaps = (dev: boolean): GameMap[] =>
  MATCH_MAP_LIST.filter((m) => dev || !DEV_ONLY_MAPS.has(m.id));

for (const id of MAP_IDS) {
  if (!MAPS[id]) throw new Error(`world/maps.ts has no entry for map id "${id}"`);
}

export function safeMapId(id: unknown): MapId {
  return typeof id === "string" && id in MAPS ? (id as MapId) : DEFAULT_MAP;
}

export const mapName = (id: unknown) => MAPS[safeMapId(id)].name;

export const mapSpawn = (id: unknown) => MAPS[safeMapId(id)].spawn;

export const mapRoundSeconds = (id: unknown) => MAPS[safeMapId(id)].roundSeconds;

const CHEAT_MARGIN = ROOM_HALF - ROOM_LIMIT;

export const mapLimit = (id: unknown) => MAPS[safeMapId(id)].bound - CHEAT_MARGIN;
