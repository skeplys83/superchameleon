import * as THREE from "three";
import { BODY } from "@/client/players/body";
import type { Role } from "@/shared/protocol";

const STRIDE_PER_HALF_HEIGHT = 1.9;

const NOISE = 0.002;
const IDLE_GRACE = 0.25;
const WARP_DISTANCE = 3;
// ±3% per step so a run does not sound like one sample on a loop.
const JITTER = 0.03;
const MIN_STEP_GAP = 0.11;

export function strideFor(role: Role) {
  return STRIDE_PER_HALF_HEIGHT * BODY[role][1];
}

export function stepRate(role: Role) {
  return BODY.hunter[1] / BODY[role][1];
}

export function jitteredStepRate(role: Role) {
  return stepRate(role) * (1 - JITTER + Math.random() * JITTER * 2);
}

// Positions → footfalls.
export class Stepper {
  private readonly last = new THREE.Vector3();
  private travelled = 0;
  private since = MIN_STEP_GAP;
  private idle = 0;
  private primed = false;

  private readonly stride: number;

  constructor(stride: number) {
    this.stride = stride;
  }

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

    // A respawn is not a stride.
    if (moved > WARP_DISTANCE) {
      this.travelled = 0;
      this.idle = 0;
      return false;
    }

    if (moved < NOISE) {
      // A frame between a physics step or network patch — a real stop is sustained.
      this.idle += delta;
      if (this.idle > IDLE_GRACE) this.travelled = 0;
      return false;
    }
    this.idle = 0;

    this.travelled += moved;
    if (this.travelled < this.stride) return false;
    if (this.since < MIN_STEP_GAP) return false;

    // Carry the remainder so cadence stays even.
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
