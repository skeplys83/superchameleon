# figure — the body everyone wears

**Owns:** the rig, the poses, the one model, and `PART_SHAPE` (what each limb
is, for the brush).

## What's here

| file               | what                                                     |
| ------------------ | -------------------------------------------------------- |
| `StickFigure.tsx`  | one posed, painted body                                  |
| `poses.ts`         | `POSES`: the joint-angle table, and each pose's own box  |
| `flat.ts`          | how a pose that lies flat is oriented, per surface        |
| `rig.ts`           | bone names, rest rotations, and how an angle is applied  |
| `walk.ts`          | the walk cycle, added on top of a pose rather than being one |
| `model.ts`         | fetching `player.glb`, imperatively                      |

## The three rules that will bite you

1. **Poses are joint angles, not separate models.** There is one mesh, one
   unwrap and one texture — which is what makes paint survive a pose change.
   Adding a pose means adding a row to `POSES`, never adding a file.
2. **Every pose states its own whole box, in the axes the box ends up in.** A
   lying pose's box is stated lying down. `players/Player.tsx` rebuilds the
   collider from it and puts the *underside* back where it was; a pose whose box
   is wrong is one that sinks into the floor or floats above it.

   **The table is fitted, not derived**, so it does not follow `BODY` on its
   own. `poseExtents` and `poseCentre` scale it by the body's height against
   `FITTED_HY` — pose 0's own, read off the table so the two cannot drift.
   Without that, `BODY_SCALE` shrank the figure and left its lying and curled
   colliders full size.

   **Fitted, but no longer unchecked.** `test/posedBounds.test.ts` poses the
   real `player.glb` through `poseTargets` and `applyPose` — the same two calls
   `StickFigure` makes — skins it in Node and measures where the body actually
   is. It pins the two things a box can be plainly *wrong* about: that it never
   states a shape bigger than the body, and that an upright pose's box is on the
   body rather than beside it. It deliberately does **not** pin how much smaller
   the box is; that gap is the hiding mechanic and it is a judgement.
3. **A pose is composed onto a bone's rest rotation, never written over it.**
   The rig comes out of Blender with meaningful rest rotations and the skeleton
   sits inside a node the exporter rotated to stand a Z-up model up. Overwriting
   rather than composing gives you a body folded inside out, and the failure
   looks like a bad angle rather than a bad operation.

## A pose lies flat per its own mode, and the box follows

`Pose.flat` is one of three, and it is per-pose because the poses disagree:

| key | `flat` | on the floor | on a ceiling, or holding a wall |
| --- | ------ | ------------ | --------------------------- |
| 1 Stand | `none` | upright | upright |
| 2 Reach up | `back` | back down, head forward | ceiling: back **up**, head forward · wall: upright |
| 3 Star jump | `back` | back down, head forward | the same |
| 4 Lie flat | `side` | on its shoulder, as it always was | the same — it never stands up |
| 5 Curl up | `none` | a ball reads the same either way up | upright |

**A ceiling is lain against exactly as a floor is; only a wall is held.** Both
used to be held upright, and for a real reason: a `back` pose lying on a ceiling
is long along its **forward** axis, and you face a wall to climb it — so
reaching the ceiling drove a body-length of collider straight into that wall and
jammed. What makes lying on a ceiling safe is the *later* rule below — the
turned box supplies its vertical extent and nothing else — so there is no
body-length left to swing into anything. A wall stays upright for a reason that
does not expire: a body on its back cannot grip one.

The ceiling turn is `Rx(−π/2)`, and one axis is enough there. On the floor it
takes two, because the back has to go *down* while the head goes forward; with
the back going up instead, the plain tip is already right. The two differ by a
left-right flip, which is what lying on your back rather than your front is.

`side` never stands up at all, because its long axis is left-right, so on a
ceiling it lies *across* the wall it climbed rather than into it — and
`Rz(+π/2)` puts the right shoulder up, which is the shoulder a ceiling is
against. It is the same turn on all three surfaces.

**`X` overrides all of it.** The player can hold a pose that *could* lie flat on
its feet instead, and `upright` is threaded through `flatFor`, `poseExtents` and
`poseCentre` together, so the collider stands up with the figure. It is on the
wire (`Player.upright` in the schema), because the pose it changes is what a
chameleon is hiding as — everybody has to draw the same body.

**Lying only ever makes the box shorter, never wider.** The turned box supplies
its *vertical* extent and nothing else; horizontally it stays the standing
footprint, which is the one shape already known to fit everywhere the body can
be.

That single rule closed three separate "stuck" reports with one cause. A
body-length box swung out sideways goes wherever the body happens to be facing,
and next to a wall that is *into* the wall — 0.84 units of it on letting go of
one. A kinematic collider that starts a frame penetrating gets no movement back
at all, so the player simply stops.

```
2 Reach up   held [0.12, 1.10, 0.12]  ->  on the floor [0.12, 0.12, 0.12]
4 Lie flat   held [0.23, 0.23, 0.12]  ->  the same, it never stands up
```

