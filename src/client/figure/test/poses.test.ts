import { describe, expect, it } from "vitest";
import { CLING_CEILING, CLING_NONE, CLING_WALL } from "@/shared/protocol";
import { POSES, poseCentre, poseExtents } from "../poses.ts";

/** The standing body, at the scale the pose table was fitted to. */
const BODY: [number, number, number] = [0.12, 1, 0.12];
const LIE = POSES.findIndex((p) => p.key === "lie");
const CURL = POSES.findIndex((p) => p.key === "curl");

describe("a pose that lies flat", () => {
  it("is the one thing that turns with the surface", () => {
    // Per-pose on purpose: `curl` is a ball and reads the same either way up.
    expect(POSES[LIE].flat).toBe("side");
    expect(POSES[CURL].flat).toBe("none");
  });

  it("keeps the same box on every surface, because `lie` never stands up", () => {
    const floor = poseExtents(LIE, BODY, CLING_NONE);
    expect(poseExtents(LIE, BODY, CLING_CEILING)).toEqual(floor);
    expect(poseExtents(LIE, BODY, CLING_WALL)).toEqual(floor);
  });

  it("never grows sideways past the standing footprint", () => {
    // The rule that fixed three separate "stuck" reports: lying down takes the
    // turned box's *vertical* extent only. Swinging a body-length out sideways
    // put it through whatever the body happened to be facing, and a kinematic
    // collider that starts penetrating gets no movement back.
    const standing = POSES[LIE].half;
    for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      const [x, , z] = poseExtents(LIE, BODY, surface);
      expect(x, `surface ${surface}`).toBeCloseTo(standing[0]);
      expect(z, `surface ${surface}`).toBeCloseTo(standing[2]);
    }
  });

  it("stands a `back` pose's box up for a wall, and only for a wall", () => {
    const REACH = POSES.findIndex((p) => p.key === "reach");
    const standing = poseExtents(REACH, BODY, CLING_WALL);

    // On the floor it lies down — which now means *only* going short, never
    // long. Lying is what makes the body low, not what makes it wide.
    const lying = poseExtents(REACH, BODY, CLING_NONE);
    expect(lying[1]).toBeLessThan(standing[1]);
    expect(lying[0]).toBeCloseTo(standing[0]);
    expect(lying[2]).toBeCloseTo(standing[2]);

    // And a ceiling is lain against exactly as a floor is.
    expect(poseExtents(REACH, BODY, CLING_CEILING)).toEqual(lying);
  });

  it("stands every box up for the X toggle, on every surface", () => {
    const REACH = POSES.findIndex((p) => p.key === "reach");
    for (const pose of [REACH, LIE]) {
      const standing = poseExtents(pose, BODY, CLING_WALL, true);
      for (const surface of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
        expect(poseExtents(pose, BODY, surface, true), `${pose} ${surface}`).toEqual(standing);
        expect(poseCentre(pose, 1, surface, true), `${pose} ${surface}`).toEqual(
          poseCentre(pose, 1, CLING_WALL, true),
        );
      }
    }
    // And it is a real difference for a pose that would otherwise lie down.
    expect(poseExtents(LIE, BODY, CLING_NONE, true)).not.toEqual(
      poseExtents(LIE, BODY, CLING_NONE),
    );
  });

  it("leaves a pose that does not roll alone on every surface", () => {
    for (const cling of [CLING_NONE, CLING_WALL, CLING_CEILING]) {
      expect(poseExtents(CURL, BODY, cling)).toEqual(poseExtents(CURL, BODY, CLING_NONE));
      expect(poseCentre(CURL, 1, cling)).toEqual(poseCentre(CURL, 1, CLING_NONE));
    }
  });

  it("defaults to lying, so every existing caller is unchanged", () => {
    expect(poseExtents(LIE, BODY)).toEqual(poseExtents(LIE, BODY, CLING_NONE));
    expect(poseCentre(LIE, 1)).toEqual(poseCentre(LIE, 1, CLING_NONE));
  });

  it("scales the turned box with the body, like the unturned one", () => {
    const full = poseExtents(LIE, BODY, CLING_NONE);
    const small = poseExtents(LIE, [0.06, 0.5, 0.06], CLING_NONE);
    expect(small.map((n) => +(n * 2).toFixed(4))).toEqual(full.map((n) => +n.toFixed(4)));
  });
});
