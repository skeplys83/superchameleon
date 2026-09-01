# server — the authoritative half

**Owns:** the Colyseus rooms and their state, the matchmaking between them, and
the HTTP bootstrap that serves the client.

**A different runtime.** This runs in Node, never reaches the browser, and may
import only from `src/shared/`. That is enforced by `no-restricted-imports` in
`eslint.config.mjs` and by `tsconfig.server.json`, which drops the `dom` lib — a
`window` here is a compile error, not a production surprise.

**Entry point:** `node src/server/index.ts`, which both `npm run dev` and
`npm start` run. There is no build step: **Node strips the TypeScript itself**,
which is why imports must name the real file (`./room.ts`).

## What's here

| file          | what                                                              |
| ------------- | ----------------------------------------------------------------- |
| `index.ts`    | HTTP, `/monitor`, `/api/sessions`, starts Colyseus                |
| `rooms.ts`    | the two room definitions — tests boot this, so they boot production |
| `room.ts`     | `GameRoom`: phases, capacity, and both hand-offs between rooms    |
| `messages.ts` | everything a client may *say*, and the trust model for each       |
| `host.ts`     | `HostRule`: who holds the Start button                            |
| `schema.ts`   | `Player` and `GameState` — the wire format, not an abstraction    |
| `code.ts`     | the invite alphabet, and a code no live room is using             |
| `clean.ts`    | what a player may make everybody else read: names and chat        |
| `monitor.ts`  | the admin panel, and when it is allowed to exist                  |
| `test/`       | the suite and its harness — see **Testing** below                 |

## One class, two names

A **lobby** is the lobby map: playable, holds the invite code, does not auto-dispose.
A **match** is the game proper on the chosen map. `this.roomName` is the only
thing that tells them apart, because movement, paint, kills and whistles are
identical in both. The cycle is lobby → countdown → match → back to the *same*
lobby, and `state.lobby` is the field that makes the return trip possible.

## The five rules that will bite you

1. **Schema fields use `declare`, never `!`.** Type stripping blanks characters
   out rather than re-emitting, so `name!: string` survives as a real class
   field that shadows the accessor `defineTypes` installs. Colyseus then cannot
   find its metadata and **every state encode dies on the first join**. Same
   reason: no field initialisers, no decorators, no `enum`.
2. **One clock, and only the match holds it.** A single `clock.setInterval`
   drives hiding → hunt → reveal; each phase sets the seconds for the next. The
   lobby's hiding countdown is a *display mirror* that decides nothing — the
   phase ends when the match calls `sendHunter`. Two timers are two things that
   can disagree, and the number on screen has to be the one that ends the round.
3. **A round ends from either side, and the phase decides which.** In the hunt,
   the last chameleon caught *or* quitting hands it to the hunters, and the last
   hunter quitting hands it to the chameleons — nobody is looking any more, and
   the clock would otherwise run down over an empty search. In `hiding` there is
   no hunter in the room at all (theirs is in the lobby), so only one side can
   empty out, and when it does the match calls **`roundAborted` on the lobby**:
   this room is about to dispose with nobody in it to see a reveal, and the
   hunter would otherwise watch the mirror countdown run down to a bell that
   never rings.
4. **A declared type is not a check.** `msg` is a stranger's JSON, so a handler
   types its fields `unknown` and bounds each one — `vec3` / `point` / `angles`
   for vectors, `clamp` for scalars. Writing `position: [number, number, number]`
   on a message type and then relaying it is a claim, not validation: `shoot` did
   exactly that and fanned unbounded junk out to the whole room. `clamp` alone is
   not enough for a vector either, since it turns a `NaN` into a `0` — an
   all-`NaN` position has to be *refused*, not quietly moved to the middle of the
   map.
5. **A match takes a role only from a seat its lobby reserved.** Reservation
   options and a client's own join options arrive at `onJoin` indistinguishably,
   so the lobby mints a `pass` and includes it in every reservation. Without it
   any chameleon could leave a match and rejoin claiming the gun — and every
   player in a match knows its id.

## Contracts

- **Reads `../shared/`** for `Role`, the phase durations, the fire and whistle
  intervals, and the map table (`mapRoundSeconds`, `mapLimit`). Do not
  re-declare any of them here — `scripts/check-constants.mjs` fails the commit.
- **`cling` is a surface, not a flag** — `CLING_NONE` / `CLING_WALL` /
  `CLING_CEILING` from `shared/`. Clamped like every other number off the wire
  and forced to `CLING_NONE` for a hunter, because clinging silences footsteps.
- **`upright` is taken as `msg.upright === true`**, never cast. It is the only
  boolean in `state`, and a cast would let a string, a number or an absent field
  through as truthy — anything that is not the word `true` is a body that lies
  flat, which is the default the poses were fitted for.
- **Every message name comes from `MESSAGES` in `shared/protocol.ts`**, never a
  string literal. `messages.ts` and `room.ts` both destructure it
  (`const { toServer, toClient } = MESSAGES`). The names themselves are the one
  part of the protocol that used to exist twice with nothing joining the copies.
