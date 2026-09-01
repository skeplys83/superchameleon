import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FLOOR_SKIN, followThirdPerson, resetFollow } from "../camera.ts";

/** A floor slab with its top face at y = 0. A box rather than a plane: the
 *  collision proxies are boxes, and a plane's back face is culled. */
function room(extras: THREE.Mesh[] = []) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40));
  floor.position.y = -0.1;
  floor.updateMatrixWorld(true);
  return [floor, ...extras];
}

/** A ceiling slab with its underside at `y`. */
function roof(y: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40));
  mesh.position.y = y + 0.1;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** A standing chameleon's origin: half of 1.0 × BODY_SCALE.chameleon. */
const BODY = new THREE.Vector3(0, 0.66, 0);
const ZOOM = 7;

/** The view direction for a pitch, looking down -Z. Positive pitch looks up. */
const looking = (pitch: number) =>
  new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));

/** Where the lens ends up for one pitch, with no easing carried in from the
 *  frame before — the geometry on its own. */
function seat(pitch: number, shell: THREE.Object3D[], zoom = ZOOM) {
  resetFollow();
  const camera = new THREE.PerspectiveCamera();
  followThirdPerson(camera, BODY, looking(pitch), zoom, shell, 1 / 60);
  return camera.position.clone();
}

const DEG = Math.PI / 180;
/** The clamp the pointer applies, less its stability guard. */
const PITCH_MAX = Math.PI / 2 - 0.02;

beforeEach(() => resetFollow());

describe("the follow camera against the floor", () => {
  it("keeps its whole zoom at a level view, rather than backing off the floor", () => {
    const at = seat(0, room());
    expect(at.distanceTo(BODY)).toBeCloseTo(ZOOM, 2);
  });

  it("never seats the lens under the floor, at any pitch or any zoom", () => {
    for (const zoom of [1.2, 2.8, 7, 14]) {
      for (let p = -PITCH_MAX; p <= PITCH_MAX; p += DEG) {
        const at = seat(p, room(), zoom);
        expect(at.y).toBeGreaterThanOrEqual(FLOOR_SKIN - 1e-6);
      }
    }
  });

  /**
   * The dead zone, as a test. The old camera took the floor out of the seat's
   * *height* at a fixed distance, and the point that came out depended only on
   * the horizontal direction — so once it was on the floor, pitching further up
   * moved it nowhere and the view froze until enough mouse travel swung it
   * clear again. Every step of pitch must move the lens.
   */
  it("moves the lens for every step of pitch, including along the floor", () => {
    const shell = room();
    let previous = seat(0, shell);
    for (let p = DEG; p <= PITCH_MAX; p += DEG) {
      const at = seat(p, shell);
      expect(at.distanceTo(previous)).toBeGreaterThan(1e-3);
      previous = at;
    }
  });

  it("closes on the body as the view tips up, instead of stopping short", () => {
    const shell = room();
    const flat = Math.hypot(...[seat(20 * DEG, shell)].map((v) => v.z), 0);
    const steep = Math.abs(seat(80 * DEG, shell).z);
    expect(steep).toBeLessThan(flat);
    // And it is still behind the player rather than through them.
    expect(seat(80 * DEG, shell).distanceTo(BODY)).toBeGreaterThan(0);
  });

  it("is close enough at full pitch for the figure to be hidden", () => {
    // The view is only worth having if the lens ends up inside the body, which
    // is what `FIGURE_HIDE_DISTANCE` in `Player.tsx` answers.
    expect(seat(PITCH_MAX, room()).distanceTo(BODY)).toBeLessThan(1.0);
  });
});

describe("the follow camera against a roof", () => {
  it("stays under the ceiling over the player when the view tips down", () => {
    const shell = room([roof(2.4)]);
    for (let p = -PITCH_MAX; p <= 0; p += DEG) {
      expect(seat(p, shell).y).toBeLessThanOrEqual(2.4);
    }
  });

  it("still rises freely with no roof overhead", () => {
    expect(seat(-60 * DEG, room()).y).toBeGreaterThan(2.4);
  });
});

/**
 * Every one of these is a camera that jammed into the body, and all three came
 * from the same shape of mistake: a clamp given an impossible job doing it
 * anyway. The caps are `(room available) / sin(pitch)`, and when the room
 * available is already negative — a ceiling nearer than its skin, a body lying
 * flatter than the floor's — a negative cap read as "as close as you are
 * allowed" rather than as "this surface cannot cap anything".
 */
