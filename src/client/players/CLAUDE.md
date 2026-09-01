# players — the body you drive, and the ones you watch

**Owns:** the local player, the remote ones, the pointer lock, the camera, the
climbing, and `BODY` (the collider size for each role).

## What's here

| file                      | what                                                     |
| ------------------------- | -------------------------------------------------------- |
| `Player.tsx`              | the local body: one frame loop, and the state it moves    |
| `look.ts`                 | `Look` and `Motion` — the two mutable structs it moves    |
| `usePointerControls.ts`   | every meaning of the mouse, and the strokes it produces   |
| `useStateBroadcast.ts`    | your transform, on a timer                                |
| `useEyedropperReadback.ts`| the framebuffer reads — the click's fallback and the swatch's, at priority 3 |
| `RemotePlayers.tsx`       | everybody else, damped toward their last packet           |
| `poseRequest.ts`          | the one channel from the HUD's pose wheel to the body      |
| `controls.ts` `controller.ts` `camera.ts` `cling.ts` `body.ts` `pointerLock.ts` | the pieces each of those uses |

## The two roles do not share a control scheme

A **hunter** is first person. A **chameleon** is third person, turns their body
with Q/E, poses with the number keys or the `R` wheel, and climbs. That
asymmetry is the reason for most of the rules below.

**Both of them hold the pointer lock.** The chameleon did not used to — the
cursor stayed free so the brush and the palette were always to hand — but a
walking body now turns to face the camera, which makes the camera the steering,
and a cursor drifting into the corner of the screen is a wall you cannot look
past. **Paint mode (`F`) is what hands the cursor back**, along with the pause
menu and the chat box, and it is the only way to paint. `usePauseControl` owns
that whole exchange.

## The three rules that will bite you

1. **One effect owns the pointer lock, driven by state rather than by buttons.**
   Every button that hands control back would otherwise have to re-take it, and
   a `requestLock` landing after a menu opened snatches the cursor off it. The
   lock is also read from the *document* on mount, never assumed false — this
   component is rebuilt on every room change and the lock survives that.
2. **Nothing but the frame loop moves the body, and it must not move it through
   a world that has not arrived.** The player is kinematic; a map still loading
   has no colliders, so the loop returns early while `solids` is empty and holds
   the body still rather than dropping it through where the floor will be.
3. **What stays put across a pose change is the box's *underside*, not its
   half-height.** Each pose states its own whole box in world axes; a pose that
   is offset *and* resized changes the foot by neither on its own, so the body
   is moved by the difference or a chameleon lying down sinks or hops.

## Ownership, since the split

`Look` (yaw, pitch, zoom, locked, orbiting, focused) is **created and written by
`usePointerControls`** and read by the frame loop. `Motion` (bodyYaw, vy,
grounded, jumpHeld, cling, reclingGrace, footOffset) is **created and written by
`Player.tsx`**. Nothing writes across that line, and `react-hooks/immutability`
enforces it: a ref handed *into* a hook and mutated there is an error, as is
mutating one a hook returned.

## The jump is forgiving, and none of the forgiveness adds height

Four numbers, all of them slack rather than power:

- **Coyote time** (0.15s) — ground credit that keeps running after you walk off
  an edge, so a press one frame late still fires.
- **Jump buffer** (0.16s) — a press made just before landing is spent on the
  landing rather than eaten. Not queued while clinging, where the same key means
  "let go" and buffering it fired a jump the instant the chameleon touched down.
- **Cut gravity** (×2.2) — release early and the rise ends early. This is the
  short hop, and it is the only thing the key's *duration* controls.
- **Fall gravity** (×1.25) — falling faster than you rose is what reads as
  weight. A symmetric arc hangs.

**Cut gravity never reduces the apex** — it only ever applies after the key is
released, so what a full-held jump can reach is decided by `JUMP_SPEED` and
`GRAVITY` alone. At 10 against 12 that is **4.08 units**, with 1.57s of airtime;
a tap reaches 1.99.