- **Messages in** (← `client/net/send.ts`): `state`, `paint`, `clearSkin`,
  `shoot`, `kill`, `whistle`, `chat`, plus `start` and `setMap` from a lobby's
  host — the last two wired in `room.ts` because only a lobby has anything to
  start.
- **Messages out** (→ `client/net/client.ts`): `shot`, `whistle`, `mark`,
  `caught`, `clearSkin`, `paint`, `chat`, `moveTo`, `moveFailed`. **There is no
  "match over" message** — `moveTo` is the news.
- **`setMap` is refused once the countdown is running.** Everyone is already
  preloading the map the phase change told them to fetch, so a switch at second
  four sends half the lobby somewhere the other half is not going. The lobby
  panel greys the picker out as well; this is the half that holds, and
  `test/lobby.test.ts` pins it.
- **`chat` is a waiting-room message**, refused in a match and refused in a
  lobby outside `waiting` and `countdown`. A match never carries it because a
  channel between the people being hunted is coordination against the one
  player looking for them; the two lobby phases it *is* allowed in are the two
  where nobody has a side yet. It **is a broadcast, and nothing keeps it.** It
  used to live in `GameState` as an `ArraySchema<ChatLine>`, so that a live line
  and the backlog handed to a latecomer were one mechanism; a lobby is now a
  room you can only hear while you are standing in it, and somebody arriving
  mid-conversation starts on an empty box. The client trims its own copy to
  `CHAT_HISTORY`, which is the only place that number is spent now.
- **Names and chat are filtered here, and only here.** A name is a join option
  and a message is a websocket frame, so a filter on the client is decoration —
  same trust model as movement and kills. The two choke points are `onJoin` and
  the `chat` handler. **Their behaviours differ on purpose**: a foul chat line
  is *masked* (a message that silently vanishes reads as a broken server and
  gets retyped), while a foul name is *replaced* with a fallback (`Ge****42` is
  worse than either alternative, and refusing the join leaves a player at an
  error screen with nothing to fix). **A name is also read more strictly** — it
  is checked again with every separator removed, which `obscenity` will not do
  itself because collapsing gaps in a sentence invents words across them.
  `clean.ts` has the measured list of what is and is not caught.
- **`/api/sessions`** is served here because Colyseus 0.16 has no room-list
  route. A game's player count spans both of its rooms.
- **Do not bump Colyseus casually.** Four packages move together and
  `@colyseus/monitor@0.17` silently installs a *second* `@colyseus/core`. The
  check after any bump is
  `find node_modules -type d -name core -path "*@colyseus*"` — exactly one line.

## Testing

`npm test`. The suite boots a real server through `rooms.ts` and drives real
`colyseus.js` clients, so it exercises the wire rather than the class:

- `host.test.ts` — the Start button: the creator keeps it, it stays vacant while
  a match runs, and it moves by first arrival rather than by who is standing
  closest.
- `lobby.test.ts` — the code, everybody armed, `kill` refused, the lobby map refused
  as a match map, a guest's `start` ignored, the countdown starting and
  cancelling, the door closed to strangers, and the draw producing exactly one
  hunter who does *not* travel at Start.
- `match.test.ts` — the clock ringing its own bell, the pass rule in both
  directions, a catch converting rather than removing, both ways a round ends,
  `kill` refused during the reveal, a `NaN` position clamped rather than
  encoded, and what `shoot` is allowed to relay: a well-formed mark passes
  through, a payload that is not three vectors is refused outright (not even the
  bang), and a wild one is bounded to the map first — against
  `mapLimit(DEFAULT_MATCH_MAP)` rather than a number, since the bound is per map
  and a literal there is really an assertion about which map is the default. It reads the relays through
  `told()` in the harness, since a mark is kept nowhere either.

`clean.test.ts` pins the three decisions on top of the word list — mask chat,
replace a name, read a name more strictly — and that every fallback name
survives the filter, which is the false positive that would otherwise have the
server renaming people to something it then rejects.

`lobby.test.ts` also covers chat: the line everybody is told, the latecomer who
is told none of it, the trim and cap on one message, the rate limit, and the two
phases it goes quiet in. It reads them through `heard()` in the harness, since
listening is now the only way to see a line. `match.test.ts` covers the refusal.

They live in `test/` rather than beside the source, because none of them maps
to one module — `lobby.test.ts` and `match.test.ts` both exercise `room.ts` — and
because `.dockerignore` can then drop the whole folder from the production
image in one line.

Tests boot on a fixed port, so `vitest.config.ts` runs files one at a time. The
countdown is five real seconds, so anything past it calls `start()` directly —
`test/harness.ts` names the private members a test may reach for, so renaming
one fails to compile instead of silently asserting nothing.

**Still only checked by hand:** the round trip home, reconnection into a held
seat, and the twenty-second drop window.

---

The full invariant list — all forty of them, with the debugging session each was
paid for with — is [docs/notes/server.md](../../docs/notes/server.md).
