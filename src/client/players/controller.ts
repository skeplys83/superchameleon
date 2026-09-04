import type { World } from "@dimforge/rapier3d-compat";

// Rapier's skin — never zero, which it does not allow.
const OFFSET = 0.005;

const MAX_CLIMB = (50 * Math.PI) / 180;
const MIN_SLIDE = (30 * Math.PI) / 180;

// The dungeon's treads are 0.50; landings need 0.30 to accept a step.
const STEP_HEIGHT = 0.6;
const STEP_WIDTH = 0.3;

const byWorld = new WeakMap<World, ReturnType<World["createCharacterController"]>>();

export function characterController(world: World) {
  const existing = byWorld.get(world);
  // Trap 5.
  if (existing && world.characterControllers?.has(existing)) return existing;

  const controller = world.createCharacterController(OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle(MAX_CLIMB);
  controller.setMinSlopeSlideAngle(MIN_SLIDE);
  controller.enableAutostep(STEP_HEIGHT, STEP_WIDTH, false);
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);
  byWorld.set(world, controller);
  return controller;
}
