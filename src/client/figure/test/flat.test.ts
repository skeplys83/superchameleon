import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CLING_CEILING, CLING_NONE, CLING_WALL } from "@/shared/protocol";
import { flatFor, turnCentre, turnHalf } from "../flat.ts";

/** Where a body-local direction ends up, rounded so −0 reads as 0. */
const after = (q: THREE.Quaternion, v: [number, number, number]) =>
  new THREE.Vector3(...v)
    .applyQuaternion(q)
    .toArray()
    .map((n) => (Math.abs(n) < 1e-6 ? 0 : +n.toFixed(3)));

/** The figure faces −Z with its head at +Y. */
const HEAD: [number, number, number] = [0, 1, 0];
const BACK: [number, number, number] = [0, 0, 1];
const RIGHT: [number, number, number] = [1, 0, 0];

const FORWARD = [0, 0, -1];
const DOWN = [0, -1, 0];
const UP = [0, 1, 0];

describe("lying on the floor, on its back", () => {
  it("puts the back down and the head forward", () => {
    // Both at once. Tipping about X alone gets the back down and swings the
    // head to +Z — a body that lies down feet-first slides feet-first when you
    // walk, which is how that was caught.
    expect(after(flatFor("back", CLING_NONE), BACK)).toEqual(DOWN);
    expect(after(flatFor("back", CLING_NONE), HEAD)).toEqual(FORWARD);
  });

  it("never lays the body on a shoulder", () => {
    const [, y] = after(flatFor("back", CLING_NONE), RIGHT);
    expect(Math.abs(y)).toBeLessThan(1e-6);
  });
});

describe("lying on its side", () => {
  it("puts a shoulder down and keeps the back facing sideways", () => {
    const [, y] = after(flatFor("side", CLING_NONE), RIGHT);
    expect(Math.abs(y)).toBeCloseTo(1);
    expect(after(flatFor("side", CLING_NONE), BACK)).toEqual([0, 0, 1]);
  });

  it("never stands up, on any surface", () => {
    for (const surface of [CLING_WALL, CLING_CEILING]) {
      expect(after(flatFor("side", surface), HEAD), `surface ${surface}`).toEqual(
        after(flatFor("side", CLING_NONE), HEAD),
      );
    }
  });
});

describe("lying on a ceiling", () => {
  it("puts the back up and the head forward", () => {
    // The mirror of the floor: the surface is above, so the back goes toward
    // it. The head still leads, for the same reason it does on the floor.
    expect(after(flatFor("back", CLING_CEILING), BACK)).toEqual(UP);
    expect(after(flatFor("back", CLING_CEILING), HEAD)).toEqual(FORWARD);
  });

  it("is not the wall's turn, which is upright", () => {
    expect(after(flatFor("back", CLING_CEILING), HEAD)).not.toEqual(
      after(flatFor("back", CLING_WALL), HEAD),
    );
  });

  it("differs from the floor by a left-right flip and nothing else", () => {
    // Which is what lying on your back rather than your front is. Both put the
    // head forward; only the side the body's own right ends up on changes.
    expect(after(flatFor("back", CLING_NONE), HEAD)).toEqual(
      after(flatFor("back", CLING_CEILING), HEAD),
    );
    expect(after(flatFor("back", CLING_NONE), RIGHT)).toEqual([-1, 0, 0]);
    expect(after(flatFor("back", CLING_CEILING), RIGHT)).toEqual([1, 0, 0]);
  });
});

describe("the X toggle", () => {
  it("stands every mode upright on every surface", () => {
    for (const mode of ["back", "side"] as const) {
      for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
        expect(after(flatFor(mode, surface, true), HEAD), `${mode} ${surface}`).toEqual(UP);
        expect(after(flatFor(mode, surface, true), BACK), `${mode} ${surface}`).toEqual([0, 0, 1]);
      }
    }
  });

  it("defaults to lying, so every existing caller is unchanged", () => {
    for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      expect(flatFor("back", surface).toArray()).toEqual(flatFor("back", surface, false).toArray());
    }
  });
});

describe("holding a wall", () => {
  it("stands `back` upright, because a body on its back cannot grip", () => {
    expect(after(flatFor("back", CLING_WALL), HEAD)).toEqual(UP);
    expect(after(flatFor("back", CLING_WALL), BACK)).toEqual([0, 0, 1]);
  });

  it("leaves `none` alone", () => {
    expect(after(flatFor("none", CLING_WALL), HEAD)).toEqual(UP);
  });

  it("leaves a pose that never lies flat exactly upright, on any surface", () => {
    for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      expect(after(flatFor("none", surface), HEAD)).toEqual(UP);
    }
  });
});

describe("the box that follows the body", () => {
  /** A standing body: narrow, tall, shallow. */
  const STANDING: [number, number, number] = [0.12, 1.1, 0.12];

  it("lays a standing box down so the body rests on the floor", () => {
    // The bug this exists to stop: a pose flagged flat kept its standing box
    // and hung 1.1 units in the air inside it.
    const [x, y, z] = turnHalf(STANDING, flatFor("back", CLING_NONE));
    expect(y).toBeCloseTo(0.12);
    expect(z).toBeCloseTo(1.1);
    expect(x).toBeCloseTo(0.12);
  });

  it("gives `lie` back exactly the box it always had", () => {
    // Stated standing as [0.23, 0.96, 0.12]; on its side that is the original.
    const turned = turnHalf([0.23, 0.96, 0.12], flatFor("side", CLING_NONE));
    expect(turned.map((n) => +n.toFixed(3))).toEqual([0.96, 0.23, 0.12]);
  });

  it("leaves the box standing when `back` is holding a wall", () => {
    // A wall is the one surface a body cannot lie against, so its box is the
    // standing one — long axis vertical, hanging into the room.
    expect(turnHalf(STANDING, flatFor("back", CLING_WALL))).toEqual(STANDING);
    expect(turnHalf(STANDING, flatFor("none", CLING_NONE))).toEqual(STANDING);
  });

  it("lays the box down on a ceiling too", () => {
    // It used to stand up here, because a body-length swung sideways went into
    // the wall you climbed to reach the ceiling. What made this safe is
    // `poseExtents` keeping the standing *footprint* — see `poses.test.ts`.
    const [x, y, z] = turnHalf(STANDING, flatFor("back", CLING_CEILING));
    expect(y).toBeCloseTo(0.12);
    expect(z).toBeCloseTo(1.1);
    expect(x).toBeCloseTo(0.12);
  });

  it("stands the box up for the X toggle, whatever the surface", () => {
    for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      expect(turnHalf(STANDING, flatFor("back", surface, true)), `surface ${surface}`).toEqual(
        STANDING,
      );
    }
  });

  it("keeps `side`'s box lying down everywhere", () => {
    const lie: [number, number, number] = [0.23, 0.96, 0.12];
    for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      expect(turnHalf(lie, flatFor("side", surface)), `surface ${surface}`).toEqual([
        0.96, 0.23, 0.12,
      ]);
    }
  });

  it("keeps a centre's sign, unlike a half-extent", () => {
    // A centre is a real offset: an inch toward the head has to end up an inch
    // *forward* once the head is pointing forward, not an inch backward.
    const [, , z] = turnCentre([0, 0.1, 0], flatFor("back", CLING_NONE));
    expect(z).toBeCloseTo(-0.1);
  });
});
