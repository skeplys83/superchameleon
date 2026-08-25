<!-- Archive. The short doc that agents actually read is the CLAUDE.md in
     the folder this describes. Everything here is the long-form reasoning
     behind it: the full invariant list, the tuning, and the debugging
     sessions each rule was paid for with. Kept because it is expensive
     knowledge, demoted because nobody finishes a 500-line file. -->

# shared — what the browser and the server both have to believe

**Owns:** `Role` and `Phase`, plus the handful of constants that would be a bug if the two
halves of the app disagreed about them.

**Entry points:** `@/shared/protocol` from the client,
`../shared/protocol.ts` from `server/`.

## Files

- `protocol.ts` — `Role`, `Phase`, `MIN_PLAYERS`, `MAX_PLAYERS`,
  `COUNTDOWN_SECONDS`, `ROOM_HALF`, `ROOM_LIMIT`, `POSE_COUNT`,
  `MAX_STROKES`, `MAX_STROKE_LENGTH`, `FIRE_INTERVAL_MS`,
  `FIRE_INTERVAL_TOLERANCE`, `WHISTLE_INTERVAL_MS`, `WHISTLE_TOLERANCE`,
  `MAX_STROKE_BATCH`.

## Invariants

1. **Only add something both sides read.** Server-only tunables (`PATCH_MS`,
   `MAX_GRAVES`, the discovery timings) live in `server/`; client-only ones live
   in the folder that owns them. A shared module that accumulates unrelated
   constants is just a second global object, and the point here is the opposite.
2. **`ROOM_LIMIT` is deliberately not `ROOM_HALF`.** 19.9 vs 20 is a real
   distinction, not a rounding slip — see the comment on the constant and
   `players/CLAUDE.md` for why the margin is that thin. **The pair now describes
   the arena only.** Every room is clamped to `mapLimit(id)` from
   `world/maps.ts`, which is that map's own `bound` less the same 0.1; these two
   supply the arena's number and the size of the margin. Clamping every map to
   `ROOM_LIMIT` is what kept the dungeon at 40×40 until it was made per map.
3. **Nothing here may be defined twice.** `scripts/check-constants.mjs` runs in
   the pre-commit hook and fails if any name exported from this file is also
   *defined* elsewhere under `src/game`. Re-exports are fine and deliberate —
   `world/Room.tsx`, `figure/poses.ts` and `paint/skin.ts` all re-export a
   protocol constant so callers can import it from the folder that owns the
   concept — but a second definition is a lie. This is not hypothetical:
   `WHISTLE_INTERVAL_MS` was moved here and the old copy left behind, so for a
   whole commit the obvious knob was a dead one and editing it did nothing.
4. **This file must stay import-free.** It is loaded by a Node process with no
   bundler and by the browser bundle; pulling anything else in drags that
   dependency into both. It currently imports nothing, and should not start.

## Contracts

- `Role` is `"chameleon" | "hunter"` and is used by the client everywhere and
  stored in schema by the server, which checks it before honouring a kill. It is
  protocol, not decoration — that is why it lives here rather than in a client
  folder. It was `"hider" | "seeker"` until the round work renamed both sides at
  once; **a rename here is a wire break**, and it is only survivable because
  nothing is persisted and both halves ship together.
- `Phase` is the union of everything a room can be *doing*: `waiting`,
  `countdown`, `hiding`, `hunt`, `reveal`. **Two of those nothing sets yet** —
  `hiding` and `reveal` arrive in stage 5 of `PLAN.md`. They are declared early
  on purpose: the union is the design, and a phase the server can produce but the
  client has never heard of is exactly what this prevents. `net/client.ts`
  validates an incoming phase against the list and falls back to `waiting`.
- **`LEAVE_IN_PROGRESS` / `LEAVE_STARTING` are why a join was refused.**
  `server/room.ts` picks one and closes the socket with it; `net/client.ts` turns
  it into the sentence shown on the menu. They start at 4000 because Colyseus
  reserves everything below that. A refusal is the one thing both halves must
  agree on that is *not* a message — the server accepts the socket and then drops
  it — so the codes are the whole protocol for it, and a bare number written on
  each side would be precisely the mirrored constant this file exists to end.
- **`MIN_PLAYERS` / `MAX_PLAYERS` are the bounds, not the size of any lobby.**
  The host picks a cap when they open a game; `server/room.ts` clamps it into
  this range and it becomes that room's `maxClients`. The create panel builds its
  stepper from the same two numbers, which is why they live here.
- `world/maps.ts` gives the arena a `bound` of `ROOM_HALF`, and
  `levels/arena/arena.blend` is built to the same 40×40 by hand.
- `server/messages.ts` clamps movement to `mapLimit(room.state.map)` — per map,
  not to `ROOM_LIMIT` — and pose indices to `POSE_COUNT`.
- `figure/poses.ts` **throws at import time** if `POSES.length !== POSE_COUNT`,
  the drift guard against a fifth pose that silently never reaches anyone else's
  screen. **That guard got weaker when the app moved to Vite and nobody has
  replaced it.** Under Next it fired during prerender, so `npm run build` failed
  with an explanatory message; Vite bundles without evaluating, so it now throws
  in the browser on first load instead. Still loud and still explanatory, but no
  longer a build gate — the build will *not* tell you if you forget. If you add a
  pose, change `POSE_COUNT` here in the same edit.
- `players/Player.tsx` and `server/room.ts` both enforce `FIRE_INTERVAL_MS` —
  the client so the gun feels like a pump-action, the server because fire rate
  reaches everybody. The server allows `FIRE_INTERVAL_TOLERANCE` of slack for
  clock jitter.
- `Game.tsx` whistles on `WHISTLE_INTERVAL_MS` and `server/room.ts` rate-limits
  against it, for the same reason as firing: a client that whistled continuously
  would be a siren in everybody else's ears.
- `net/send.ts` splits every outgoing `paint` at `MAX_STROKE_BATCH` and
  `server/room.ts` caps a single message at the same number, so a long drag can
  never lose its tail. The two were 50 and 64 written separately, which worked
  only because 50 was the smaller of them.
- `paint/skin.ts` trims its replay history to `MAX_STROKES`, the same cap the
  server keeps in schema. A smaller client cap would silently lose paint on
  respawn, since the respawn replay is what restores it.

## Not built yet

Message *names* (`state`, `paint`, `shoot`, `kill`, `clearSkin`, `mark`,
`killed`) are still string literals typed out on both sides, as is the shape of
each payload — `net/client.ts` hand-mirrors the `Player` schema in a comment.
Now that both halves are TypeScript those could be real shared types. They have
not caused a bug yet, so they have not been moved.
