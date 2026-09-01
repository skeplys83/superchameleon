# Super Chameleon

<img width="1914" height="967" alt="image" src="https://github.com/user-attachments/assets/8c62910d-3f56-489e-93d8-7124af27c636" />


A multiplayer hide-and-seek game. Chameleons are stick figures who can lie
on their side to pass as scenery; hunters hunt them in first person with a
shotgun. No internet, no accounts — everything runs on machines on the same
Wi-Fi.

## Run it

```bash
npm install
npm run dev
```

This starts a custom server (`src/server/index.ts`, TypeScript run
directly by Node — no build step): the page on `:3000`, served through Vite in
middleware mode, and a Colyseus game server on `:2567`. It prints a local-network URL —
other players on the same Wi-Fi open that.

Press **Create game** and you get a waiting room in the arena with a four-letter
code. Games are public by default and show up in everyone's menu with a player
count, or untick the box and hand the code out yourself — either way the code is
what gets you in. Everyone waits armed. When the host presses Start, the whole
room moves to the chosen map, one player keeps the shotgun and the rest become
chameleons. A match runs for sixty seconds; when it ends everyone is back in the
waiting room and the host can start another. One server runs as many games at once as you like. A code is the only way
into a game — nothing is listed.

Env vars: `PORT` (web), `GAME_PORT` (Colyseus), `SESSION_NAME`.

## Controls

`WASD` to move, mouse to look, `Q`/`E` to turn the figure, `Space` to jump.
Click the canvas to lock the cursor, `Esc` to release.

You do not choose a side — the hunter is drawn at random when the match starts.

- **Hunter** — first person with a shotgun, left click to fire (pump-action, so
  there is a delay between shots). Everyone is one in the waiting room, and
  exactly one stays one per match. Nobody can be killed while waiting.
- **Chameleon** — third-person camera, `1`–`5` for poses, left-drag to paint
  yourself, and the only side that can climb.

If your connection drops mid-match the server holds your seat for twenty
seconds — reconnect inside that and you keep your side, your position and your
paint. Your body stays standing there in the meantime, and can be shot.

Chameleons can climb: walk into a wall or an object and you go onto it. `W`/`S` run
up and down the face, `A`/`D` across it, and `Space` lets go. Climb high enough
and you wrap onto the ceiling.

Sound is positional: footsteps, gunshots and deaths come from where they happen,
and a chameleon's lighter footsteps are pitched above a hunter's. Climbing is silent.
Every 45 seconds you whistle, and anyone near enough hears roughly where you are.

## Stack

About ten thousand lines of TypeScript in one repo, running as **two runtimes
that share exactly one file** — `src/shared/protocol.ts`, which holds the
roles, the phases and every constant both halves must agree on.

```
        BROWSER                              NODE
  ┌──────────────────────┐          ┌──────────────────────┐
  │ React 19 · Vite 8    │  :3000   │ node:http + express  │
  │ three.js / R3F       │◀────────▶│ Vite (dev middleware)│  page + assets
  │ rapier (wasm)        │          │ /api/sessions        │
  │ colyseus.js          │◀════════▶│ Colyseus 0.16        │  gameplay (:3000 / :2567)
  └──────────────────────┘   ws     └──────────────────────┘
```

### Browser

| | |
| --- | --- |
| **Vite 8** | the bundler — and it runs as *middleware inside the game server*, not on a port of its own |
| **React 19** | no framework, no router, no SSR. One page, one component tree |
| **Tailwind v4** | through `@tailwindcss/vite`; one short stylesheet |
| **three.js** | the renderer |
| **@react-three/fiber** | a React reconciler for three |
| **@react-three/drei** | `useGLTF`, `Html`, `KeyboardControls`, `Sky` |
| **@react-three/rapier** | Rust physics compiled to wasm — about half the JS payload |
| **colyseus.js** | the game socket |

### Node

**The server is TypeScript that Node runs directly.** Node 22 strips the types
at load, so `node src/server/index.ts` just runs and **there is no build
step for the server at all** — `npm run build` produces only the client. That is
why its schema uses `defineTypes()` rather than decorators, why fields are
`declare x: T` and never `x!: T`, and why its imports name the real file
(`./room.ts`). Get any of those wrong and it fails at *startup*, not at build.

Colyseus 0.16 is pinned across four packages on purpose; `CLAUDE.md` explains what
breaks if you bump one of them alone, and it is not obvious.

### Three listeners, deliberately

`:3000` the page · `:2567` Colyseus · `:24678` Vite's HMR socket in development,
plus UDP `:41234` for finding other servers on the same network.

They are separate because handing a WebSocket server the HTTP server's `upgrade`
event destroys every non-matching upgrade — which killed HMR once, which stopped
the client bootstrap, which meant nothing mounted and no button on the page
worked. Nothing in the web server touches `upgrade`.

