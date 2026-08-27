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
  /**
   * Flatten every material in the map: rough 1, no metalness, no MR maps.
   *
   * A specular highlight moves with the viewer, so a glossy surface has no one
   * colour for a chameleon to match — see `makeMatte` in `world/levelScene.ts`.
   */
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
  arena: {
    id: "arena",
    name: "Arena",
    blurb: "40×40, white, twenty-five pieces of cover. Nine painted to match a swatch.",
    src: "/maps/arena.glb",
    spawn: [0, 2, 0],
    bound: ROOM_HALF,
    roundSeconds: 120,
    sky: true,
    background: "#ffffff",
    render: {
      lights: {
        shadow: { intensity: 1.0, radius: 4, exclude: ["wall_", "floor"] },
        ambient: { intensity: 1.0, color: "#ffffff" },
      },
      toneMapping: "ACESFilmicToneMapping",
      exposure: 0.8,
      outputColorSpace: "SRGBColorSpace",
      antialias: true,
      dpr: [1, 1.5],
      shadows: { enabled: true, type: "PCFShadowMap" },
      fog: null,
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
    // Built on a 2 m grid, then scaled 1.6x so a wall is 4 m like the dungeon's —
    // collision now reaches 44, so the symmetric clamp has to clear it.
    bound: 45,
    roundSeconds: 240,
    sky: false,
    background: "#0b0f0d",
    render: {
      lights: {
        // 24 ceiling lamps, none casting: the map is lit by its own fixtures.
        // **The lamps do the lighting, and the fill only keeps the corners
        // readable.** It was the other way round, and flat fill is the one kind
        // of light that cannot help a chameleon: it is directionless, so it
        // multiplies albedo and nothing else. White walls went straight to 255
        // and stayed there while a painted body stayed dark, and neither showed
        // any form — so the two could never match, whatever the paint. Light
        // that *falls* on a surface lands on the body in front of it the same
        // way, which is what lets one sit inside the other's value range.
        scale: 0.07,
        distance: 26,
        // **The floor of the picture, and the reason it is this high.** A hunter
        // sees the world at `HUNT_DPR`, upscaled — blurring keeps low-frequency
        // contrast and throws away detail, so the one thing that survives it is
        // a body much darker than what it lies against. Lighting the shadows
        // rather than leaving them near black is what lets a painted chameleon
        // sit *inside* the wall's own value range instead of reading as a
        // silhouette cut out of it.
        ambient: { intensity: 0.3, color: "#eaf2ee" },
        // A little sky-over-ground on top, so a wall and the floor under it are
        // not the same flat value. Cheap, and it costs no contrast at the body.
        hemisphere: { sky: "#f2f7f4", ground: "#4c5a52", intensity: 0.18 },
      },
      // **Neutral rather than AgX.** AgX's toe crushes everything near black
      // into the same value, which is exactly the range a dim ward lives in —
      // it read as heavy and murky against the same scene in Blender. Neutral
      // holds the midtones where the lamps put them.
      // Every surface flat, so what a body has to match is an albedo and not a
      // sheen that changes with where the hunter is standing.
      matte: true,
      toneMapping: "NeutralToneMapping",
      // Headroom on purpose: a white ward wall has to land near 0.8, not clip at
      // 1.0. A clipped wall has no shading left to match, so anything in front
      // of it reads as a cut-out however well it is painted.
      exposure: 0.7,
      outputColorSpace: "SRGBColorSpace",
      antialias: true,
      dpr: [1, 1.5],
      shadows: { enabled: false },
      fog: null,
    },
  },
};

export const MAP_LIST: GameMap[] = MAP_IDS.map((id) => MAPS[id]);

export const MATCH_MAP_LIST: GameMap[] = MATCH_MAP_IDS.map((id) => MAPS[id]);

/**
 * Maps that are still being built, and are offered only by a dev build.
 *
 * The server still accepts them — it has no idea which build asked, and a
 * second source of truth for "is this map real" is worse than a menu that does
 * not offer one. This is about what a player is shown, the same way Quick play
 * is: `DEV` is substituted by vite, so in the image the entry is dead code and
 * the map is unreachable from the UI.
 */
export const DEV_ONLY_MAPS: ReadonlySet<MapId> = new Set<MapId>(["hospital"]);

/** The match maps a build may offer. Pass `DEV` from `app/dev.ts`. */
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
