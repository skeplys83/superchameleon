import { Schema, MapSchema, ArraySchema, defineTypes } from "@colyseus/schema";
import type { Phase, Role } from "../shared/protocol.ts";

/** The synced room state. */

export class Player extends Schema {
  /** `declare`, never `!`. */
  declare name: string;
  declare role: Role;
  declare x: number;
  declare y: number;
  declare z: number;
  /** For a hunter this is the *camera* yaw, not the body yaw — that is how a
   *  chameleon reads where the gun hunting them is pointed. See players/CLAUDE.md. */
  declare yaw: number;
  declare pitch: number;
  declare pose: number;
  /** What this chameleon is stuck to: `CLING_NONE`, `CLING_WALL` or
   *  `CLING_CEILING`. It silences their footsteps for everyone else, and tells
   *  every client which way up to draw a pose that lies flat. */
  declare cling: number;
  /** The X toggle: this player is keeping a pose that *could* lie flat on its
   *  feet instead. Cosmetic, but it has to be everyone's — the pose it changes
   *  is what a chameleon is hiding as, so it cannot be local to one client. */
  declare upright: boolean;
  declare strokes: ArraySchema<string>;

  constructor() {
    super();
    // Kept in state rather than only broadcast, so a player joining late is
    // handed everyone's existing paint.
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

/**
 * **Chat is not in here.** It used to be an `ArraySchema<ChatLine>`, precisely
 * so that a latecomer was handed what had already been said; it is now a plain
 * broadcast, and a conversation exists only for the people who were in the room
 * to hear it. Nothing is kept, so there is nothing to hand over.
 */

export class GameState extends Schema {
  declare players: MapSchema<Player>;
  declare graves: ArraySchema<string>;
  /** Which map this room is playing. */
  declare map: string;
  /** `"lobby"` or `"match"`. */
  declare mode: string;
  /** The map a lobby will start its match on. */
  declare nextMap: string;
  /** Whoever may press Start: the first player to join, reassigned if they leave. */
  declare hostId: string;
  /** Whether this lobby appears in the menu's list of games. */
  declare listed: boolean;
  /** The invite code of the lobby this game belongs to. */
  declare lobby: string;
  /** Seconds left in the match, counted down on the server. */
  declare timeLeft: number;
  /** What this room is *doing*, as opposed to which kind of room it is. */
  declare phase: Phase;
  /** How many players this lobby will hold, chosen by whoever opened it. */
  declare maxPlayers: number;
  declare winner: string;

  constructor() {
    super();
    this.players = new MapSchema<Player>();
    // Death markers live in state, not in a broadcast: they are permanent, so
    // someone joining an hour later still has to see every one of them.
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