### Tooling

`tsc --noEmit`, ESLint flat config (`typescript-eslint` + `react-hooks`), and
`vite build`. Plus three checks of this project's own, run by a pre-commit hook:
`check:docs` fails a commit that stages code without the folder doc covering it,
`check:constants` fails a constant defined twice, and `check:maps` checks map
assets. Hosting is a Node 22 Docker image carrying `dist/` and `src/`, installed
`--omit=dev`.

## Layout

The code splits three ways, and the split is enforced by ESLint and by two
tsconfigs rather than by convention. **Each folder documents itself** in a short
`CLAUDE.md` beside the code: what it owns, the three rules that will bite you,
and its contracts with the folders around it. The long-form reasoning behind each
lives in `docs/notes/`.

```
src/
  shared/   Role, the protocol constants, the map registry  <- both halves
  server/   Colyseus rooms, matchmaking, schema, HTTP       <- runs in Node
  client/
    app/    Game.tsx, Scene.tsx, the session hooks
    net/ world/ figure/ paint/ players/ combat/ sound/ hud/ <- the browser
public/sounds/   ten .mp3 files, peak-normalised to -1 dBFS; the two music
                 beds are loudness-matched to each other instead
```

Start at [CLAUDE.md](CLAUDE.md) for the map and the project-wide traps, then read
the doc for the folder you are changing.

## Hosting it

```bash
docker compose up -d --build
```

Then open `http://localhost:3000` — or the machine's address from anywhere else —
and press **Create game**.

The image has been built and run: the page is served, a lobby is created, a
second client joins it by code, Start moves both into one match on the chosen
map, and no `typescript` or Tailwind is present at runtime.

In production and Docker, a single port is published: both the web app and
Colyseus WebSockets run on `PORT` (3000).

**With a domain, HTTPS, or Cloudflare Tunnel:** See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the complete guide on building locally, pushing to Docker Hub, and deploying via Portainer and Cloudflare Zero Trust. Put a reverse proxy (e.g. Caddy / Nginx) or Cloudflare Tunnel in front on 443, and set `PUBLIC_GAME_PORT: 443`.

| variable | what it does |
|---|---|
| `PORT` | web port, default 3000 |
| `GAME_PORT` | Colyseus listener port (default 2567 in dev, defaults to `PORT` in production) |
| `PUBLIC_GAME_PORT` | Colyseus port clients are **told** to use — set to `443` when a TLS proxy fronts it |
| `SESSION_NAME` | name the server reports for itself |
| `MONITOR_PASSWORD` | enables the admin panel in production, behind Basic auth |
| `MONITOR_USER` | username for that, default `admin` |
| `MONITOR` | `0` turns the panel off in development |

## Watching it run

Colyseus's admin panel is mounted at **`/monitor`** — open
<http://localhost:3000/monitor> while the server is running.

It lists every live room. This game makes two kinds, so the list is the clearest
picture of what the matchmaking is doing:

- rows named **`lobby`** are waiting rooms. Their `host`, `map` and `started`
  columns come from the same metadata the menu's game list reads, so a lobby with
  `started: true` has a match running that its players are in.
- rows named **`match`** are games in progress. They have no metadata and are
  never listed in the menu — you reach one by being moved into it.

Click a room to inspect it. You get its state live — every player, their
position, pose, role and paint strokes, plus `timeLeft` ticking down on a match —
and the connected clients. Watching a lobby and its match side by side is the
only way to see the hand-off from outside; a player only ever sees the room they
are standing in.

**It is not read-only.** The panel can call any method on any room, including
disposing it, so anyone who can reach it can end anybody's game. That is why:

- in development it is on with no password — only you can reach `localhost`. Set
  `MONITOR=0` to turn it off.
- in production it does not exist unless `MONITOR_PASSWORD` is set, and then it
  is behind HTTP Basic auth. Forgetting the password fails closed rather than
  exposing it; the startup banner says which happened.

Basic auth sends the password in near-cleartext, so on a hosted box only enable
it behind the same TLS proxy that fronts the rest.

## Working on it

```bash
npm run check:docs        # are the folder docs current with what's staged?
npm run check:constants   # is any shared constant defined twice?
npx tsc --noEmit
npx eslint .
npm run build
```

A pre-commit hook refuses a commit that changes a folder's code without touching
that folder's `CLAUDE.md` — the docs are the only thing a fresh contributor (or
coding agent) reads first, so they are gated rather than merely encouraged.
Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

## Status

Movement, roles, poses, painting, shooting, kills, positional sound, local-network
discovery, reconnection, and many simultaneous games — lobbies, invite codes,
sixty-second matches and the trip back to the lobby — all work. Health, a hide
phase, a win condition and ready-up are not built yet: a round has a length but
no result.
