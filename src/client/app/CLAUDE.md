# app — the composition roots

**Owns:** the top-level state, the mode transitions, the Canvas, and the four
things that decide when anything heavy is downloaded.

## What's here

| file            | what                                                          |
| --------------- | --------------------------------------------------------------- |
| `Game.tsx`       | top-level state and every overlay. ~30 lines of state, one JSX tree |
| `session/`       | the hooks it is composed from — one mechanism each              |
| `Scene.tsx`      | Canvas, Physics, frame priorities, mark and grave lifetimes    |
| `crazygames.ts`  | the portal SDK — **switched off** — and the `?code=` invite link |
| `gamedistribution.ts` | the ad SDK: one break, two events, and a failsafe out of it |
| `loading.ts`     | one counter: is the player waiting on something to arrive      |
| `dev.ts`         | developer mode, and the player snapshot the readout samples    |

## The hooks

`Game.tsx` used to be 726 lines and 26 effects. Each hook below owns one
mechanism and the prose that explains it; the component is now composition.

| hook                    | owns                                                  |
| ----------------------- | ------------------------------------------------------- |
| `usePauseControl`       | pause, palette, chat, pointer lock — and their exclusion |
| `useNetEvents`          | every `net/` subscription, including the room reset     |
| `useRoundAudio`         | the tick, the bell, the gong, and the hunt's music       |
| `useRoundAssets`        | the map and music preloads                              |
| `useRoomGraves`         | graves, de-duplicated, dropped on `onLeftRoom`          |
| `useRoomChat`           | what has been said since you walked in — no backlog      |
| `useCaughtNotice`       | the three-and-a-half seconds after you are caught       |
| `useCrazyGames`         | the `?code=` auto-join; its portal half is switched off  |
| `useGameDistribution`   | the ad break, and the handle its two placements hang on  |
| `useWhistle`            | a chameleon's periodic tell                             |
| `useDevHotkey`          | backquote                                               |
| `useDevQuickPlay`       | dev builds: a game, a second window, and Start           |

## The three rules that will bite you

1. **Anything that renders the world is keyed on the *room*, never on
   `joined`.** Local state flips on the click; room state arrives a few hundred
   milliseconds later. Keying the player on `joined` fell back to `"chameleon"`
   for that window and spawned you into the lobby as a small third-person figure
   before snapping to the hunter's camera. `<Player>` is keyed on the room's
   code, which is what rebuilds the body at each map's spawn point.
2. **`paused`, `painting` and `chatting` are mutually exclusive, and
   `usePauseControl` owns all three** so no future path can forget. Losing the
   window was the exception that proved it: it set `paused` and left `painting`
   alone, hiding both the menu *and* the palette while the keys stayed dead.
   `chatting` is the newest and behaves like the palette — it hands the cursor
   back, drops the pointer lock, and `Game.tsx` folds it into `Scene`'s
   `paused` so the movement keys stop while you type into them.
3. **Nothing heavy is fetched on page load.** The Canvas is mounted behind the
   start menu, so anything on a mount effect is paid for by everyone who merely
   opens the game. There are four triggers and no others: the map and music on
   arriving in a lobby (and again at the countdown), the character and the eight
   small sounds on the join *click*.

## Contracts

- **Ads are GameDistribution's, and four of their rules are load-bearing**: the
  SDK loads once on mount and never from a button (or the first ad takes too
  long to arrive), while an ad *shows* only from a click and only outside
  gameplay (or the browser refuses to autoplay it). Pre-roll is the click that
  enters a game; mid-roll is leaving one from the pause menu. **The host's Start
  button is deliberately not a placement** — it begins a countdown everyone else
  is watching on a server clock, so an ad there is a player who misses the start
  of hiding.
- **`randomName` comes from `shared/`, not from `hud/`.** Both halves need it
  now: the menu offers one, and the server hands one out when `clean.ts`
  refuses a name. `useCrazyGames` names its auto-joining player from there.
- **The `?code=` auto-join must never show one.** It is a page load, not a
  click, which is why `createFromMenu` / `joinFromMenu` wrap the plain
  `create` / `joinCode` rather than the ad call living inside them —
  `useCrazyGames` and `reconnect` get the unwrapped pair.
- **An ad break is not a pause, but it wants what a pause wants**, so
  `usePauseControl` takes it as an option rather than a second writer deciding
  the same things. It mutes through the same `setAudioSuspended` call and hands
  the pointer lock back — an ad you cannot click because the cursor is captured
  is worse than no ad. **Two traps in that**: the lock has to be actively
  *taken*, since the lock effect only stops asking and a hunter is already
  holding one; and the `pointerlockchange` handler must ignore the break, or
  releasing the lock reads as Esc and opens the pause menu behind the ad.
- **The ad SDK loads only for portal traffic**, decided by
  `gd_sdk_referrer_url` being on the URL — which the wrapper always appends and
  a direct visitor to superchameleon.io never has. It is *not* decided by being
  framed, because the game can be embedded anywhere. **This is a safety rule
  before it is a commercial one:** an ad SDK loading on the game's own site can
  take that site down with it, and there is no reason to carry that risk for
  traffic the portal is not part of.
- **`GAME_ID` empty means the ad SDK is entirely off** — nothing is fetched and
  no break ever fires. **`AD_TIMEOUT_MS` is load-bearing**: `SDK_GAME_START` is
  the only thing that ends a break, so a blocked or failed ad would otherwise
  leave the game paused and muted while a server-side round clock runs down.
- **Nothing about the game is uploaded to GameDistribution.** They allow
  external hosting for real multiplayer games; what they take is the wrapper in
  `gamedistribution/`, which is not part of the build. See
  `docs/DEPLOYMENT.md`.
