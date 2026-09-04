import type { Role } from "@/shared/protocol";

// Chameleon collider is deliberately narrower than the body — that gap is the
// hiding mechanic. Keep it square: a wider-one-way box changes how far you sit
// off a wall as you turn.
const CHAMELEON = 0.12;
// Hunter collider is sized to hold the eye off what it searches. 0.79 is the
// ceiling: the cylinder is 1.464 m (with rapier's 0.005 skin) against the
// hospital's narrowest 1.49 m doorway — 1.3 cm each side. Raising this needs
// wider doorways first.
const HUNTER = 0.79;

export const BODY_SCALE: Record<Role, number> = {
  hunter: 0.92,
  chameleon: 0.66,
};

export const BODY: Record<Role, [hx: number, hy: number, hz: number]> = {
  chameleon: [
    CHAMELEON * BODY_SCALE.chameleon,
    1 * BODY_SCALE.chameleon,
    CHAMELEON * BODY_SCALE.chameleon,
  ],
  hunter: [HUNTER * BODY_SCALE.hunter, 1.3 * BODY_SCALE.hunter, HUNTER * BODY_SCALE.hunter],
};

export const GRAVITY = 12;