describe("the follow camera in a room it barely fits in", () => {
  const CRAMPED = 0.3;

  it("does not jam into the body under a low ceiling", () => {
    const shell = room([roof(1.2)]);
    // Looking down lifts the lens toward a ceiling only 0.54 above the aim.
    const at = seat(-5 * DEG, shell);
    expect(at.distanceTo(BODY)).toBeGreaterThan(1.0);
    expect(seat(-20 * DEG, shell).distanceTo(BODY)).toBeGreaterThan(CRAMPED);
  });

  it("keeps the lens under the ceiling rather than lifting it through", () => {
    const shell = room([roof(1.2)]);
    for (let p = -PITCH_MAX; p <= 0; p += DEG) {
      expect(seat(p, shell).y).toBeLessThan(1.2);
    }
  });

  /**
   * The probe that keeps the lens off the floor starts above the lens and looks
   * down, so in a low room the first thing it meets is the *top* of the
   * ceiling. Treated as ground, that lifted the lens through the roof — and the
   * segment test then slammed it to the minimum.
   */
  it("does not mistake a ceiling's upper face for the ground", () => {
    const shell = room([roof(1.2)]);
    expect(seat(-30 * DEG, shell).y).toBeLessThan(1.2);
  });

  it("lets a body lying flat keep its zoom as the view lifts off level", () => {
    const lying = new THREE.Vector3(0, 0.08, 0);
    const shell = room();
    resetFollow();
    const camera = new THREE.PerspectiveCamera();
    followThirdPerson(camera, lying, looking(2 * DEG), ZOOM, shell, 1 / 60);
    expect(camera.position.distanceTo(lying)).toBeGreaterThan(ZOOM * 0.9);
  });

  it("closes on a lying body smoothly, without a cliff", () => {
    const lying = new THREE.Vector3(0, 0.08, 0);
    const shell = room();
    let previous = Infinity;
    for (let p = 0; p <= PITCH_MAX; p += DEG) {
      resetFollow();
      const camera = new THREE.PerspectiveCamera();
      const d = followThirdPerson(camera, lying, looking(p), ZOOM, shell, 1 / 60);
      // Monotonic, and never more than a third of the distance in one degree.
      expect(d).toBeLessThanOrEqual(previous + 1e-6);
      if (Number.isFinite(previous)) expect(d).toBeGreaterThan(previous * 0.66);
      previous = d;
    }
  });
});

/**
 * The rule, stated once: the lens aims at the body's centre and stays in the
 * room with it. Nothing below is about how the shot is framed — it is about the
 * camera never being somewhere the player is not.
 */
describe("the follow camera stays in the room", () => {
  it("aims at the body's centre, not at a point above it", () => {
    const shell = room([roof(3.4)]);
    for (const p of [-60, -20, 0, 20, 60]) {
      resetFollow();
      const camera = new THREE.PerspectiveCamera();
      followThirdPerson(camera, BODY, looking(p * DEG), ZOOM, shell, 1 / 60);
      // `lookAt` leaves the camera's -Z pointing at its target.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const toBody = BODY.clone().sub(camera.position).normalize();
      expect(forward.dot(toBody)).toBeGreaterThan(0.999);
    }
  });

  /**
   * The reported bug: a chameleon clung to the ceiling had the camera sitting
   * *on the roof*, looking down at the building from outside. The cap measured
   * from the body cannot help — the body is already within a skin of the
   * ceiling — and the segment test then clamped up to `CRAMPED_DISTANCE`, which
   * along a near-vertical leg is past the very surface it had just found.
   */
  it("never rises through the ceiling a body is clinging to", () => {
    const CEILING = 3.4;
    const clung = new THREE.Vector3(0, CEILING - 0.1, 0);
    const shell = room([roof(CEILING)]);
    for (let p = -PITCH_MAX; p <= PITCH_MAX; p += DEG) {
      resetFollow();
      const camera = new THREE.PerspectiveCamera();
      followThirdPerson(camera, clung, looking(p), ZOOM, shell, 1 / 60);
      expect(camera.position.y).toBeLessThan(CEILING);
      expect(camera.position.y).toBeGreaterThan(0);
    }
  });

  it("keeps the lens inside the room from every body height and zoom", () => {
    const CEILING = 3.4;
    const shell = room([roof(CEILING)]);
    for (const height of [0.08, 0.66, 1.8, 3.3]) {
      const body = new THREE.Vector3(0, height, 0);
      for (const zoom of [1.2, 7, 14]) {
        for (let p = -PITCH_MAX; p <= PITCH_MAX; p += 2 * DEG) {
          resetFollow();
          const camera = new THREE.PerspectiveCamera();
          followThirdPerson(camera, body, looking(p), zoom, shell, 1 / 60);
          expect(camera.position.y).toBeLessThan(CEILING);
          expect(camera.position.y).toBeGreaterThan(0);
        }
      }
    }
  });
});
