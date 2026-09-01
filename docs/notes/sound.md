<!-- Archive. The short doc that agents actually read is the CLAUDE.md in
     the folder this describes. Everything here is the long-form reasoning
     behind it: the full invariant list, the tuning, and the debugging
     sessions each rule was paid for with. Kept because it is expensive
     knowledge, demoted because nobody finishes a 500-line file. -->

# sound — everything that makes a noise

**Owns:** the Web Audio plumbing, the catalogue of sounds, the listener that
follows your head, and the footstep derivation.

**Entry points:** `playSound` / `startLoop` / `stopLoop` / `unlockAudio` /
`setAudioSuspended` / `preloadSounds` / `preloadMusic` from `engine.ts`;
`SoundStage`; `Stepper` / `jitteredStepRate` / `strideFor` from `footsteps.ts`.

## Files

- `catalogue.ts` — every sound, its file, its gain, whether it is positional, and
  whether it is `deferred` (the music, and only the music).
  Nothing else: `WHISTLE_INTERVAL_MS` lives in `shared/`, because the server
  rate-limits against it. A copy briefly lived here too and was the one people
  found first, which is why `scripts/check-constants.mjs` exists.
- `engine.ts` — the context, the master gain, the decoded buffers, the listener,
  one-shot playback and looping playback. Nothing is exported from it that has no
  caller; `audioReady` and `brokenSounds` were removed once it was clear the HUD
  hint and the test seam their comments promised had never been written.
- `footsteps.ts` — turns a stream of positions into footfalls, and pitches them.
  The round sounds are deliberately *not* here: they have no cadence and no
  position, so there is nothing for this file to do with them.
- `SoundStage.tsx` — mounted in the Canvas at **frame priority 1**, because the
  listener copies the camera and must run after the frame that places it — the
  same ordering rule `combat/Viewmodel` needs, and for the same reason. Drives
  the listener and plays the
  networked events. Renders nothing.

### Where the music came from

Both beds are **CC0**, from Freesound, so nothing in the repo owes an
attribution — recorded here only so a future edit knows what it is holding and
does not have to re-establish the licence.