**The apex is a map constraint, not a feel knob.** Ledges are built against it
(`docs/notes/world.md`, invariant 7), so raising it puts places within reach
that a map may not have meant to offer. And it is *not* affected by
`BODY_SCALE`: a shrunken player still jumps 4.08 world units, which is now 2.4
of their own heights rather than 2.1. Scale `JUMP_SPEED` too if you want the
jump to shrink with the body.

**A head on a ceiling ends the jump.** Asking to rise and being allowed less
than 40% of it is a bump, and `vy` is cut to zero. Without it the velocity
survives the collision and the player grinds along the underside of the roof
until gravity finally eats it, which you feel through the camera as pressing
upward into nothing.

## `BODY_SCALE` is the one number that resizes a player

Everything proportional hangs off `BODY` in `body.ts`, so one factor per role
moves all of it at once: the collider, the figure's own scale, eye height, the
brush ring, the footstep stride and its pitch, the cling tolerance, and every
pose's box. Most of all it keeps the ratio the hiding mechanic depends on — a
chameleon's collider is deliberately far narrower than the body it carries, and
scaling all three half-extents together leaves that gap exactly where it was.

Four things do **not** follow from `BODY`, and three of them are deliberate:

- **Pose boxes** are a fitted table in `figure/poses.ts`, not derived from
  `BODY`, so they are scaled explicitly against the height they were fitted at.
  Miss this and the figure shrinks while its lying and curled colliders stay
  the size they were.
- **The viewmodel** hangs off the camera, not the body, so `combat/Viewmodel.tsx`
  scales itself by `BODY_SCALE.hunter`.
- **`SPEED` is per role; `JUMP_SPEED`, `GRAVITY` and the camera's zoom range are
  not.** Those three are measured in the world rather than in bodies, and are
  left alone on purpose — a smaller player jumping the same height clears the
  same crate. `SPEED` was the same way until a chameleon at two thirds a
  hunter's height turned out to be covering nearly twice the body-lengths a
  second: a small figure at a big figure's pace, which reads as skating and puts
  the whole map inside a glance. It is 4.2 against the hunter's 6 — short of the
  height ratio (~3.3), because a chameleon caught in the open still has to be
  able to run for cover. Nothing else needs changing with it: the walk cycle's
  phase and the footstep stepper both count *distance travelled*, so the legs
  and the sound slow themselves.
- **The name badge's gap** above a remote head is scaled in `RemotePlayers.tsx`,
  because it is a distance from a body rather than a distance in the room.

## The follow camera solves for its distance, and never for its height

**Every clamp comes out of the leg, along the line the pitch describes.** The
lens sits at `aim + toCamera × distance`, and floor, roof and wall all answer
the same question: how long may that leg be? Nothing writes a height into the
seat, and nothing slides it around a sphere at a fixed distance.

That is not a tidiness rule, it is the fix for three bugs that were all one bug.
Sliding along the sphere produces a point that depends only on the *horizontal*
direction, so once the camera was on the floor, pitching further moved it
nowhere — the view froze until enough mouse travel swung the free seat back
above the ground. And because floor hits were skipped on the orbit ray while
the under-lens probe could only find ground the lens was not yet inside, a look
up from a full zoom put the seat metres below the map, where the final segment
test slammed it to `CAMERA_MIN_DISTANCE` — the lurch, and then the stick, and
the lens ending up **under the floor** at pitch 0.5. Solving for the distance
instead makes the seat a continuous function of pitch: every fraction of a
degree moves it, and it cannot be under a floor it is measured against.
`test/camera.test.ts` holds all of that.

