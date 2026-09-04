import { Schema, MapSchema, ArraySchema, defineTypes } from "@colyseus/schema";
import type { Phase, Role } from "../shared/protocol.ts";

export class Player extends Schema {
  // `declare`, never `!` — see server/CLAUDE.md rule 1.
  declare name: string;
  declare role: Role;
  declare x: number;
  declare y: number;
  declare z: number;
  // For a hunter this is the CAMERA yaw — chameleons read it as the barrel.
  declare yaw: number;
  declare pitch: number;
  declare pose: number;
  declare cling: number;
  // Cosmetic but on the wire — the pose it changes is what a chameleon is
  // hiding as, so cannot be local.
  declare upright: boolean;
  declare strokes: ArraySchema<string>;

  constructor() {
    super();
    // In state (not just broadcast) so a late joiner is handed every player's paint.
    this.strokes = new ArraySchema<string>();
  }
}

defineTypes(Player, {
  name: "string",
  role: "string",
  x: "number",
  y: "number",
  z: "number",
  yaw: "number",
  pitch: "number",
  pose: "number",
  cling: "number",
  upright: "boolean",
  strokes: ["string"],
});

// Chat is NOT in state — a plain broadcast, kept nowhere.

export class GameState extends Schema {
  declare players: MapSchema<Player>;
  declare graves: ArraySchema<string>;
  declare map: string;
  declare mode: string;
  declare nextMap: string;
  declare hostId: string;
  declare listed: boolean;
  declare lobby: string;
  declare timeLeft: number;
  declare phase: Phase;
  declare maxPlayers: number;
  declare winner: string;

  constructor() {
    super();
    this.players = new MapSchema<Player>();
    // Graves are permanent — someone joining later sees every one.
    this.graves = new ArraySchema<string>();
  }
}

defineTypes(GameState, {
  players: { map: Player },
  graves: ["string"],
  map: "string",
  mode: "string",
  nextMap: "string",
  hostId: "string",
  listed: "boolean",
  lobby: "string",
  timeLeft: "number",
  phase: "string",
  maxPlayers: "number",
  winner: "string",
});
