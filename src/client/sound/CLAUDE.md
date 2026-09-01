# sound — everything that makes a noise

**Owns:** the audio engine, the catalogue, the loops, and footsteps.

## What's here

| file             | what                                                      |
| ---------------- | ----------------------------------------------------------- |
| `engine.ts`      | the context, one-shots, loops, unlocking, suspending, preload |
| `catalogue.ts`   | the ten files, and the gain and rate each is played at        |
| `footsteps.ts`   | `Stepper`: distance travelled → a step, per player           |
| `SoundStage.tsx` | the listener, and a stepper for each remote figure            |

## The three rules that will bite you

1. **Positional sounds must be mono.** A stereo buffer cannot be spatialised —
   it plays at full volume in both ears from anywhere on the map, which reads as
   the panning being broken rather than as the file being wrong.
2. **The context unlocks on a user gesture, and nothing is fetched on page
   load.** `app/Game.tsx` calls `unlockAudio()` from the join *click*; anywhere
   else — an effect, a timer — is silently refused and the whole game stays
   mute. The music is fetched on arriving in a lobby, not on opening the page.
3. **Whoever starts a loop must stop it.** Nothing else will. Loops are keyed by
   name, at most one runs per name, and `app/Game.tsx` stops them all on
   `onLeftRoom`, on a drop and on unmount. The two music beds are the ones with
   a phase attached: `useRoundAudio` starts `hideMusic` on hiding and
   `huntMusic` on the hunt, and stops each on *any* phase that is not its own,
   so neither plays under the gong and the two never sound together.

   **Both loop forever, and neither knows how long its phase is.** `hideMusic`
   is 34.96s against a 35s hiding phase, `huntMusic` 89.14s against a hunt of
   several minutes — but the length of a phase is not a fact either file
   encodes, so changing `HIDE_SECONDS` or a map's `roundSeconds` needs nothing
   here. **That is only true because both seams are closed** — see invariant 6
   in the archive, and 4a for why their gains are equal.

## Contracts

- **Footsteps are derived, never networked.** Every client already has everyone's
  position; a step is distance travelled, horizontally only. `cling` comes over
  the wire precisely so a climber's steps stay silent for everyone else.
- **Both stride and pitch come from `BODY`** in `players/body.ts` — a chameleon
  is smaller, so they take shorter, higher steps.
- **The listener reads `camera.position`/`quaternion`** at frame priority 1,
  after the camera has been placed.
- **A missing sound drops the call rather than breaking the frame.**
- **`WHISTLE_INTERVAL_MS` is in `shared/protocol.ts`** — the server rate-limits
  against the same number.

---

Twenty-three invariants, the encoding and normalisation rules, and the tuning:
[docs/notes/sound.md](../../../docs/notes/sound.md).
