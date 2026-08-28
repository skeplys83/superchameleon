# hud — everything drawn outside the Canvas

**Owns:** the menus, the panels, the legends, and the loading screen.

## What's here

The start menu and its map list, the lobby panel, the
player list, the phase banner, the pause and dropped panels, the round-over
panel, the controls legend, the loading screen, the mobile gate, the legal page,
and the developer readout.

**The fallback player names are no longer here.** They moved to
`shared/names.ts` when the server started handing them out too — it replaces a
name its filter refuses, and it cannot import from this folder. `StartMenu`
reads them from there now.

## The three rules that will bite you

1. **This folder never imports from `world/`, `figure/`, `players/` or
   `combat/`.** It is DOM outside the Canvas and talks to the game through
   `app/Game.tsx` props and through `net/`. Reading `figure/poses` for a label is
   the one allowed exception. **This is now an ESLint rule**, not an honour
   system — the last time it was breached, React state ended up in a frame loop.
2. **The debug readout samples; it is never driven by the frame loop.**
   `players/Player.tsx` writes a snapshot into `app/dev.ts` and the panel reads
   it ten times a second. Anything else worth watching goes through that
   snapshot — not a new import, not props threaded down from `Game.tsx`.
3. **Nobody picks a side, and no menu may offer one.** Everyone waits as a
   hunter and the draw happens at the countdown's end, so the player list hides
   roles until they exist — labelling them earlier prints "hunter" beside every
   name and spoils something that has not happened yet.

## Contracts

- **Only the host sees Start or the map buttons**, and that is a display rule on
  top of a server check, never instead of one.
- **The lobby panel stays up while paused** — everyone in a lobby holds the
  pointer lock, so pausing is the only moment Start is clickable at all.
- **A lobby has four phases, and `LobbyPanel` only draws two of them.**
  `waiting` and `countdown` are its own; during `hiding` it is replaced outright
  by `HunterWait`, because the invite code, the roster and the map picker all
  answer questions the round has already settled — it read as a game still
  waiting to start. `reveal` only happens when a match ended before its hunter
  was sent in, and the panel suppresses Start and its player count for it.
- **Nothing in the top-centre column positions itself.** `Game.tsx` stacks the
  lobby card and `PhaseBanner` in one flex column, so the gap is laid out rather
  than guessed at. Both used to be pinned `absolute top-4` and the clock
  rendered *behind* the panel; the first fix was an offset prop, which was worse
  — it had to be recalculated whenever the panel's height changed, and it was
  silently wrong the whole time because nothing passed it.
- **The pause menu has one way out, and it leaves the game.** It used to offer a
  match player "return to the waiting room", which dropped them into a lobby
  whose clock was still running — indistinguishable from still being in the
  round. Either you are playing it or you are out.
- **Every map picker asks `playableMaps(DEV)`, never `MATCH_MAP_LIST`.** Two
  things are filtered out: the arena, which is where you already are, and any id
  in `DEV_ONLY_MAPS` — a map still being built. `DEV` is substituted by vite, so
  in the image those entries are dead code and the map cannot be reached from
  the UI. **The server still accepts them**: it cannot tell which build asked,
  and a second source of truth for "is this map real" is worse than a menu that
  simply does not offer one. This is the Quick play rule, applied to maps.
- **`ui.ts` is the look, and it is not per panel.** Big, bold, round: `PANEL`,
  three `BUTTON_*`, `CHIP`, `INPUT`, `LABEL`. Every panel used to carry its own
  sizes, so the pause menu was a font size smaller than the lobby card beside it
  and the chat prompt smaller again — a difference nobody chose, arrived at one
  component at a time. They are class strings rather than components because
  half of these elements need a `disabled`, an `autoFocus`, a `type="submit"` or
  a colour that depends on state, and forwarding all of that costs more than the
  class list it replaces.
