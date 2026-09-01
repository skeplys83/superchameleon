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
    /**
     * How many lamps may cast at once, the nearest to the camera winning.
     *
     * Set it and the `shadow_` prefix stops deciding anything: every lamp in
     * the map is a candidate and the budget follows the player, so a room is
     * never one somebody forgot to pick. Leave it unset and only the lamps
     * named `shadow_` cast, which is what the old arena's one sun wanted.
     */
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
  lobby: {
    id: "lobby",
    name: "Lobby",
    blurb: "A stone cavern that closes over your head, and a walled ring with four doors.",
    src: "/maps/lobby.glb",
    spawn: [0, 2, 0],
    // The player is contained by a cylinder at the wall ring's own inner face,
    // r = 9.65 — the rubble and the gallery deck outside it are scenery. The
    // clamp only has to sit outside what you can stand on.
    bound: 11,
    roundSeconds: 120,
    sky: false,
    background: "#05060a",
    render: {
      lights: {
        // **Six lamps in a ring at the floor, and none at the centre.** A spot
        // under the apex lit a dome nobody can reach and left the ground dark;
        // the lamp that replaced it sat at (0,0) — 1.4 m from the head of a
        // player standing on the spawn — and blew the figure to white with a
        // hard shadow across half the screen. The ring is offset from the
        // spawn on purpose, and its own lamps are 7.3 m from it.
        //
        // 0.10 is what makes the game match a Blender preview at exposure 0:
        // `game / blender = 683 * LIGHT_SCALE * exposure * d^(2 - LAMP_DECAY)`,
        // which at `LIGHT_SCALE` 0.01, this map's 0.62 exposure and a lamp
        // 7.3 m away comes to 9.4 * scale. See levels/AUTHORING.md §9.
        scale: 0.1,
        // A cave has no bounce light in three, and a rubble shell lit by a
        // single downward spot is black everywhere the spot is not. This fill
        // is what lets the boulders show any shape at all — flat ambient
        // renders relief as a flat texture, which is exactly how the first
        // build of this room looked.
        ambient: { color: "#8f9aa8", intensity: 0.14 },
        // **The `ground` colour is what lights the ceiling here**, not `sky`.
        // A hemisphere light goes by surface normal, and every boulder in the
        // dome faces downward — so a near-black ground left the whole roof a
        // void while the ring below it was blown out. This is the number that
        // closes that gap.
        hemisphere: { sky: "#aab4c2", ground: "#4a5058", intensity: 0.18 },
        shadow: { budget: 1, mapSize: 1024, radius: 6, exclude: ["wall", "floor"] },
      },
      toneMapping: "NeutralToneMapping",
      // Down from 0.75: the kit's brick is a pale sand since the gamma lift,
      // and six lamps in a room this size put it straight through white.
      exposure: 0.62,
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
    // Built on a 2 m grid, then scaled 1.6x so a wall is 4 m like the dungeon's —
    // collision now reaches 44, so the symmetric clamp has to clear it.
    bound: 45,
    roundSeconds: 240,
    sky: false,
    background: "#0b0f0d",
    render: {
      lights: {
        // 24 ceiling lamps, three of them casting: the map is lit by its own
        // fixtures, and every one of them is a **point** light.
        //
        // **Spots were tried and reverted.** One shadow pass each against a
        // point's six is a real saving, and it is not worth what it costs: a
        // spot lights its cone and nothing else, so at 110° the waiting room
        // had a 4.9 m pool of light in a room the other lamps fill entirely,
        // and it read as the room being broken. Widening it does not rescue
        // this — a cone wide enough to match a point light is a shadow frustum
        // near 180°, where the map's texels are useless. The room wins; the
        // budget is spent by *how many* lamps cast instead, which is three.
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
        // **Down from 0.3, to let the shadows read**, which is a deliberate
        // trade against everything the paragraph above says. A shadow only
        // subtracts a lamp's own contribution, so this fill is the floor it
        // cannot go below, and at 0.3 a lit floor and a shadowed one were
        // within a few percent of each other. It is the one number to move if
        // they want to be deeper still — and the first to put back if a painted
        // body starts reading as a silhouette.
        ambient: { intensity: 0.18, color: "#eaf2ee" },
        // A little sky-over-ground on top, so a wall and the floor under it are
        // not the same flat value. Cheap, and it costs no contrast at the body.
        hemisphere: { sky: "#f2f7f4", ground: "#4c5a52", intensity: 0.1 },
        shadow: {
          // **Three lamps cast, and which three follows the camera.** The map
          // has 24 and a point light's shadow is six passes, so casting from
          // all of them is out; picking three in Blender left the other
          // nineteen rooms with no grounding at all, which is what every
          // screenshot of this map was actually showing. See `ShadowBudget`.
          budget: 3,
          // Full strength. What keeps it off black is the ambient and
          // hemisphere fill above, which a shadow cannot touch — it only ever
          // removes the lamp's own contribution, so the floor of the picture
          // stays where the fill puts it. **If it still reads too weak, the
          // lever is `ambient.intensity`, not this.**
          intensity: 1.0,
          // In texels, and the only softness knob there is: `radius` is read by
          // the PCF branch of three's shadow shader — for a lamp's cube map as
          // well as a flat one — and by nothing else. Wide enough to lose the
          // staircase on a 1024 map without falling into the banding a large
          // radius over few taps produces.
          radius: 8,
          // **Left at the default 1024, and it must stay there.** These are
          // point lights, and three packs a cube's six faces into one texture
          // of `mapSize * 4` by `mapSize * 2` — so 1024 is already 4096x2048,
          // about 33 MB a lamp, and 2048 would be 8192x4096 and 134 MB. It was
          // briefly raised for a 150° spot, where the map covers one wide cone
          // and the arithmetic is entirely different. See `levelScene.ts`.
          // **The shell receives but does not cast.** Walls, floors and
          // ceilings are 551 of the map's 821 drawn objects and only 61k of its
          // 672k triangles, so dropping them takes two thirds of the objects
          // out of every shadow pass and costs a tenth of the geometry — and
          // nothing visible, because a flat wall casting onto itself buys
          // nothing. They still receive: `exclude` gates `castShadow` alone.
          exclude: ["wall", "floor", "ceiling"],
        },
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
      // **Off, and this is a cost decision rather than a look one.** The three
      // lamps renamed `shadow_*` in the .blend are *point* lights, and a point
      // light's shadow is a cube: six renders of everything that casts, each
      // frame, each lamp — eighteen extra passes over the map's furniture,
      // which is where its 611k triangles live. That is what it cost in
      // frames, and it was always the risk written down below.
      //
      // **Turning this back on is one word**, and the lamps keep their names,
      // so nothing else has to be undone. Do it once they are spot lights:
      // a spot's shadow is one frustum over one room's cone, so the same three
      // lamps cost three passes instead of eighteen, over the handful of
      // objects that cone actually contains. Halving `mapSize` to 512 and
      // keeping `exclude` as it is are the other two levers.
      //
      // `PCFShadowMap` rather than `PCFSoftShadowMap`: the soft variant is
      // deprecated in three 0.185 — `WebGLShadowMap` warns and silently
      // substitutes this one — and it is the PCF branch that reads
      // `shadow.radius`, so softness comes from the radius above.
      shadows: { enabled: false, type: "PCFShadowMap" },
      fog: null,
    },
  },
};

export const MAP_LIST: GameMap[] = MAP_IDS.map((id) => MAPS[id]);

export const MATCH_MAP_LIST: GameMap[] = MATCH_MAP_IDS.map((id) => MAPS[id]);

/**
 * Maps that are still being built, and are offered only by a dev build.
 *
 * **Empty today** — the hospital was the last one in it and now ships. The set
 * stays because it is how the next unfinished map is held back: add its id and
 * every picker drops it, with no other edit anywhere.
 *
 * The server still accepts them — it has no idea which build asked, and a
 * second source of truth for "is this map real" is worse than a menu that does
 * not offer one. This is about what a player is shown, the same way Quick play
 * is: `DEV` is substituted by vite, so in the image the entry is dead code and
 * the map is unreachable from the UI.
 */
export const DEV_ONLY_MAPS: ReadonlySet<MapId> = new Set<MapId>();

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