| file             | source                                                                       | as published        |
| ---------------- | ---------------------------------------------------------------------------- | ------------------- |
| `hide-music.mp3` | *Trotting Along* — code_box, [614726](https://freesound.org/s/614726/)        | WAV, 35.000 s, CC0  |
| `hunt-music.mp3` | *You Could Hear A Pen Drop* — Beetlemuse, [557474](https://freesound.org/s/557474/) | WAV, 97.715 s, CC0 |

**Both were taken from Freesound's 128 kbps preview rather than the original
WAV**, which needs an account to download. That is one lossy generation before
ours. It is inaudible at the level these play at, but if either bed is ever
reworked, start from the original upload rather than from the file in `public/`.

## Invariants

1. **Positional sounds must be mono.** A stereo buffer cannot be spatialised —
   left and right are already baked in, so the panner has nothing left to place
   and the sound appears to come from everywhere at once. That is not a theory:
   `whistle` shipped stereo and sounded exactly like that until it was
   converted. Everything positional — `step`, `shotgun`, `squash`, `whistle` —
   is mono. The non-positional ones are not, and need not be: `brush`, because it
   is your own hand at your own ear, and `tick` / `bell` / `gong`, because they
   are announcements about the round rather than events in the world.
   `preloadSounds` warns if a positional file arrives with more than one channel,
   because the symptom otherwise reads as "3D audio is just subtle".
2. **Loudness is raised by compression, not by a gain above 1.** Every file peaks
   at −1 dBFS, so a catalogue gain over 1.0 clips. When a sound needs to be
   *louder* rather than *hotter*, lift its average level and re-normalise —
   `squash.wav` went from −22.6 dB mean to −18.6 dB that way, +4 dB perceived,
   with its peak untouched:

   ```bash
   ffmpeg -i s.wav -af "acompressor=threshold=-20dB:ratio=3:attack=5:release=140" _s.wav
   # then peak-normalise _s.wav back to -1 dBFS as below
   ```

3. **Overlapping copies of one sound add, and the catalogue gain is per *copy*,
   not per event.** The gong is struck three times 220 ms apart and rings for two
   seconds, so all three are sounding at once — at 0.9 apiece the sum was near
   2.7 and clipped the master, which is exactly what invariant 2 forbids. Its
   gain is therefore 0.42, under half the bell's, and the strikes taper by
   `GONG_FALLOFF`; the three together now peak just under 1. **Anything played
   more than once inside its own duration has to be budgeted this way** — read
   the catalogue number as the volume of one copy and multiply.
4. **Every file is peak-normalised to −1 dBFS, and normalised *after* encoding.**
   A `gain` in the catalogue is then a real proportion instead of a guess about
   how hot that export happened to be. This is not housekeeping: `step` shipped
   21 dB below `shotgun`, and multiplied by a cautious gain it sat ~34 dB under
   the gunshot — perfectly wired, completely inaudible, and easy to misdiagnose
   as a broken trigger.

   **The order is what is easy to get wrong.** A lossy codec does not preserve
   the peak it was handed: the decoder reconstructs intersample peaks and can
   land *above* the source. `bell`, normalised to −1 dBFS as a wav, came back
   from LAME at **0.0 dBFS** — no headroom at all, beneath a gong already tapered
   to sit just under 1.0 in sum. Normalise what the browser will actually decode,
   and iterate, because the peak does not move linearly with the pre-gain:

   ```bash
   ffmpeg -y -i new.wav -c:a libmp3lame -b:a 96k out.mp3
   ffmpeg -i out.mp3 -af volumedetect -f null /dev/null     # read max_volume
   ffmpeg -y -i new.wav -af "volume=<-1 minus that>dB" -c:a libmp3lame -b:a 96k out.mp3
   # repeat until it settles — two or three passes is usual
   ```

   Seven of the nine land within 0.1 dB of −1; `step` and `whistle` sit 0.2 dB
   out and were left there. The spread across the catalogue is 0.3 dB, and the
   purpose of the rule — a known, consistent level, so a gain means something —
   is met.

   **4a. The two music beds are matched on loudness, not on peak — and that is
   a deliberate exception to the rule above.** They are the only two files that
   have to be interchangeable: they play in the same role, one phase apart, and
   the brief was that neither is louder than the other. Peak is the wrong
   quantity for that, because perceived level tracks the *average*, and the two
   have different crest factors — `hide-music` is struck marimba and drum,
   `hunt-music` is sustained bells. Peak-normalising both to −1 dBFS leaves them
   0.8 LU apart, which is audible as a step at the bell.

   So both are normalised to the same **integrated loudness, −15.2 LUFS** (EBU
   R128), and the peak ceiling is honoured by whichever of the two is hotter:
   `hide-music` lands at −1.2 dBFS and `hunt-music` at −1.9. Neither is above
   −1, so invariant 4's actual purpose — headroom, and a gain that means
   something — still holds; what changes is that the *pair* is levelled rather
   than each file alone. **They therefore carry the same catalogue gain, and
   changing one without the other is a bug.**

   ```bash
   ffmpeg -hide_banner -i f.mp3 -af ebur128=framelog=quiet -f null -   # read I
   ffmpeg -y -i f.wav -af "volume=<target minus I>dB" -c:a libmp3lame -b:a 128k f.mp3
   ```

   0.095 was then chosen so the pair sits exactly where the old single
   `ambient` bed did: that file was −21.7 LUFS at gain 0.2, i.e. −35.7 LUFS
   arriving at the master, and −15.2 LUFS at 0.095 is −35.7. **The level was
   already tuned and is not being re-litigated** — only the files under it
   changed.
5. **Everything is MP3: not wav, and not Opus.** Opus is a further 25% smaller
   and was rejected because its Ogg-container support in Safari is patchy, and a
   guest opens this game on whatever device is to hand. Same reasoning as trap 3:
   what matters is that it works for *everyone on the Wi-Fi*, not for whoever is
   developing. MP3 decodes everywhere through `decodeAudioData`. Bitrates are 64k
   for the mono positional sounds, 96k for the stereo announcements and 128k for
   the music, which took `public/sounds/` from **15.6 MB to 1.3 MB**.

   That saving is **download, disk and git only**. A decoded `AudioBuffer` is
   float32 PCM whatever it came from, so the music still occupies ~29 MB of
   memory in every client and always will.

6. **A looped file needs its seam closed.** `brush` arrived ending at full
   level while starting near silence, so every 0.78 s the loop stepped straight
   down — an audible click, forever, under the one sound that is supposed to sit
   in the background. Check both ends against the middle and fade whichever one
   is hot:

   ```bash
   ffmpeg -ss <duration-0.004> -t 0.004 -i loop.wav -af volumedetect -f null /dev/null
   ffmpeg -i loop.wav -af "afade=t=in:st=0:d=0.004,afade=t=out:st=<d-0.012>:d=0.012" out.wav
   ```

   **The music beds needed the stronger version of this, and a fade would have
   been the wrong tool for both.** A fade closes a click by opening a hole,
   which is fine for `brush` at 0.78 s and ruinous for a bed that wraps in the
   open. Both were cut to a whole number of their own period instead, found by
   autocorrelating the head against every candidate lag, and then self-
   crossfaded over 40 ms so the material either side of the seam is the same
   material:

   - `hide-music` — period 8.750 s; the source is exactly 4 of them (35.000 s)
     and so is already a loop musically, but the wrap still stepped 0.098 in
     one sample against a p99.9 of 0.050, which is an audible click. Cut to
     34.960 with the last 40 ms laid over the head: step 0.0065, under the
     median.
   - `hunt-music` — period 3.4285 s. The source ends by falling off a cliff into
     1.84 s of digital silence, so it cannot simply be truncated. 26 periods
     (89.14145 s) correlate with the head at 0.95, the best of any candidate
     lag; cut there, the wrap steps 0.00004 against a median of 0.00076.

   **Measure the wrap, do not eyeball the waveform.** The check is the
   last-sample-to-first-sample delta against the file's own distribution of
   adjacent-sample deltas — a step inside the p99.9 is inaudible, one above it
   is the click.

7. **The context unlocks on *any* gesture, not just the join click.** Browsers
   start every context suspended and only honour `resume()` from a user gesture.
   `Game.tsx` calls `unlockAudio()` on Create or Join, and that is the intended
   path — but it was a single point of failure for the entire game's audio, and
   when it failed it failed *silently*. `engine.ts` now also binds capture-phase
   `pointerdown` / `keydown` / `touchstart` listeners beside the context it
   unlocks, and drops them once it is running. `keydown` is the one that matters:
   you cannot walk without pressing a key, so footsteps can never be the first
   thing to discover the context is still locked.
8. **A dropped sound says why, once — but not when the pause did it.** If
   `playSound` is called while the context is not running it retries the resume,
   drops that one sound, and warns to the console, naming the sound and the
   state. A silent game with a silent cause is the worst thing this module can
   do, and it cost a full debugging round. `setAudioSuspended(true)` records that
   the silence is deliberate, so the whistle firing behind the pause menu does
   not cry wolf — a diagnostic nobody trusts is worse than none.
9. **The context is created early, resumed late — but nothing is fetched on page
   load.** Constructing a suspended `AudioContext` needs no gesture, which is why
   `preloadSounds` can decode before anything has been clicked. It used to run in
   `SoundStage`'s mount effect, and that was the bug: `Game.tsx` imports `Scene`
   statically and the Canvas stays mounted behind the start menu, so the whole
   catalogue — 1.3 MB — downloaded for anybody who so much as opened the game.
   The fetch now hangs off the moment each half is wanted, both called from
   `Game.tsx`: `preloadSounds` (the eight small sounds, 126 KB) from the join
   click inside `unlockAudio`, and `preloadMusic` (the two music beds, 1.9 MB) from
   arriving in a lobby and again at the countdown — the same two triggers as the
   map, because it is an asset of the round about to be played. **Do not put a
   preload back in a mount effect**, here or in `SoundStage`; the same rule, and
   the same reason, as `world/preload.ts`.

   The split is a `deferred` flag on the spec rather than two hand-kept lists, so
   a sound cannot land in both or neither, and `engine.ts` loads per name — a
   single "have we loaded yet" flag would have made whichever call came second a
   silent no-op.
10. **The listener reads `camera.position` / `camera.quaternion`, never
   `matrixWorld`.** `players/Player.tsx` drives the camera imperatively from its
   own `useFrame`, and matrices are only refreshed at render time — so a
   world-matrix read here would be a frame stale, and *which* frame would depend
   on `useFrame` ordering. The camera has no parent, so its local transform is its
   world transform.
11. **One-shots are plain Web Audio nodes, not `THREE.PositionalAudio`.** That is
    an `Object3D` you park in the scene graph, which suits a looping hum but would
    mean mounting and unmounting a node per shot. Each play here is a source, a
    gain and optionally a panner, all disconnected in `onended`.
12. **A missing sound must never break a frame.** `playSound` drops the call if the
    buffer has not decoded, the file 404'd, or the context is not running. It never
    throws and never awaits.
13. **Footsteps are derived, never networked.** Every client already has everyone's
    position at 20 Hz, so a step is a function of distance travelled — no message,
    no bandwidth, and it cannot drift out of sync with what you can see because it
    *is* what you can see.
14. **Only horizontal travel counts as walking.** Falling and jumping move you a
    long way in Y and must not tick the stride. This is also why remote figures
    cannot use the ground ray the local player has: nobody else's `grounded` is on
    the wire, so ignoring Y is the approximation that stands in for it.
15. **Both stride *and* pitch come from `BODY`.** A chameleon is smaller, so they
    take shorter, quicker, higher steps than a hunter: stride 1.9 vs 2.47 and
    pitch 1.3 vs 1.0. At the shared movement speed of 6 that is 3.1 footfalls a
    second against 2.4. Re-proportioning a role changes both automatically.
    This is a gameplay signal, not decoration — hearing a step you cannot see and
    knowing whether it is prey or the hunter is most of what audio contributes to
    hide-and-seek.
16. **Positions arrive more slowly than frames, and the stepper must not divide
    by `delta`.** This is the one that cost two rounds of silent footsteps.
    `<Physics>` steps at a fixed 1/60, so `rb.translation()` is unchanged on any
    frame that fell between steps — most of them above 60 Hz. Remote players are
    worse: their target only moves on a 20 Hz patch, so at 60 fps two frames in
    three see nothing happen. **A stationary frame is completely normal at a dead
    run.** An earlier version treated one as "stopped" (speed-per-frame below a
    threshold) and zeroed the accumulated distance, so it could never reach a
    stride and *no footstep ever played* — while every other sound worked, which
    is what made it look like a wiring fault.

    So the stepper accumulates **distance**, treats sub-`NOISE` frames as "no news
    yet", and only drops a part-stride after `IDLE_GRACE` of genuine stillness.
    Nothing in it divides by `delta`. Measured at 60/144/165 fps against 60 and
    20 Hz position sources: 3.10 steps a second in every combination. The old
    version scored 0 in all of them but the artificially aligned one — which is
    the only case the first test covered. **Any test for this must tick positions
    slower than frames**, or it proves nothing.
17. **Warping is not walking.** Further than `WARP_DISTANCE` (3 units) in one
    frame is a respawn, the under-the-floor catch, or a remote whose patch arrived
    after a stall — it resets rather than stepping, or every respawn would land a
    footfall on arrival. A *distance*, not a speed, for the reason above.
    `MIN_STEP_GAP` is the backstop beneath it.
18. **No `constructor(private x)` parameter properties in this folder.** Node's
    type stripping refuses them outright, and these modules are meant to import
    straight into Node for testing. `Stepper` writes the field out longhand.
19. **Loops are keyed by name and at most one runs per name.** `startLoop` is
    therefore idempotent — a caller can fire it every frame of a drag without
    tracking whether it already did — and `stopLoop` is the only thing that ends
    one. Both fade over `LOOP_FADE`: starting or stopping a buffer at full
    amplitude is a step in the waveform, and a brush you can hear clicking on and
    off is worse than no brush at all.
20. **`startLoop` does not bail on a suspended context, unlike `playSound`.** A
    suspended context has a frozen clock, so the sound and its fade simply begin
    when it wakes. Dropping the loop instead would mean a player who started
    brushing before the first gesture got silence until they released and pressed
    again.
21. **`once` is how a sound gets a handle without repeating.** `startLoop("…",
    { once: true })` plays through a single time but stays in the `loops` map, so
    `stopLoop` and `stopAllLoops` reach it. `playSound` cannot: nothing holds a
    reference to a one-shot, which is right for a gunshot and wrong for
    seventy-six seconds of music that would otherwise outlive a round ending
    early and carry on through the reveal and into the lobby. Its `onended`
    removes the entry, or the idempotence guard above would refuse to play it
    again next round.
22. **A hot reload can leave a second copy of this module, with its own `loops`
    map and its own `AudioContext`.** `startLoop`'s "one per name" guard is
    per-instance, so it cannot see what a previous instance started, and the two
    then overlap — which reads as a sound playing twice and is not reproducible
    from the source, because there is only ever one call site. `Game.tsx` stops
    each music bed before scheduling it and re-checks the phase when the timer
    fires,
    so a round always begins from silence whatever the last edit left running.
    **If a sound doubles in development, hard-reload before hunting for a second
    caller.**
23. **Whoever starts a loop must stop it.** Nothing else will. `Player.tsx` stops
    the brush on `onDrawingChange(false)` *and* in its effect teardown, so a loop
    cannot outlive the component that began it; `stopAllLoops` is there for any
    future caller that needs the blunt version.

## Contracts

- **Reads `net/`** for `onShot` and `onCaught`, and reads `remotes` directly each
  frame for footstep positions — including `cling`, which silences a climber.
  A remote's stepper only ever sees a position, and sliding along a wall or
  walking a ceiling is indistinguishable from walking a floor, so the flag has to
  come off the wire. Climbing *straight up* is silent for free, since the stepper
  ignores Y.
- **`onWhistle` works exactly like `onShot`**, and for the same reason: the id
  is enough, because every client already knows where that player is. Your own
  resolves to no position — `remotes` never holds you — which is right, it is at
  your own head.
- **`onShot` carries the shooter's session id, not a position.** Every client
  already knows where that player is; a coordinate on the wire would only be
  staler. `remotes` never holds *you*, so your own shot resolves to no position —
  which is right, it is at your ear, and a panner at zero distance behaves badly.
- **The server broadcasts `shot` on both the `shoot` and the `kill` path.** That
  matters: a killing shot relays no `mark`, so hanging the bang on `mark` would
  have made the most dramatic shot in the game silent.
- **`caught` carries a position** so everyone hears the catch where it happened —
  which is how the chameleons still hiding learn the hunt is closing in, and
  roughly where. It rides on the broadcast rather than on the grave because
  `graves.onAdd` also replays the whole backlog to a joining client, who would
  otherwise hear every catch in the round's history at once.
- **Reads `players/body.ts`** for `BODY`, to pitch steps by role.
- **`players/Player.tsx` owns your own footsteps**, because it is the only place
  that knows you are grounded. They are played without a position — you are the
  listener — and slightly quieter, since your own feet are the ones you least need
  to hear. `SoundStage` owns everyone else's.
- **`Game.tsx` calls `unlockAudio()` on join and `setAudioSuspended(paused)`**, so
  a shot fired the instant before Esc does not ring on behind the menu.
- **`Game.tsx` runs the whistle timer for chameleons only**, and *sends* rather than
  plays: the room relays it back positioned at you. Giving your position away
  every 45 seconds is a cost the hidden pay; a hunter who announced themselves
  would be handing the advantage to the people they are hunting. The server
  refuses one from a hunter too, the same way it refuses a catch from a
  chameleon. A caught chameleon stops whistling the instant their role flips,
  which the role check already covers. `Game.tsx` also calls `stopAllLoops()` on
  leaving, on unmount and on every room change; the brush loop would otherwise
  keep scrubbing after the component that started it is gone, and the music would
  follow you into the next room.
- **The brush loop is driven by `paint/brushCursor.ts`'s `onDrawingChange`**, via
  `players/Player.tsx`. `paint/` does not import `sound/` — it reports that a drag
  started or ended and lets the caller decide that makes a noise. One hook rather
  than three call sites, because the one that gets forgotten is `cancel`, and a
  forgotten cancel is a brush still scrubbing behind the pause menu.

## Tuning

All the knobs, in the order you are likely to want them:

- per-sound loudness — `gain` in `catalogue.ts`
- your own footsteps — the `gain` passed at the `playSound("step", …)` call in
  `players/Player.tsx`
- how far sound carries — `REF_DISTANCE` (higher = audible further) and `ROLLOFF`
  in `engine.ts`. The Web Audio default `refDistance` of 1 would make everything
  inaudible two steps away in a 40×40 arena.
- **how far sounds carry** — `REF_DISTANCE` in `engine.ts` is the radius inside
  which there is *no* attenuation, so it doubles as how big the room sounds. At 6
  it was a quarter of the arena at full volume and distance barely read; 3.5
  gives 0 dB up close, −7 at 7 units, −14 at 14 and −23 across the room.
  `ROLLOFF` sharpens the curve past that point.
- **the brush loop** — `brush` gain in `catalogue.ts`, and `LOOP_FADE` in
  `engine.ts` for how softly it starts and stops
- **footstep cadence** — `STRIDE_PER_HALF_HEIGHT` in `footsteps.ts`. Raise it and
  everyone plods, lower it and everyone scurries; the chameleon/hunter difference
  scales with it automatically. Currently 1.9, giving 3.1 and 2.4 steps a second.
- the pitch spread — `JITTER`; the walk/idle threshold — `IDLE_SPEED`

## Testing it

Both `footsteps.ts` and `engine.ts` import straight into Node — no React, no
WebGL — with a throwaway resolve hook for the `@/` alias and, for the engine, a
~30-line Web Audio stub. **Drive the stepper with positions that tick slower than
the frames**, at several refresh rates; a smooth position stream hides the only
bug this module has actually had. That covers cadence, the idle/warp guards, frame-rate
independence, pitch, and the whole unlock path including the gesture listeners.
It is the only way to check any of this without a browser, and browsers are not
part of this project's workflow — see the root CLAUDE.md.

## Not built yet

No UI sounds, no volume control or mute in the HUD — which the music makes more
conspicuous than it was. No ambience between rounds: the beds cover
hiding and the hunt, and the countdown and the reveal are silent. No
reverb, so the arena sounds like open air rather than a room. **Nobody else hears
you brushing** — the loop is local, because "is painting" is not on the wire. It
would be a fair thing to broadcast, and a good way to be found. Nothing varies
footstep sound by surface, because every surface in the arena is the same
material.

**The whistle is a periodic tell, not a round bell, and `bell` is the round bell.**
Each *chameleon* runs the whistle timer on their own clock and tells the room, so
whistles arrive at different moments for different people and each one gives away
roughly where its owner is. Hunters never whistle. The three round sounds are the
exact opposite and always will be: **`tick`, `bell` and `gong` are driven by the
server's clock and heard by everybody at the same instant, at the same volume,
wherever they are standing.** A bell that faded with distance would tell a
chameleon in a far corner less than it told the hunter, which is backwards. `tick` marks every second the game is
counting something you can act on: the ten before a round, the hiding phase, and
the **closing thirty seconds** of a hunt. Not the whole hunt — a tick that never
stops stops meaning anything — and it begins at exactly the moment the clock
turns red, because a colour and a sound saying the same thing at the same instant
are one signal where two thresholds would be two. `HUNT_URGENT_SECONDS` is that
one threshold. The reveal does not tick: it counts down to a lobby rather than to
anything that matters. **The bell plays at its own pitch.** A slowed one was tried — `rate` below 1 in
`Game.tsx`, which is the one property of a played sound that does not touch the
file — and dropped: it lengthens as well as deepens, and the tail ran into the
start of the hunt. `bell` and `gong` are played
from the **phase changing** rather than from a message: the phase is already in
state and already reaches every client in the same patch, so the transition is
the announcement.