- **Play now owns the middle third, centred in it.** The menu is three columns
  and it is the one thing the page is for, so it sits in the middle at the
  height of the eye with the name box over it. It nudges itself every five
  seconds
  — `play-nudge` in `index.css`, four fifths of the cycle spent at the identity
  transform so it reads as asking for attention rather than as vibrating, and
  `transform` only, so it is compositor-only and cannot move anything around it.
  **The nudge is dropped while the button is disabled** (no server yet) and
  under `prefers-reduced-motion`: a control waving at you that it will not
  answer is worse than a still one.
- **The menu asks nothing: Play now opens a lobby on the defaults.** There was a
  modal for the map, the listing and the size, put in front of a player who had
  not seen the game yet. The map is the host's to change *in* the lobby, public
  is the rule rather than the exception, and the size only ever mattered to
  somebody who already had friends waiting — so it is `DEFAULT_MATCH_MAP`,
  listed, `DEFAULT_PLAYERS`, and straight in. **A lobby's size is now fixed at
  creation with nothing to change it**: anything that wants it back belongs in
  `LobbyPanel`, not in a gate before the game.
- **The start menu is exact thirds, and the grid carries no gap.** Maps in the
  top-left corner, the public list in the top-right, and everything you can
  actually press down the middle: the title, your name, Play now, and the code
  box under it. A `gap` on the grid would make each column a third *minus* its
  share of that gap, which is the thing "the map list takes the first third"
  stops being true of; the breathing room is padding inside each column instead,
  so the outer two run to the edges of the screen.
- **Only the middle column is centred.** The two lists start at the top, in the
  corners, and fill the height with `flex-1 min-h-0` so they grow with the
  window rather than with what is in them. Centring the *scroller* instead
  clips the top of anything taller than the viewport, which is why the middle
  column does its own centring rather than the page doing it for all three.
- **The code box goes under Play now, never beside it.** They are the same
  decision asked twice, and a code box level with the button reads as an equal
  choice when it is the exception — you only have four letters if somebody
  handed them to you. Desktop only: `MobileUnsupported` turns phones and tablets
  away before any of this renders, which is what lets three fixed columns be
  safe.
- **The map appears in two places, at two weights.** `MapList` is the showcase
  and takes the left third. It carries **no border and no plate** — the cards
  have their own, and a frame around a column of framed cards is chrome for
  nothing. **The parent owns its height**; the panel is `h-full` and scrolls
  inside, because a list that grew the page would push the row off the bottom
  the moment a fourth map landed. That is also why the scroller is a plain
  `overflow-y-auto` around a `min-h-full` column rather than a `justify-center`
  flex box: centring the scroller itself clips the top of anything taller than
  the viewport. The lobby panel is the smaller of the two: chips, because the
  decision is already made and this is the host changing their mind.
- **The map is frozen for the countdown.** The picker greys out the moment
  `phase` is `countdown` and the server refuses `setMap` alongside it — everyone
  is already preloading what the phase change told them to fetch, so a switch at
  second four sends half the lobby somewhere the other half is not going. The
  greying is the display half of that rule; `lobby.test.ts` pins the server half.
- **A listed game shows the players in the whole game**, across both its rooms.
- **`ChatPanel` owns bottom-left, and only its bottom box has a background.**
  `PlayerList` has top-left and `PaintPanel` bottom-right; **bottom-centre is
  the controls legend's** since it moved out of the top-right corner, which
  pushed the error toast up to `bottom-32` to clear it. `DebugPanel` is pushed
  to `left-[22rem]` to clear it, unconditionally, because a dev chip that moves
  between rooms is harder to find than one that does not. The box renders in
  `waiting` and `countdown`, the same window the server accepts a `chat`
  message in (`Game.tsx` owns that condition) and takes its lines as a prop —
  subscribing to `onChat` from inside it would miss anything said in the window
  between the socket going live and `room` arriving, see
  `app/session/useRoomChat` — and for the whole of it: closed
  it is the prompt naming the key, open it is the field. It used to appear only
  once somebody had spoken, which left the first player in a lobby no way to
  discover chat existed. **The lines above it float** — no plate, no blur, no
  scrollbar, `pointer-events-none`, and clipped at the top by `justify-end`
  inside a `max-h` rather than scrolled, so a long conversation cannot grow up
  the screen. **The prompt is the only place `T` is advertised** —
  the controls legend deliberately does not repeat it, and the key is therefore
  *not* gated on `paused` or `painting`, because a prompt that is legible while
  the key does nothing is worse than no prompt. Its input **stops every keydown**: the movement keys are bound on
  `window` by drei's `KeyboardControls`, so without it typing "was" walks you
  across the arena. That is also why Esc is handled inside the input rather
  than by `usePauseControl` — the stopped event never reaches the global one.