**A cap that cannot be met caps nothing.** Each one is `(room available) /
sin(pitch)`, and the room available goes negative in ordinary play: a ceiling
closer to the aim than its skin, or a chameleon lying flat, whose origin is
nearer the floor than `FLOOR_SKIN` is deep. A negative cap fell through the
clamp as "as close as you are allowed", so the lens jammed into the body — at 2°
of up-look while lying down, which is most of the game. They return `Infinity`
instead, and `AIM_STANDING` keeps the aim above the floor's skin the moment the
view starts to rise, so the cap decays as `1/sin` from no cap at all rather than
appearing out of nowhere already tiny. **And only what is below the aim is
ground**: the under-lens probe looks down from above the lens, so in a low room
it finds the *top* of the ceiling first, and treating that as floor lifted the
lens through the roof for the segment test to slam back to the minimum.
`test/camera.test.ts` holds all three.

**The ground is still never backed away from at a level view.** A floor hit on
the orbit ray is ignored exactly as it always was — a lying player's aim sits a
hand's breadth above the ground, and pulling in on that collapses the shot the
moment they lie down. What replaced the skim is a closed-form cap that only
engages as the view tips up, in proportion to how far up it is looking, so a
level camera keeps its whole zoom and glides.

## The lens aims at the body's centre and stays in the room with it

Two rules, and everything else in `camera.ts` serves them. **It aims at
`bodyPos`** — nothing lifts or offsets the target, so the body is centred in
every shot. **And it is never outside the room the player is in**, which is a
containment guarantee rather than a preference: `test/camera.test.ts` sweeps
every body height, zoom and pitch and asserts the lens is between the floor and
the ceiling for all of them.

**Containment beats the comfortable minimum.** `CAMERA_MIN_DISTANCE` and
`CRAMPED_DISTANCE` say how close the lens may come; neither may push it through
something. The segment test used to clamp *up* to `CRAMPED_DISTANCE`, and along
a near-vertical leg a third of a metre is past a ceiling detected at a tenth —
which is how a chameleon clinging to a ceiling ended up filming the building
from the roof. Where the skin does not fit, half the distance to the surface
does. A seat inside the body is always better than a seat outside the room.

**Both corrections are made after the seat, not only before it.** A cap measured
from the body cannot help when the body is *already* within a skin of the
surface — clung to a ceiling, or lying on a floor — so the ground under the lens
and the ceiling over it are each probed again once it has been placed, and each
probe is anchored to the aim rather than to the lens. A lens that has sunk
metres below the floor cannot find that floor from a ray starting above
*itself*; the aim is always in the room, so a ray from there always finds the
room's own surfaces.

## Looking up costs zoom, and a body on the floor cannot look up at all

To look up at 10° from seven metres back, the lens has to sit 1.2 m below the
aim, and a standing chameleon's origin is only 0.66 above the floor. So the
up-look buys its angle out of the distance: 7 m level, 2.1 at 10°, 0.7 at 30°,
0.36 at the limit, with the lens riding at `FLOOR_SKIN` above the floor. At the
end of that it is inside the figure, so `Player.tsx` hides it below
`FIGURE_HIDE_DISTANCE`.

**A body lying flat is the case with no answer.** Its origin sits *below*
`FLOOR_SKIN`, so no distance along a rising line clears the floor — not even
zero. The lens is pinned to the floor's skin instead and the view stays level
however far the pitch is pushed. That is the price of aiming at the centre; the
alternative is lifting the aim off the body, which frames the shot somewhere the
player is not.

## It tests where the lens *ends up*, not where it was aimed

The last pass is a segment test from the aim to the seat, and it is not any of
the caps restated: they decide how long the leg is, and none of them knows what
the leg passes *through*. A seat at the right distance and the right height can
still be on the far side of a wall it crossed on the way. It can only ever
shorten the leg further.

It raycasts `shell` only — floor, walls, ceiling — never the furniture. See
`world/CLAUDE.md`.

## And it never rises above the roof over the player

Measured straight up from the body rather than along the orbit, because the
segment test can only refuse a seat the **straight line from the body** reaches
through something — and the hospital is roofed in patches, so a camera swinging
up and back leaves a room through an open side and comes down on the roof next
door with clear line of sight the whole way. Nothing was clipped; the shot was
of a rooftop. No roof overhead, no cap.

## Contracts

