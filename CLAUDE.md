# Super Chameleon

A multiplayer hide-and-seek game. Chameleons are stick figures who can lie on
their side to pass as scenery; hunters hunt them in first person with a shotgun.
No accounts, no third-party services.

## Start here

**Read the doc in every folder you edit, not just this one.** Each folder under
`src/` carries its own forty-line doc — what is in it, the three rules that will
bite you, and its contracts with the folders around it. They are the only thing
standing between you and a trap that does not error, and the pre-commit hook
will refuse a commit that changes a folder's code without touching its doc. The
map is [The three-way split](#the-three-way-split) below;
[docs/TRAPS.md](docs/TRAPS.md) is the eight project-wide ones, numbered and
referenced by number from code all over the repo.

**`CLAUDE.md` and `AGENTS.md` are the same file.** Every folder that has one has
both — `AGENTS.md` is a symlink to `CLAUDE.md` beside it, so an agent that
looks for either name finds the same doc. Edit `CLAUDE.md`; the link follows.

Before you finish: `npm run typecheck && npm test && npm run lint`. See
[Checking your work](#checking-your-work). Do not run the game yourself to check
a visual change — ask, and it will be run for you.

A central server serves all players over web and WebSocket connections. It is
**not deployed to a serverless platform**: the game is one long-lived process
holding websocket rooms, which is the opposite of what those platforms do.

**One server runs many games at once.** A player opens a **lobby** — the arena,
playable, with a four-letter invite code and a size between 2 and 12 chosen when
it was created — and a round begins on a **five-second countdown**, started either
by the lobby filling up or by the host pressing Start.

**A round has four phases and the map decides how long it is** (five minutes for
the dungeon, hiding included):

1. **countdown**, `COUNTDOWN_SECONDS` (5s), in the lobby. At zero the server draws one player at
   random to be the **hunter**; everyone else becomes a **chameleon**. **The
   lobby is closed for the duration** — a stranger with the code is turned away
   until the round is over, because the draw is over whoever is present at zero
   and because a latecomer has no time to load the map they are about to be
   moved to. Anyone this game already knows still gets in, so a blink inside the
   ten seconds is not an ejection.
2. **hiding**, `HIDE_SECONDS` (40s). The chameleons are moved to the map. **The hunter is not** —
   they stay in the lobby, playing the arena alone, so they cannot watch anybody
   choose a spot.
3. **hunt**, the rest of the round. The bell rings, the hunter is brought in.
   **Being caught does not put you out**: you become a hunter yourself, at the
   spawn point, stripped back to white, and you join the hunt. So the hunt grows
   and the last chameleon is hardest to catch. **A hunter looks through a
   coarser picture than everybody else** — the world renders at half resolution
   for them, and only for them, and only while the hunt is on, which is what a
   figure lying still against the wall it is painted to match disappears into.
   The HUD keeps its own resolution for free, because `hud/` draws outside the
   Canvas.
4. **reveal**, `REVEAL_SECONDS` (20s). The survivors pulse red through the walls, standing exactly
   where they hid, and every grave marks where somebody was found. **The
   survivors are rooted** — they are the exhibit, and a spot they walk away from
   is not a spot — but they keep their camera, and everyone else walks over to
   look at the thing that beat them. Nobody can be caught: `kill` is refused
   outside the hunt. Then everyone goes back to the lobby and can start another.

**Chameleons win** if the clock runs out with one of them still free; **hunters
win** if the last one is caught. Both rooms are the same class under two
registered names; the lobby stays behind precisely so there is somewhere to come
back to — and so the hunter has somewhere to wait.

**A lobby is the one place anybody talks.** It has a chat box on `T`, and what
is said is a broadcast the server keeps no copy of — somebody arriving five
minutes in is handed none of it and hears only what is said from then on. It
goes quiet the moment the round is underway — a match never carries chat at
all, because a channel between the people being hunted is coordination against
the one player looking for them.

Two things follow and are load-bearing. **A code is the only way *in*, and
listing only decides whether you can *find* it**: a lobby is public by default
and appears in the menu with the number of players across both its rooms, but
unticking that box hides it without locking it. **Nobody picks a side**:
everyone waits as a *hunter*, the draw at the end of the countdown leaves one of
them armed and turns the rest into chameleons, and a role sent from a client is
honoured only in a match *and* only when it carries the pass the lobby minted —
which is what stops a chameleon rejoining a match as the hunter.

**The host is whoever has been in the game longest**, so it is the creator until
they leave, and then the next-longest. It survives the round trip because each
tab sends a `sessionStorage` player id that is forwarded through both seat
reservations.

**A dropped socket is not a departure.** A match holds your seat for twenty
seconds — your body stays standing there, and stays catchable — so reconnecting
returns you to the same side and position. There are no accounts and nothing is
persisted: a player is a name typed into a box.

## The three-way split

```
src/
  server/     Node. Colyseus rooms, matchmaking, HTTP. May import shared/ only.
  client/     Browser. Everything you see. May import shared/ only.
  shared/     Both. Protocol constants and the map registry. Imports neither.
  main.tsx    createRoot(...).render(<Game />) — no StrictMode, see trap 1
  index.css   the one stylesheet: @import "tailwindcss" and four tokens
```

**That boundary is enforced, not described.** `eslint.config.mjs` has
`no-restricted-imports` zones for all three directions, and
`tsconfig.server.json` drops the `dom` lib so a `window` in server code is a
compile error rather than a production surprise. `npm run typecheck` runs both
projects.

Inside `client/`:

| folder     | owns                                                    | read it before touching                       |
| ---------- | ------------------------------------------------------- | --------------------------------------------- |
| `app/`     | `Game.tsx`, `Scene.tsx`, the session hooks, dev mode    | state, modes, preloading, frame priorities    |
| `net/`     | the Colyseus **client**, remotes, which room you are in | joining, moving rooms, remote transforms      |
| `world/`   | loading a map's `.glb`, collision, lighting             | room layout, cover, editing a map             |
| `figure/`  | the rig, the poses, `PART_SHAPE`                        | proportions, poses, limb geometry             |
| `paint/`   | canvases, brush, palette, the panel                     | painting, brushes, skins, colours             |
| `players/` | the local player and the remote ones, `BODY`            | controls, camera, movement, jumping, climbing |
| `combat/`  | the shotgun, the viewmodel, marks, graves               | shooting, death, hit feedback                 |
| `sound/`   | the audio engine, the catalogue, footsteps              | anything that makes a noise                   |
| `hud/`     | the 2D overlays outside the Canvas                      | menus, legends, name entry                    |

Everything under `client/` may mix freely, with two known and acyclic
back-and-forths: `paint/` ↔ `figure/`, and `players/` ↔ `combat/`. **`hud/` is
the one folder with a hard rule** — it renders outside the Canvas and must not
import from `world/`, `figure/`, `players/` or `combat/`. That is an ESLint rule
too, with `figure/poses` as the one allowed exception.

## The protocol

**Everything is websockets — but not everything is a message.** There are two
channels and the difference between them is the first thing to get right:

| channel                                                 | carries                                                                                                          | shape                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Colyseus schema sync** — `server/schema.ts`           | anything with a *current value*: positions, look, pose, cling, role, name, phase, `timeLeft`, map, graves, skins | binary deltas, sent automatically |
| **named messages** — `MESSAGES` in `shared/protocol.ts` | anything that *happens once*: a trigger pull, a catch, a chat line, a whistle, a room change                     | a name plus a msgpacked payload   |

**Movement is not a message.** A client posts its own transform upstream as a
`state` message twenty times a second — on a `setInterval` in
`players/useStateBroadcast.ts`, deliberately not `useFrame`, because a
backgrounded tab stops running frames and would look to everybody else like the
player vanishing. Everyone *else's* movement arrives as a schema patch, and
`net/remotes.ts` mutates the same objects in place rather than re-rendering. So
there is no `move` broadcast, and adding one would be the wrong instinct: if a
latecomer needs to be told it on join it is state, and Colyseus replays state
for free.

**Every message name lives in `MESSAGES`, split by direction.** They used to be
bare literals at both ends, which meant a rename on one side left the other
sending into a room with no handler — no type error, no failing test, just a
feature that quietly stopped. Four names (`paint`, `chat`, `whistle`,
`clearSkin`) travel both ways with different payloads, which is why the table has
a `toServer` half and a `toClient` half rather than one list.

```
sending    client/net/send.ts    →  server/messages.ts, and start/setMap in server/room.ts
receiving  server broadcasts     →  client/net/client.ts  →  client/net/events.ts  → the app
```

`net/events.ts` is the seam: nothing outside `net/` calls `onMessage`. A handler
turns a frame into an `emit*` call and the rest of the client subscribes to that,
which is why `combat/` and `sound/` never mention the wire.

**The trust model is one sentence: the client is asked, the server decides.**
Every handler in `server/messages.ts` bounds what it takes off the wire — the
position clamped per map, `cling` refused from a hunter, `pose` clamped to
`POSE_COUNT`, strokes capped in length and count, chat stripped of control
characters and filtered, `kill` checked against phase and role and both sides'
roles, and the trigger rate-limited. **A declared TypeScript type is not a
check** — `shoot` once typed its payload as three vectors and relayed it
untouched, which meant a crafted client could fan arbitrary junk out to the whole
room. Anything new that arrives from a client is validated in that file or it is
not validated at all.

**Two things deliberately are not verified.** A hunter's `kill` is taken on the
client's word — there is no server-side raycast — and so is a player's position.
That is the accepted trade-off for a party game with no accounts: it bounds what
a cheat can do (the map, the fire rate, the role, the phase) without pretending
to a simulation the server does not run.

## How the docs work

**Every folder documents itself, in about forty lines.** Each folder's
`CLAUDE.md` says what is in it, the three rules that will actually bite you, and
its contracts with the folders around it. The pre-commit hook opens the doc for
any folder you touch, which is what keeps it from rotting.

**The long-form reasoning is in `docs/notes/`.** These folder docs used to run to
five hundred lines each — forty numbered invariants, every one a debugging
session written out in full. That is expensive knowledge and none of it was
deleted, but nobody finishes a five-hundred-line file before making a small
change, so it was demoted: each short doc links to its archive.

**The rule going forward:** if a test can assert it, write the test instead of
the paragraph. Prose cannot fail CI.

|                                        |                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| [docs/TRAPS.md](docs/TRAPS.md)         | eight project-wide traps. **Numbered, and referenced by number from code all over the repo.** |
| [docs/RUNNING.md](docs/RUNNING.md)     | the scripts, the ports, the env vars, and how `public/` and `dist/` relate                    |
| [docs/VERIFYING.md](docs/VERIFYING.md) | the gates: what the tests cover and what still needs a browser                                |
| [docs/notes/](docs/notes/)             | the archived long-form doc for each folder                                                    |

Code comments stay thin: at most a few lines, saying what is not visible from the
line they sit on. A rule with a bug attached belongs in a `CLAUDE.md`, once.

Enable the hooks with `git config core.hooksPath .githooks`; run the doc half any
time with `npm run check:docs`. The same hook runs
`scripts/check-constants.mjs`, which fails if a `shared/protocol.ts` constant is
*defined* a second time anywhere. The escape hatch is `SKIP_DOC_CHECK=1 git
commit`.

## Checking your work

| command             | what it proves                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | both projects compile, and neither half used the other's globals                                                                                        |
| `npm test`          | 125 tests: the server suite in `src/server/test/` over the rooms, the draw, the clock, the lobby's chat, what the wire is allowed to say, and the filter — plus the two headless client suites in `src/client/players/test/`, the room bounds and the follow camera |
| `npm run lint`      | the import boundaries, and the React rules                                                                                                              |
| `npm run build`     | the client bundles                                                                                                                                      |

The client is **mostly** untested — it is three.js in a frame loop — so a change
there is checked by running it. The exception is geometry that can be called
without a frame or a canvas, which is worth a test precisely because nobody can
see a camera clamp go wrong until it does. See
[docs/VERIFYING.md](docs/VERIFYING.md).

## Stack

- Vite 8 + React 19, TypeScript, Tailwind v4
- three.js + `@react-three/fiber` + `@react-three/drei`
- `@react-three/rapier` for physics
- **Colyseus 0.16** server + `colyseus.js` 0.16 client, `@colyseus/schema` v3
- `@colyseus/monitor` 0.16 + `express`, for the admin panel at `/monitor`
- vitest + `@colyseus/testing` 0.16 for the server suite
- `obscenity` for the name and chat filter — server-side only, zero dependencies

### Version constraint — do not "upgrade" Colyseus casually

`colyseus@latest` is 0.17 (schema v4) but the browser client `colyseus.js` only
goes up to 0.16 (schema v3). Mixing them is a protocol mismatch and npm refuses
to resolve it. **`@colyseus/monitor` and `@colyseus/testing` are pinned for a
sharper reason:** their 0.17 lines depend on `@colyseus/core@^0.17`, which npm
installs *alongside* our 0.16 rather than refusing — giving a second matchMaker
in the same process that knows about none of our rooms. Five things move
together, and the check after any bump is
`find node_modules -type d -name core -path "*@colyseus*"` — expect exactly one
line.

## The rest of the repo

```
index.html          the page shell: title, viewport, favicon link, #root
dist/               `vite build` output. Generated, gitignored, never edited
public/sounds/      the ten .mp3 files
public/maps/        one .glb per map — the only map asset the game loads
public/models/      player.glb — the one rigged body everyone wears
characters/         figure-poses.blend: the rigged body, and the eight sculpted
                    poses the angles were fitted to. Nothing under src/ reads it
levels/             the .blend files the maps are exported from, and the raw kit.
                    AUTHORING.md there is the map-building guide
Dockerfile          the single-port production container build
scripts/            check-docs, check-constants, make-favicon, export-level
gamedistribution/   the one page uploaded to the portal — an iframe wrapper
                    around the live site. Not part of the build
```

**Every map is one `.glb` exported from Blender, and the repo has no part in
making one.** `levels/<id>/<id>.blend` is the map, `public/maps/<id>.glb` is its
export, and the row in `shared/maps.ts` is a display name plus the few numbers
the game needs before the file has loaded. There is no build step between the
.blend and the .glb.

**A map's textures live beside its `.blend`, though.**
`levels/<id>/textures/` holds what the materials point at, committed and
referenced by a relative path. The dungeon's are the seven photographic surfaces
— brick, rock, wood, gravel, tiles, metal and a dark iron — that its kit does
not ship:
the kit's own texture is a grid of flat colour swatches, so the retexture is a
per-face reassignment by swatch, done once by `scripts/retexture-dungeon.py`.
See [levels/AUTHORING.md](levels/AUTHORING.md).

**Hosted deployments run on a single exposed port.** In production Colyseus
attaches directly to the HTTP server on `PORT` (default 3000) unless `GAME_PORT`
says otherwise. Behind a TLS reverse proxy, `PUBLIC_GAME_PORT` is what clients
are told to connect on.

**A push to `main` is the deploy.** Portainer polls this repo, pulls, and
rebuilds the image on the VPS — there is no registry in the loop and no second
step. The line that makes it true is `pull_policy: build` in
`docker-compose.yml`: without it Portainer's pre-`up` `docker compose pull`
fails on an image that exists in no registry, and `up` reuses whatever it built
first, which is how production once served a two-day-old map through several
redeploys. Each rebuild leaves the previous image untagged; `docker image prune
-f` sweeps them. Rolling back is a `git revert` rather than a retag, since
nothing keeps an old image. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Not built yet

**No score across rounds** — a round has a winner and then the lobby forgets it.
No ready-up: a lobby is a place to wait, not a checklist. No health — a catch is
instant. No spectating, because being caught keeps you playing instead. One spawn
point per map. Paint has no undo and no per-part erase. **Almost no client
tests** — two headless geometry suites and nothing else — and
no test for the round trip home or for reconnection into a held seat. Each
folder's doc ends with the gaps specific to it.

# Ignore these links
https://kaylousberg.itch.io/kaykit-dungeon-pack - old one used
https://blendervoyage.itch.io/psx-style-modular-low-poly-dungeon
https://atomicrealm.itch.io/post-apocalyptic-interiors
https://joethejunkbox.itch.io/psx-subway-station
https://vyrez-games.itch.io/psx-horror-house-modular-pack-v1
https://amos-makes.itch.io/psx-hospital-pack
https://madduck.itch.io/modular-3d-hospital-environment - in use
https://valsekamerplant.itch.io/psx-style-opulent-office
https://ink-ribbon.itch.io/psx-restroom-environment-asset-pack
https://retroshaper.itch.io/dungeon-maker-with-geometry-nodes - interesting duengon
https://lewie-kowalski.itch.io/psx-retro-props-pack
https://mcpato.itch.io/house-interior-psx-assets
https://blendervoyage.itch.io/psx-style-modular-low-poly-dungeon 
https://quaternius.itch.io/medieval-village-megakit
https://loafbrr.itch.io/mines-and-cave-set
https://amos-makes.itch.io/psx-office-pack
https://aquicor.itch.io/psx-low-poly-kitchen-food-props-pack
https://elbolilloduro.itch.io/metro
https://chilly-durango.itch.io/medieval-building-parts

https://valsekamerplant.itch.io/psx-style-urban-stacked-pack
https://mcpato.itch.io/barranco-bar-ps1-environment
https://mcpato.itch.io/tombo-store-ps1-environment



https://freesound.org/people/Seth_Makes_Sounds/sounds/680134/
https://freesound.org/people/NHumphrey/sounds/204466/

https://cults3d.com/en/orders/164754001