- **`HuntVision` is grain and a vignette over the hunter's own view**, on
  exactly the condition `Scene` blurs on — the hunt *and* the reveal, so a
  hunter never gets a clean look at the spot that beat them. It exists because `HUNT_DPR` is a
  *resolution* handicap: its strength is proportional to how few pixels a
  chameleon covers, so it is mush at twenty metres and nearly free at two, where
  a body still fills hundreds of pixels after the downscale. Grain has the same
  amplitude everywhere on screen, so it costs a close body what it costs a
  distant one, and what it eats is the soft edge a blur leaves behind. **Two
  divs and a compositor-only animation** — no render target and no post-process
  pass, which is the whole reason it can live out here. Mounted before the
  panels, so the vignette darkens the world and never the HUD.
- **`PoseWheel` owns its whole gesture** — `R` held, the locked pointer's raw
  movement, which wedge is lit, and the release that commits — and hands out
  only two things: whether it is open, so `Game.tsx` can hold the world still
  under it, and the pose that was picked. **Everything it draws comes off
  `POSES.length`**, so a new row in the table is a new slice with no geometry to
  re-measure. It takes the pose being held as a **getter**, not a number: the
  pose lives in the frame loop's half of the app and changing it does not
  re-render the HUD, so a value passed by prop would be whatever it was when
  this tree last drew. It is the one place besides the legend that names `R`.
- **The controls legend is the chameleon's, and there is no other.** A hunter
  walks and shoots; their legend said WASD, Space, Mouse, Left click, which is
  four rows of what every first-person game has already taught, so they get no
  panel at all. What is left names only what is particular to this game — the
  pose wheel, the turn keys, paint mode — with WASD, Space, the mouse and the
  scroll wheel left out for the same reason.

  **It is a row of key caps along the bottom, centred**, not a table in the
  corner. The top-right is the one part of the screen a third-person player
  never looks at: the body they are steering is in the middle and the ground
  under it is below that. **The caps' corner radius is a fixed length, not a
  percentage** — a percentage radius is resolved per axis, so "Right drag" came
  out an ellipse beside a square `G`. The number keys are left off entirely:
  they still work, but printing them under the wheel was the same five poses
  said twice. **Paint mode swaps the row rather than adding to it**: none of
  those controls is reachable until `F` is pressed, and both sets at once is a
  wall rather than a legend. The strip is `pointer-events-none`, because the
  palette and the chat box both reach up into it — and the error toast sits at
  `bottom-32` to clear it. **Everyone waiting in a lobby is nominally a
  hunter**, so the panel appears when the draw gives you a side with something
  to learn, and the top-right corner is empty until then.
- **The start menu's one dev affordance is Quick play**, gated on `DEV` so vite
  drops it from the production bundle along with the hook behind it. It does not
  breach the no-picking-sides rule: it starts a round, and the draw is still the
  server's.
- **The clock is displayed, never counted.** `timeLeft` comes off room state.
- **The DEV chip stays visible when the readout is hidden.** It is the toggle,
  and a switch that vanishes when you use it is a trap.

---

Twenty-four invariants, the create flow's reasoning, and the listing's
polling contract: [docs/notes/hud.md](../../../docs/notes/hud.md).