- **A walking chameleon turns to face the camera** (`FACE_DAMP`), and only
  while walking. Movement has always followed the camera rather than the figure,
  so a body left pointing wherever Q and E last put it walks sideways and
  backwards for most of a round; standing still is when the figure is being
  *placed*, and Q and E are what place it. The turn takes the short way round —
  yaw is unbounded, because Q and E have been adding to it — and is damped, or
  it reads as the camera cutting rather than the body leaning into a corner.
- **A pose is not always something you can leave.** Lying under a bed or curled
  into a cupboard, the box is a fraction of the standing one, and unfolding
  would put the rest of the body through whatever is overhead. `headroom` in
  `inside.ts` measures the clear height above the *feet* — the pose change keeps
  the box's underside put, so the feet are what it grows from — and nothing is
  allowed into a pose whose box does not fit: not the number keys, not the
  wheel, and **not walking**, because `activePose` unfolds a chameleon to
  POSES[0] to walk. Somewhere with no room to stand is somewhere with no room to
  walk, and refusing it there is also what stops the walk cycle playing while a
  body clips up through a mattress.

  It is one ray straight up, so a beam that clears the centre and would clip a
  shoulder is not seen. The honest alternative is a shape cast per pose per
  frame; the cheap version is what reads as "there is a bed over me". It is
  skipped entirely while clinging, where the box has turned to hold a wall and
  "up" is not the direction the body would grow in.
- **`X` decides whether a pose that can lie flat actually does**, and it is on
  the wire. It is React state here for the same reason `surfaceKind` is — it
  turns the pose's box and the collider is keyed on that box — it flips on the
  key's *press* (`m.flatHeld`, the edge `jumpHeld` catches for the jump), and it
  reaches `figure/` as one flag threaded through `flatFor`, `poseExtents` and
  `poseCentre` together. Cosmetic but not local: what a chameleon is hiding *as*
  cannot differ between the client drawing it and the clients hunting it.
- **The pose has two ways in and one owner.** The number keys are polled from
  the frame loop through drei's map; the wheel is drawn in `hud/`, which may not
  import this folder, so it goes through `poseRequest.ts` — a request is
  **taken**, not read, or one turn of the wheel would fight the number keys for
  the rest of the round. `pose` itself stays React state here, because the
  collider is keyed on its box.
- **The eyedropper's cursor swatch is `usePointerControls`' too**, created and
  destroyed by the arming effect and moved from `onMouseMove`. **Its colour is
  the drawn pixel, not the albedo the click takes** — it answers "what am I
  looking at", and raw albedo held up beside the surface it came from does not
  match it, because a grey stone under torchlight is brown on screen. The brush
  still takes albedo, which is what makes the painted body come out that same
  brown under that same light. `useEyedropperReadback` answers a **standing**
  watch every drawn frame, since the world moves under a still cursor.
- **Paint mode slows the body to 30%** (`PAINT_SLOWDOWN`), walking and turning
  together off one factor so they stay in proportion — a body that crept but
  spun would be worse to paint on than either. Painting is aiming, and at full
  speed the smallest tap of a movement key throws the surface you were working
  on out from under the brush. It is a slowdown and not a lock: a chameleon in
  paint mode is standing in the open with their cursor free, and taking their
  feet away outright is the worse trade. Note that the walk keys also *leave*
  paint mode (`app/Game.tsx`), so in practice this is what Q and E feel like.
- **Paint mode borrows the camera's zoom, and eases into it.** Entering pulls
  the lens in to `PAINT_ZOOM` — the default 7 frames a body against the room,
  which is the shot for hiding in it and the wrong one for painting a shoulder —
  and leaving hands back whatever the player was looking at the room from, so
  the mode cannot quietly redefine their camera for the rest of the round. **It
  only ever pulls in**: somebody already closer than this chose that.

  **`zoom` and `zoomTarget` are two fields because the two writers want
  different things.** The wheel sets both and lands on the frame it is turned: a
  scroll is the player's own hand, and a lag between turning it and the camera
  moving reads as the control being broken. Paint mode sets only the target, and
  a rAF closes the gap over `ZOOM_TAU` — exponential, so it takes the same time
  on a 144 Hz monitor as on a 60 Hz one. It used to assign `zoom` outright and
  the camera arrived before the panel did, which read as the view glitching
  rather than as stepping up to your own body.

  **The ease lives in `usePointerControls`, not in the frame loop**, because
  `Look` is written there and nowhere else — `react-hooks/immutability` fails the
  build on a frame-loop write, which is the ownership line above being enforced
  rather than described.
