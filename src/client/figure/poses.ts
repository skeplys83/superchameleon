import { CLING_NONE, POSE_COUNT } from "@/shared/protocol";
import { flatFor, turnCentre, turnHalf, type FlatMode } from "./flat";

// A limb (shoulder/elbow/hip/knee) is aimed: x forward, spread out, twist about
// its length. A lean (torso/chest/neck/head/clavicle) is turned about the
// figure's axes: x pitch, twist yaw, spread tilt. spread/twist are outward per
// side; mirrored pairs share numbers, x is not mirrored.
export type Joint = { x: number; spread: number; twist: number };

export type Sides = { left: Joint; right: Joint };

export type Pose = {
  key: string;
  label: string;
  /** Standing-frame half-extents; poseExtents turns for a pose that lies flat. */
  half: [number, number, number];
  /** Where the collider sits vs the body origin. x/z turn with yaw; y does not. */
  centre: [number, number, number];
  flat: FlatMode;
  rootX: number;
  /** Shifts the figure inside its collider. z is forward-negative. */
  offsetY: number;
  offsetZ: number;
  torso: Joint;
  // Spine1.001 — shares Spine1's origin, so composes rather than curving.
  chest: Joint;
  neck: Joint;
  head: Joint;
  clavicle: Sides;
  shoulder: Sides;
  elbow: Sides;
  hip: Joint;
  knee: Joint;
};

export const POSES: Pose[] = [
  {
    key: "stand",
    label: "Stand",
    half: [0.12, 1.0, 0.12],
    centre: [0, 0, 0],
    flat: "none",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0, spread: 0.09, twist: 0 },
      right: { x: 0, spread: 0.09, twist: 0 },
    },
    elbow: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    // The two hip bones share one origin; every upright pose has to part them.
    hip: { x: 0, spread: 0.30, twist: 0 },
    knee: { x: 0, spread: -0.30, twist: 0 },
  },
  {
    key: "reach",
    label: "Reach up",
    // Taller than standing; centre lifted to keep feet at -1.0.
    half: [0.12, 1.1, 0.12],
    centre: [0, 0.1, 0],
    flat: "back",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0.02, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0.05, spread: 2.98, twist: 0 },
      right: { x: 0.05, spread: 2.98, twist: 0 },
    },
    elbow: {
      left: { x: 0.06, spread: 0.53, twist: 0 },
      right: { x: 0.06, spread: 0.53, twist: 0 },
    },
    hip: { x: 0, spread: 0.38, twist: 0 },
    knee: { x: 0, spread: -0.38, twist: 0 },
  },
  {
    key: "star",
    label: "Star jump",
    // Shorter than standing — spread legs bring feet up to -0.917.
    half: [0.12, 0.94, 0.12],
    centre: [0, 0.025, 0],
    flat: "back",
    rootX: 0,
    offsetY: -0.07,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: 0, twist: 0 },
    head: { x: 0, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 0, spread: 2.36, twist: 0 },
      right: { x: 0, spread: 2.36, twist: 0 },
    },
    elbow: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    hip: { x: 0, spread: 0.8, twist: 0 },
    knee: { x: 0, spread: -0.2, twist: 0 },
  },
  {
    key: "lie",
    label: "Lie flat",
    // Standing box; turns to [0.96, 0.23, 0.12] on its side via poseExtents.
    half: [0.23, 0.96, 0.12],
    centre: [0, 0, 0],
    flat: "side",
    rootX: 0,
    offsetY: 0,
    offsetZ: 0,
    torso: { x: 0, spread: 0, twist: 0 },
    chest: { x: 0, spread: 0, twist: 0 },
    neck: { x: 0, spread: -0.6, twist: 0 },
    head: { x: 0.1, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0.0, spread: 1.0, twist: 0 },
      right: { x: 0.0, spread: 0.0, twist: 0.0 },
    },
    shoulder: {
      left: { x: 0.05, spread: 3.4, twist: 0 },
      right: { x: -0.05, spread: 0.0, twist: 0 },
    },
    elbow: {
      left: { x: 0.13, spread: 1.0, twist: 0 },
      right: { x: 0.13, spread: 0.0, twist: 0 },
    },
    hip: { x: 0, spread: 0.4, twist: 0 },
    knee: { x: 0, spread: -0.4, twist: 0 },
  },
  {
    key: "curl",
    label: "Curl up",
    // Centre measured (test/posedBounds pins it), NOT offsetY/offsetZ repeated
    // — those move the figure, adding them again counts the shift twice.
    half: [0.24, 0.28, 0.24],
    centre: [0, 0.074, 0],
    flat: "none",
    rootX: 0,
    offsetY: 0.15,
    offsetZ: 0.3,
    torso: { x: 5.8, spread: 0, twist: 0 },
    chest: { x: -1, spread: 0, twist: 0 },
    neck: { x: -0.3, spread: 0.0, twist: 0 },
    head: { x: -1.57, spread: 0, twist: 0 },
    clavicle: {
      left: { x: 0, spread: 0, twist: 0 },
      right: { x: 0, spread: 0, twist: 0 },
    },
    shoulder: {
      left: { x: 1.0, spread: 0.05, twist: 0 },
      right: { x: 1.0, spread: 0.05, twist: 0 },
    },
    elbow: {
      right: { x: 1.8, spread: -1.05, twist: 0 },
      left: { x: 1.8, spread: -1.6, twist: 0 },
    },
    hip: { x: 1.8, spread: 0.5, twist: 0 },
    knee: { x: -2.8, spread: 0.5, twist: 0 },
  },
];

if (POSES.length !== POSE_COUNT) {
  throw new Error(
    `poses.ts defines ${POSES.length} poses but shared/protocol.mjs says POSE_COUNT is ` +
    `${POSE_COUNT}. Update protocol.mjs — the server clamps against it.`,
  );
}

export { POSE_COUNT };

export const safePose = (n: unknown) =>
  Number.isFinite(n) ? Math.min(POSE_COUNT - 1, Math.max(0, Math.trunc(n as number))) : 0;

// Fitted table, not derived — read off pose 0 so scale cannot drift.
const FITTED_HY = POSES[0].half[1];

type Box = [number, number, number];
const scaledPoses = new Map<number, { half: Box; centre: Box }[]>();

function atScale(scale: number) {
  let table = scaledPoses.get(scale);
  if (table) return table;
  table = POSES.map((p) => ({
    half: [p.half[0] * scale, p.half[1] * scale, p.half[2] * scale] as Box,
    centre: [p.centre[0] * scale, p.centre[1] * scale, p.centre[2] * scale] as Box,
  }));
  scaledPoses.set(scale, table);
  return table;
}

export function poseExtents(
  pose: number,
  role: [hx: number, hy: number, hz: number],
  cling: number = CLING_NONE,
  upright = false,
): [number, number, number] {
  const i = safePose(pose);
  if (i === 0) return role;
  const half = atScale(role[1] / FITTED_HY)[i].half;
  const turned = turnHalf(half, flatFor(POSES[i].flat, cling, upright));
  // Only the vertical is taken from the turned box; the footprint stays
  // standing — a body-length swung sideways jams against a wall.
  return [half[0], turned[1], half[2]];
}

export function poseCentre(
  pose: number,
  hy: number = FITTED_HY,
  cling: number = CLING_NONE,
  upright = false,
): readonly [number, number, number] {
  const i = safePose(pose);
  if (i === 0) return ORIGIN;
  const centre = atScale(hy / FITTED_HY)[i].centre;
  return turnCentre(centre, flatFor(POSES[i].flat, cling, upright));
}

const ORIGIN = [0, 0, 0] as const;
