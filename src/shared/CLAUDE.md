# shared — what both halves have to agree on

**Owns:** `Role`, `Phase`, the durations and limits both sides read, and the map
registry.

**Imported by `src/server/` and `src/client/`, and it may import from neither.**
That is an ESLint rule. It also has to load in a Node process with no bundler
and no DOM, so nothing here may touch `window`, React or three.js.

## What's here

| file         | what                                                            |
| ------------ | ----------------------------------------------------------------- |
| `protocol.ts`| `Role`, `Phase`, phase durations, fire, whistle and chat rates, bounds |
| `mapIds.ts`  | the map ids, the lobby map, and which ones a match may use       |
| `maps.ts`    | the registry: name, file, spawn, bound, `roundSeconds`, lighting |
| `names.ts`   | the fallback player names, and `randomName()`                    |

The phase durations (`COUNTDOWN_SECONDS`, `HIDE_SECONDS`, `REVEAL_SECONDS`) are
tuning, and get retuned. Nothing may hard-code them — including prose: the root
doc names the constant beside the number for exactly this reason.

## The three rules that will bite you

1. **Nothing here may be defined twice.** `scripts/check-constants.mjs` runs in
   the pre-commit hook and fails if a constant defined here is *re-defined*
   anywhere under `src/`. This whole folder exists to prevent that one class of
   bug, which has been reintroduced before.
2. **Only add something both sides read.** Server-only tunables (`PATCH_MS`,
   the sweep interval) belong in `server/`; client-only ones belong in the folder
   that uses them. A constant here is a promise that both halves obey it.
3. **`ROOM_LIMIT` is deliberately not `ROOM_HALF`.** 19.9 against 20 is the
   margin that stops a client's own rounding reading as cheating. `mapLimit`
   applies the same margin per map, because the dungeon is 52 across and the
   arena 40 — a single global bound amputated whichever map was bigger.

## Contracts

- **`maps.ts` is read by the server** for `mapRoundSeconds` and `mapLimit`, and
  by the client for everything else. It is pure data, which is why it lives here
  rather than in `client/world/`.
- **`DEV_ONLY_MAPS` hides a map from the menus, not from the server.** A map
  still being built is filtered out by `playableMaps(dev)`, which every picker
  calls with `DEV` — vite substitutes that, so in the image the entry is dead
  code. The server keeps accepting the id: it cannot tell which build asked, and
  a second source of truth for "is this map real" is worse than a menu that
  simply does not offer one.
- **`POSE_COUNT` is checked against `figure/poses.ts`** at import time.
- **`CLING_NONE` / `CLING_WALL` / `CLING_CEILING` are ordered so `!== CLING_NONE`
  still means "is clinging"**, which is all `sound/` ever asks. It was a boolean
  until the figure needed three answers: a pose that lies flat lies flat on a
  floor *and* a ceiling, and stands up to climb a wall.
- **`names.ts` is here because both halves read it**, which is the rule for
  this folder. The client offers one in the name box; the server hands one out
  when `clean.ts` takes a name away. It moved from `client/hud/` the day the
  server needed it — copying it would have failed `check-constants`.
- **Leave codes (`LEAVE_IN_PROGRESS`, `LEAVE_STARTING`) are here** rather than as
  a bare `4001` written twice.
- **The chat limits are here because both halves enforce them.**
  `MAX_CHAT_LENGTH` caps the server's truncation *and* the input's `maxLength`.
  `CHAT_HISTORY` is now the client's alone — the length of the rolling list it
  keeps on screen — because the server stores no chat to trim. `CHAT_INTERVAL_MS` is the server's alone today, and sits beside
  them rather than being the one chat number somewhere else.

---

The longer version: [docs/notes/shared.md](../../docs/notes/shared.md).