- **A colour is recorded as *used* when a drag begins**, from the same branch
  that starts the stroke: `rememberColor` in `paint/palette.ts` feeds the
  panel's recent row.
- **The "F to pick a colour" label rides with the brush ring**, on the same
  condition and in the same handler. It is held in a ref rather than closed
  over, because every effect that cancels the ring — pausing, minimising the
  palette, arming the pick — has to put the label away too: a mouse that has
  stopped moving will not clear it.
- **`Game.tsx` owns pause, paint and the role**; this folder receives them as
  props. `frozen` is not `paused` — a rooted survivor keeps their mouse.
- **Publishes `remoteFigures`** for `combat/shoot.ts` to raycast.
- **Sends** `state` (on a timer, never from `useFrame` — a backgrounded tab runs
  no frames and would look like the player vanishing), `paint`, `shoot`, `kill`.
- **A pose change moves the body; a surface change never does.** The box shifts
  the body so its underside stays put across a pose change, or a chameleon lying
  down sinks into the floor. But the box *also* turns when a flat pose stands up
  to grab a wall, and that must move nothing — the cling logic is placing the
  body against the wall itself.

  The test is `surfaceKind !== m.surface`, and getting it wrong is expensive in
  a way that does not show up where the mistake is. Suppressing only the shift,
  and still recording the new offset, made **grabbing** a wall look fine and
  **letting go** drop the body 0.73 units — straight through the floor, one
  interaction later.
- **A surface change re-seats the body**, though (`seatOn` in `cling.ts`). The
  box it was placed for has just been replaced, and nothing else will move it: a
  chameleon wrapping from a wall onto a ceiling was left a body-length below the
  ceiling it was touching, out of reach of its own cling probe — which sees
  about 0.42 — and fell off. It is the same idea as keeping the feet put, along
  whatever the body is holding rather than down.
- **The body's centre may never cross a surface** (`inside.ts`). The character
  controller resolves *movement*, from where the body already is — so it never
  sees the three things that actually put a chameleon through a wall: the foot
  compensation and `seatOn` both shift the body outright, and the collider is
  **rebuilt at a different size** when a pose changes its box, which can bring
  it into existence already overlapping. A sweep from last frame's position to
  this one catches all three.

  It is a backstop, not the collision system. **It does not stop the body
  overlapping** — the collider is deliberately narrower than the figure and that
  gap is the hiding mechanic. What it guarantees is that the centre stays on the
  room's side of every wall, so a chameleon can sink into scenery and never end
  up behind it.
- **And the box around that centre is pushed out of the shell** (`pushInside`,
  same file), which is the other half: a centre in the room says nothing about a
  collider that has just been *rebuilt bigger* around it. It runs second and
  never instead, because it measures outward from the centre and a ray starting
  inside geometry leaves through a back face and reports nothing.

  Three things it is careful about, each of them a way to break something that
  works. It corrects along the **box's own axes**, which turn with the body's
  yaw. It only pushes on a real overlap, past a tolerance — a box resting
  exactly on the floor is measured at exactly its half-extent every frame, and a
  skin on top of that floats the player. And it **never pushes along the surface
  a body is clinging to**: `seatOn` owns that distance, and shoving a climber
  off their wall drops them out of reach of their own cling probe. The other two
  axes still apply, so a climber who meets the ceiling is still let out of it.

  **Shell only** — floor, walls and ceiling. Sinking into the furniture is the
  hiding mechanic working.