The body still *draws* full length and hangs well outside that box. That is the
hiding mechanic doing its job — `body.ts` makes the collider smaller than the
figure on purpose — and `players/inside.ts` is what stops the overlap ever
becoming a way *through* a wall.

**The box is stated standing up and turned to match** (`flat.ts`, `turnHalf`).
That is the whole reason flagging a pose is a one-word change: the alternative is
re-measuring every box by hand, and the first cut did exactly that — `reach` was
flagged flat, kept its 1.1-tall standing collider, and **lay down hanging in
mid-air** instead of resting on the floor.

```
2 Reach up   stated [0.12, 1.10, 0.12]  ->  on the floor [0.12, 0.12, 1.10]
4 Lie flat   stated [0.23, 0.96, 0.12]  ->  on the floor [0.96, 0.23, 0.12]
```

Half-extents are unsigned, so they are rotated and taken absolute; a **centre**
keeps its signs, because an offset toward the head has to end up an offset
*forward* once the head is pointing forward.

**`back` is not a rotation about one axis.** It wants the back down *and* the
head forward, which is π about `(0, 1, −1)`. Two single-axis attempts failed
first, and neither looked like a rotation bug:

- **About Z** — that is `side`, and it was applied to everything. On its
  shoulder the body is about 0.33 half-wide against a box stated at 0.23, so a
  tenth of a metre hung out of the collider and went through the ceiling it was
  lying against.
- **About X** — got the back down but swung the head to `+Z`. A body that lies
  down feet-first slides feet-first when you walk, which is the tell.

`test/flat.test.ts` pins where the head, the back *and* a shoulder end up for
every mode on every surface, and that a standing box lays down flat enough to
rest on the floor.

`rootX` — the crumple — is a tip in the body's *own* frame, so it composes
underneath the flat orientation rather than beside it. `StickFigure` slerps
between orientations with the same damping the joints use.

## Contracts

- **A pose's `centre` is where the body's mass ends up, measured — not the
  figure's own shift repeated.** `offsetY`/`offsetZ` move the *figure* inside
  its collider, `centre` moves the *collider*, and the trap is that they are not
  the same number: the offsets exist to bring a pose that throws itself forward
  back over its own origin, so copying them into `centre` counts the shift
  twice. `curl` has now been wrong in both directions. It sat at *half* its
  figure's shift and floated a curled chameleon 0.07 above the ground; the fix
  set `centre` to the shift exactly, which put the box 0.08 above and 0.19
  behind the ball it wraps — a third of the body under the floor and its
  collider out behind it. Measured, that centre is `[0, 0.074, 0]`, and
  `test/posedBounds.test.ts` is what says so.

  It matters because a pose change keeps the box's **underside** put
  (`players/Player.tsx`), so a box in the wrong place seats the body on a floor
  its own feet are not touching.
- **A pose that lies down sinks into the floor, and that is not a bug.** On the
  floor the boxes sit 0.07–0.15 above the body's lowest point, so a lying
  chameleon is pressed slightly *into* the ground. That is the same mechanic as
  sinking into a wall, seen from the side — it is what makes a body against a
  surface read as part of it. Only an upright pose is held to landing on it.
- **`POSE_COUNT` lives in `shared/protocol.ts`** and `poses.ts` throws on import
  if its table disagrees, so the two can never drift.
- **`safePose` guards everything off the wire.**
- **Nothing here suspends.** The model is fetched imperatively and a figure
  draws nothing until it lands — suspending would tear down the collider it
  sits inside.
- **The body is matte, and it has to stay that way.** `roughness: 1,
  metalness: 0` — the same numbers `matte` in `maps.ts` flattens a whole map to.
  A highlight is a tell no paint can answer: a specular lobe moves with the
  viewer, so a glossier body than the wall behind it reads as a silhouette from
  one side of the room however well it is matched. It was 0.55, and caught a
  sheen along every limb that the ward's plaster did not.
- **The walk cycle is a layer, never a pose.** `walk.ts` adds a sine to four
  joints on top of the standing pose; it is applied to a **copy** of the damped
  angles (`copyAngles`), because those are the damper's own state and a swing
  written back into them is one the next frame eases away from. It rides
  `POSES[0]` and `CLING_NONE` only, its amplitude damps to a hard zero when the
  odometer stops — a limb ticking at 1% on a still body is a tell no paint
  answers — and it leaves the gun arm and the torso lean alone while aiming,
  since the barrel's direction is what a chameleon reads to know where a hunter
  is pointed. `StickFigure` takes the phase as a getter: **one footfall is π**,
  and the caller converts from metres, because a stride belongs to the body's
  height (`sound/footsteps.ts`) and nothing here knows about roles.
- **`paint/` reads the real limb sizes from here**, and this folder reads the
  canvases from `paint/skin.ts`. Known, acyclic at the module level.

---

Twenty invariants, the fitting method, and the Blender export geometry:
[docs/notes/figure.md](../../../docs/notes/figure.md).
