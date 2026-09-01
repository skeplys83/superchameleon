import * as THREE from "three";
import { BODY } from "@/client/players/body";
import type { Role } from "@/shared/protocol";

/** Stride length per unit of body half-height. */
const STRIDE_PER_HALF_HEIGHT = 1.9;

/** Movement below this in a single frame is numerical noise, not walking. */
const NOISE = 0.002;
/**
 * How long a body must actually be still before it counts as stopped. Anything
 * shorter is just a frame that landed between ticks.
 */
const IDLE_GRACE = 0.25;
const WARP_DISTANCE = 3;
/** ±3% so a run does not sound like one sample on a loop. */
const JITTER = 0.03;
/** Hard floor on the gap between two footfalls, in seconds. */
const MIN_STEP_GAP = 0.11;

/** How far this role travels between footfalls. */
export function strideFor(role: Role) {
  return STRIDE_PER_HALF_HEIGHT * BODY[role][1];
}

export function stepRate(role: Role) {
  return BODY.hunter[1] / BODY[role][1];
}

/** `stepRate` with a little per-step variation. */
export function jitteredStepRate(role: Role) {
  return stepRate(role) * (1 - JITTER + Math.random() * JITTER * 2);
}

/** Turns a stream of positions into footfalls. */
export class Stepper {
  private readonly last = new THREE.Vector3();
  private travelled = 0;
  private since = MIN_STEP_GAP;
  private idle = 0;
  private primed = false;

  /** How far this body travels between footfalls, from `strideFor`. */
  private readonly stride: number;

  constructor(stride: number) {
    this.stride = stride;
  }

  /** Feed the current position; returns true on the frames a step lands. */
  update(x: number, y: number, z: number, delta: number) {
    this.since += delta;

    if (!this.primed) {
      this.last.set(x, y, z);
      this.primed = true;
      return false;
    }

    const dx = x - this.last.x;
    const dz = z - this.last.z;
    this.last.set(x, y, z);

    const moved = Math.hypot(dx, dz);

    // Crossing the lobby in one frame is not a stride. Without this a respawn
    // lands a footfall on arrival.
    if (moved > WARP_DISTANCE) {
      this.travelled = 0;
      this.idle = 0;
      return false;
    }

    if (moved < NOISE) {
      // Almost certainly a frame that landed between a physics step or a network
      // patch. Only a sustained pause means the body has actually stopped.
      this.idle += delta;
      if (this.idle > IDLE_GRACE) this.travelled = 0;
      return false;
    }
    this.idle = 0;

    this.travelled += moved;
    if (this.travelled < this.stride) return false;
    // Hold the step rather than dropping it if the floor has not passed yet.
    if (this.since < MIN_STEP_GAP) return false;

    // Carry the remainder rather than zeroing it, so cadence stays even instead
    // of drifting with however the positions happened to arrive.
    this.travelled -= this.stride;
    this.since = 0;
    return true;
  }

  reset() {
    this.travelled = 0;
    this.since = MIN_STEP_GAP;
    this.idle = 0;
    this.primed = false;
  }
}