- **`clingKind` turns a cling normal into the wire value.** The normal points
  back at the player, so a ceiling's points down. It decides which way up
  `figure/` draws a pose that lies flat, and which way round its box sits — so
  it is React state here, not a frame-loop local, because the collider is keyed
  on that box.
- **A hunter is a cylinder; a chameleon is a box.** `Player.tsx` picks the
  collider by role. A box turns with the body, so how close it lets you stand to
  a wall depends on which way you face — a corner reaches out by root two — and
  a hunter's collider is now sized to *hold them off* what they are searching,
  where an eye at ten centimetres beats any camouflage. The standoff has to be
  equal in every direction. It also removes the diagonal: at `HUNTER` 0.79 the
  body is 1.45 across — 1.46 once rapier's skin is counted — against the
  hospital's narrowest 1.49 m doorway, and the box it replaced was 1.82 corner
  to corner, wider than the door it was walking through. **That is 1.3 cm each
  side, and it is the ceiling: raising `HUNTER` or `BODY_SCALE.hunter` again
  means widening the doorways first**; past the opening a kinematic body does
  not squeeze, it stops. A chameleon keeps the cuboid because
  `figure/poses.ts` states every pose as a box.
- **No input, no travel.** `setSlideEnabled` projects a blocked move along what
  it hit, and both holds this game applies every frame are pushes *into* a
  surface — `GROUND_STICK` down, `STICK_SPEED` into the wall being climbed. On
  anything but a perfectly square face a fraction survives the projection as
  sideways motion, and a body asking to stand still creeps across what it is
  standing on. So the frame's allowed movement is clamped after the controller
  answers: clinging with nothing held keeps only the component along the cling
  normal, walking with nothing held keeps only gravity, and a release keeps
  everything, because that push *is* the movement. The walk bob reads the
  clamped numbers too, or the gun bobs while you stand still.
- **A chameleon walks upright, and walking spends the pose.** `pose` is what
  they *chose*; `activePose` is what the body holds, and it is `POSES[0]` while
  they are moving on the ground unclung — **and the frame the walk begins
  writes that back into `pose`**, so stopping leaves them standing. It used to
  snap back the instant the keys were released, which meant a chameleon could
  not walk away from a hiding place without dropping into it again at the far
  end, and every attempt to adjust a spot finished in the pose being left. Everything —
  the box, the collider key, the feet-stay-put shift, `net.pose`, the figure —
  reads `activePose`, so this is the same change a number key makes, through
  the same code. Walking is *asking* to walk rather than travelling, or a body
  pressed into a wall would flop back down and rebuild its collider on every
  doorframe; coyote time stands in for `grounded` so a step off a kerb does not
  either.

  **Getting up is delayed and sitting back down is not** (`RISE_DELAY`, 0.5s).
  The ask is timed rather than obeyed, because on the first frame every pose was
  one twitch of W away from being abandoned — a chameleon shuffling into place
  against a wall popped upright and marched off. A body already holding
  `POSES[0]` skips it entirely, which is every hunter, so nobody who is on their
  feet pays for it. The timer is zeroed by the *ask* stopping rather than by
  walking, so letting go for a frame costs the whole half second again, and
  `fits(0)` is re-tested on every frame of the rise — walking under a bed
  mid-rise never completes it.
- **The walk phase is measured in strides off `gait.ts`**, the same odometer the
  footstep sound is timed on, so the legs land with the steps you can hear.
  Remote bodies have no odometer on the wire, so `RemotePlayers.tsx` keeps one
  each off the positions it is already interpolating — horizontal only, and
  paused while clinging or dropping faster than `AIRBORNE_DROP`, because nobody
  else's `grounded` is on the wire either.
- **A hunter broadcasts camera yaw, not body yaw**, so chameleons can read where
  the gun hunting them is pointed.
---

Thirty-five invariants, the camera tuning, the autostep number and the climbing
geometry: [docs/notes/players.md](../../../docs/notes/players.md).
