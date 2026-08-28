# combat — the shotgun, and what it leaves behind

**Owns:** the gun, the viewmodel, the shot resolution, the wall marks and the
graves.

## What's here

| file            | what                                                    |
| --------------- | -------------------------------------------------------- |
| `shoot.ts`      | `resolveShot`: one raycast, people and walls together    |
| `Shotgun.tsx`   | the weapon a remote hunter carries                       |
| `Viewmodel.tsx` | the one in your own hands, riding the camera             |
| `recoil.ts`     | a one-frame pulse from the trigger to the viewmodel      |
| `muzzle.ts`     | where the barrel ends, so the tracer starts at the gun   |
| `Marks.tsx`     | the shot's rainbow tracer, and the hidden patch — 3s     |
| `Graves.tsx`    | where somebody was found — permanent                     |

## The three rules that will bite you

1. **One raycast, people and walls together, and the nearer one wins.** Two
   casts let you shoot a chameleon through a wall, which is exactly the bug
   hiding is built to prevent.
2. **Graves are permanent and marks are not**, and that decides how each
   travels: a grave is schema state and arrives in a late joiner's backlog, a
   mark is a broadcast and is never stored. Getting it backwards gives you
   either invisible graves or a room full of ghost marks.
3. **A shot is broadcast separately from its mark.** `mark` is where the pellets
   landed; `shot` is where the gun was. A catch relays only `shot`, because
   there is no wall to mark — and it is still the same bang.

## The viewmodel moves, barely

Two motions, both deliberately tiny — this sits a few centimetres from the eye,
where anything that would read as subtle on a figure in the world reads as the
whole screen lurching.

- **Recoil**: about 20 cm back along the barrel and **5° of muzzle climb**, both
  peaking ~85 ms after the shot and home in 0.65s. The pitch is about the rig's
  origin at the eye, so the gun swings up ~4.5 cm and a touch further out as it
  tips — the muzzle travels further than the breech, which is the shape of a
  real kick. **The pitch cannot move the shot**: `shoot.ts` casts from the
  camera through the centre of the screen and never reads the viewmodel, so the
  barrel leaving the crosshair is seen and not fired. It is kept to a few
  degrees anyway, because past that the gun stops looking like it points where
  the crosshair says. One spring drives both — `RECOIL_PITCH` is radians of
  climb per metre of throw, so the two cannot drift out of step. It is
  critically damped and driven by an impulse, integrated in
  fixed 1/240 sub-steps — setting the offset outright and decaying it reaches
  full throw in one frame, which reads as a glitch, and integrating over the
  frame's own delta made the kick depend on the frame rate (0.19 m at 144 Hz,
  0.05 m at 30). Shorter than `FIRE_INTERVAL_MS`, so a held trigger cannot stack
  kicks. It is triggered from `players/usePointerControls.ts` through
  `recoil.ts` — a boolean read once and cleared, rather than a prop threaded
  down from `Game.tsx`, which would put a React re-render on every trigger
  pull.
- **Walk bob**: a figure-of-eight, 9 mm across and 7 mm up, the vertical at
  twice the stride — which is what a walk does and what a plain sine does not.
  **It runs off `players/gait.ts`, which advances under exactly the condition
  that plays a footstep** — grounded and not clinging — and off
  `strideFor("hunter")`, the same distance the sound counts. So the gun dips
  *on* the step, and holds still in the air. Two earlier versions were wrong in
  different ways: a flat 4.4 cycles/sec (8.8 dips against 2.4 footfalls, and
  drifting further out of phase the slower you went), then the camera's own
  movement (in phase, but bobbing through every fall and jump). The amplitude is
  eased in and out, or the gun stops mid-swing on the frame the last step lands.

Both ride an inner group so the **arms move with the gun** — they are holding
it, and transforming the gun alone stretches them.

## The mark is the tracer now

**The yellow patch is hidden, not deleted** (`SHOW_PATCH`). It is still what a
mark *is* — the wire carries a position and a rotation, and the tracer's far end
is that plane's centre — so taking it out would mean rewriting the message to
lose a decal. `visible={false}` costs nothing at draw time and one word brings
it back.

What is left is the beam, and it is drawn to be seen: a 3 cm tube where it used
to be a 4 mm hairline, carrying a rainbow spiral that turns about its own axis,
runs muzzle-to-wall, and fades out over the three seconds the mark lives.

The hue is a **function of position on the tube** in a `ShaderMaterial` —
`uv.y` along it, `uv.x` around it — so the helix costs no geometry, there is no
texture to author and none to filter, and each of the two rotations is one
addition. `TRACER_TWIST` is wraps around the circumference and `TRACER_PITCH`
is repeats **per metre**: `uv.y` is scaled by the shot's real length, or the
stripes would stretch on a long shot and bunch on a short one and no two beams
would look like the same thing.

**The beam leaves the barrel, not the eye.** The shot is still *cast* from the
camera through the centre of the screen — `shoot.ts` never reads the viewmodel,
which is what makes the recoil's muzzle climb safe — but the camera sits behind
your eyes, so a beam drawn from `shot.origin` came out of the middle of your
face while the gun in your hands did nothing. `Viewmodel` hangs an empty at the
barrel tip, inside the rig, so it picks up the recoil, the bob, the body scale
and the camera for free; it publishes that point through `muzzle.ts` every
frame, and the trigger handler sends it as the mark's origin. Module-level for
the same reason `recoil.ts` is: the gun is in the frame loop, the trigger is a
DOM event in `players/`, and a prop between them is a React re-render per shot.
It is one frame stale, which at a metre from the eye is nothing, and it is null
whenever no viewmodel is mounted — then the origin falls back to the camera.

**A material per beam**, because two of the uniforms are the beam's own — its
length and how far through its life it is. `useMemo` on the constructor args
rather than on the material itself, because `Marks` re-renders on every shot
anybody fires and R3F would otherwise rebuild the material under a beam that is
halfway through fading. They all read the scene clock, so they still spin in
step. The fade is **squared**: most of the visible life is the first second and
the rest is a ghost, where a linear fade sits at half brightness for a second
and a half and reads as a rope left hanging.

## Contracts

- **A kill is called by the shooter and checked by the server**, which refuses
  it in a lobby, outside the hunt phase, from a non-hunter, and against anyone
  who is already a hunter. The client's rate limit is for feel; the server's is
  what reaches everybody.
- **Graves are deliberately not named `ROOM_SURFACE`** — you cannot stand on one
  and you cannot shoot one.
- **Raycasts `remoteFigures`, which `players/RemotePlayers` publishes.** Known,
  acyclic.
- **The viewmodel rides the camera at frame priority 1**, it is not parented to
  it.

---

Twelve invariants, including the tracer's geometry and the known white-arms
regression: [docs/notes/combat.md](../../../docs/notes/combat.md).