- **The CrazyGames integration is off, and `crazygames.ts` is not dead code.**
  `SDK_ENABLED` there is `false` and the SDK `<script>` is gone from
  `index.html`; restoring one without the other leaves every call hunting for a
  `window.CrazyGames` that never loads. **What the file still carries is the
  plain invite link** — `generateInviteLink` builds `?code=ABCD` against our own
  origin for the lobby's Copy button, and `getInitialInviteRoom` reads it back
  for the start menu's code box and for `useCrazyGames`' auto-join. Those were
  always the fallback path and are now the only path, so deleting the file to be
  rid of the portal takes invites with it.
- **`Game.tsx` owns the HUD keys — `T`, `F`, `G` and `R`.** None of them
  belongs to `players/controls.ts`, which is drei's keyboard map for things the
  frame loop polls. `T` is chat, `F` is paint mode, `G` arms the eyedropper
  inside it, and `R` is the pose wheel — which owns its own key entirely, since
  it owns the whole hold-flick-release gesture. `picking` is *derived* from the
  armed flag and paint mode being on, so it cannot outlive the mode.
- **Both roles hold the pointer lock**, so the cursor comes back for exactly
  three things: the pause menu, the chat box and paint mode. The pose wheel is
  the exception that proves it — it is steered by the *locked* pointer's raw
  movement, so it keeps the lock and is folded into `Scene`'s `paused` instead,
  which holds the body still and stops the same movement turning the camera.
- **Walking leaves paint mode.** The movement keys stay live while the palette
  is up — `Scene`'s `paused` deliberately does not include `painting` — so
  setting off used to mean walking with a free cursor and no camera. The key
  list comes from `players/controls.ts` rather than being written out again, and
  it fires on the first keydown, before the body has gone anywhere.
- **A change of room is a clean slate**, and `net/`'s `onLeftRoom` is the one
  place that says so. Anything added later that belongs to a room resets there.
- **Anything replayed on join subscribes from `Game.tsx`, never from the panel
  that draws it.** `net/client.ts` replays graves during `attach`, before the
  join promise resolves — so a listener owned by a component that mounts on
  `room` arriving has already missed the backlog. **Chat has no backlog any
  more** — it is a broadcast the server keeps none of — but `useRoomChat` still
  subscribes here, because the panel mounts a few hundred milliseconds after the
  socket goes live and a line landing in that window would be lost.
- **`Scene.tsx` owns the frame priorities**, the game's one ordering guarantee:
  `0` decides where things are, `1` copies a result of that (the viewmodel, the
  audio listener), `2` draws, `3` reads the drawn frame back. Mount order is not
  a substitute.
- **`FrameLimiter` skips the draw, not just the work in it**, and priority 3 runs
  anyway. It must call `markDrawn()` after `gl.render` so the eyedropper knows
  which frames have a framebuffer worth reading — see `paint/CLAUDE.md`.
- **`Scene.tsx` passes the phase down as three separate facts** — `reveal`,
  `hunting`, `frozen` — because each is read by a different part of the tree.
- **The hunter hunts through a coarser picture, and it is two Canvas props.**
  `blinded` is `role === "hunter" && (hunting || reveal)`; it drops `dpr` to `HUNT_DPR` and
  `HUNT_UPSCALE` decides how that frame is stretched back up — `auto` for the
  soft blur it uses now, `pixelated` for a crunchy one. **Gated on the phase as
  much as on the role** — everyone in a lobby is nominally a hunter, so the role
  alone would blur the waiting room. **The reveal is one of those phases**: it
  used to lift at the gong, which handed every hunter a sharp picture of the
  spots that had just beaten them. The survivors are the exhibit and see it
  clearly; the people who could not find them go on looking through the picture
  they lost through. `HuntVision` in `hud/` is gated on exactly the same pair
  and the two must not drift.
- **That blur is live, not a startup setting.** It is two plain props rather
  than an effect because r3f re-applies `dpr` on every render of the Canvas and
  a store subscription turns that into `setPixelRatio` + `setSize` on the spot —
  so it comes on at the bell and lifts at the reveal with no remount and no lost
  GL context. Doing it with `setDpr` from an effect would mean owning the
  restore too, and the React Compiler's lint refuses the `gl.domElement` write
  that the nearest-neighbour half would need.
- **What the blur reaches is exactly what is inside the Canvas.** `hud/` renders
  outside it, so no menu, banner or player list can be caught by this even by
  accident, and the crosshair is the CSS cursor. The shotgun viewmodel *is*
  in-canvas and is left in deliberately: a sharp gun held against a soft world
  is what would look broken.
- **`leave` is the only exit, from either room.** There is no "back to the
  lobby" path out of a match: a player who walked out of a round is out of it.
- **Esc never *opens* the pause menu any more; losing the lock does.** Now that
  both roles hold one, a playing player's Esc is spent by the browser releasing
  it, and `pointerlockchange` is what raises the menu. Esc still reaches the app
  while the cursor is already free, where it closes the chat box, paint mode or
  the menu itself — and a menu that opened by pausing must not be dismissed by a
  keystroke arriving while the page is in the background, which is `hasFocus`.
- **`useDevQuickPlay` drives the ordinary path fast; it does not add a new
  one.** It opens a lobby, points a second window at the `?code=` invite, and
  sends `start` when the seat fills. **The popup is opened in the click
  handler**, parked on `about:blank` until there is a code — one opened later
  from the effect is outside the gesture and every browser blocks it. Nothing
  about the server changes for it, and nothing may: a solo version means forking
  `MIN_PLAYERS` and the win conditions, and the draw stays the server's.
- **Developer mode is `import.meta.env.DEV`** and must not be reachable in
  production — not by an env var, not by a query parameter, not by a key. The
  point of tying it to the build is that there is no switch to find.
