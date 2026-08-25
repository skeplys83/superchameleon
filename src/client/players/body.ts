import type { Role } from "@/shared/protocol";

/**
 * Half-extents of the player's collider.
 *
 * **A chameleon's collider is deliberately much smaller than the body it
 * carries, and that gap *is* the hiding mechanic.** Measured off
 * `public/models/player.glb`: the torso is 0.13 half-deep and about 0.33
 * half-wide. A collider of 0.12 therefore lets the back meet a wall it is
 * pressed against instead of stopping a whole body-depth short of it, and lets
 * a shoulder sink well in when standing side-on — which is what makes lying
 * against a surface read as part of it rather than as a figure hovering near it.
 *
 * **It costs nothing in fairness.** A shot raycasts the *visual* mesh
 * (`combat/shoot.ts` against `remoteFigures`), never the collider, so sinking
 * deeper does not make anyone harder to hit — it only changes where they can
 * stand.
 *
 * The collider *does* turn with the figure's yaw — `Player.tsx` hands it one
 * every frame — but this box is square in plan, so one number serves both across
 * and front-to-back. It is set by the shallower of the two, the depth; the cost
 * is that a shoulder clips further than a back does, which flatters the
 * silhouette rather than spoiling it. **Keep it square.** A standing box that is
 * wider one way than the other changes how far you sit off a wall as you turn,
 * and a chameleon on a wall turns freely with Q/E.
 *
 * A hunter is not hiding, so theirs stays honest — and wider, because they are
 * the bigger figure.
 *
 * This is only the *standing* box. A posed chameleon gets its own from
 * `figure/poses.ts`, and `lie` and `curl` are legitimately oblong — they are
 * lying down, so there is no facing left for a turn to spoil. The 0.01 is the
 * whole rule there too: every pose's box is its own body's core less about a
 * centimetre, so a chameleon sinks slightly into whatever they are against
 * whichever way they are folded.
 */
const CHAMELEON = 0.12;
const HUNTER = 0.52;

/**
 * How big each body is against the size it was built at, so the rooms read as
 * bigger than the people in them. Below 1 shrinks the player and nothing else.
 *
 * **It is a single factor per role on purpose.** Every proportion in the game
 * hangs off `BODY` — the collider, the figure's own scale, eye height, the
 * brush ring, the footstep stride and its pitch, and every pose's box — so
 * scaling all three half-extents together moves all of them and leaves each
 * relationship exactly where it was. Most of all the one that matters: the
 * chameleon's collider is deliberately much narrower than the body it carries,
 * and *that gap is the hiding mechanic*. A uniform factor preserves the ratio;
 * shrinking the height alone would close it.
 *
 * **What it does not touch** is anything measured in the world rather than in
 * bodies: `SPEED` and `JUMP_SPEED` in `Player.tsx`, `GRAVITY` below, and the
 * camera's zoom range. A smaller player at the same speed covers the map just
 * as fast, so this changes how big the room *looks*, not how long it takes to
 * cross. Scale those too if you want the whole effect.
 */
export const BODY_SCALE: Record<Role, number> = {
  hunter: 0.92,
  /** A little smaller again — a chameleon is the one trying to be scenery, and
   *  the smaller it is against a furnished room the more of that room can hide
   *  it. Everything proportional follows: collider, figure, eye height, brush
   *  ring, stride, cling tolerance, and every pose box in `figure/poses.ts`. */
  chameleon: 0.78,
};

export const BODY: Record<Role, [hx: number, hy: number, hz: number]> = {
  chameleon: [
    CHAMELEON * BODY_SCALE.chameleon,
    1 * BODY_SCALE.chameleon,
    CHAMELEON * BODY_SCALE.chameleon,
  ],
  hunter: [HUNTER * BODY_SCALE.hunter, 1.3 * BODY_SCALE.hunter, HUNTER * BODY_SCALE.hunter],
};

/**
 * Downward acceleration, in units per second squared.
 *
 * Low on purpose: the jump is meant to float and carry rather than snap. It is
 * also the only gravity in the game — `Scene.tsx` hands it to rapier, but the
 * one rigid body in the scene is `kinematicPosition`, so nothing but
 * `Player.tsx`'s own integration ever reads it.
 */
export const GRAVITY = 12;
