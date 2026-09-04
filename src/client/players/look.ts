import * as THREE from "three";

export const CAMERA_DISTANCE = 7;

export type Look = {
  yaw: number;
  pitch: number;
  zoom: number;
  // Wheel writes both instantly; paint mode writes only target and Player.tsx
  // eases zoom toward it.
  zoomTarget: number;
  locked: boolean;
  orbiting: boolean;
  focused: boolean;
};

export const newLook = (): Look => ({
  yaw: 0,
  pitch: -0.2,
  zoom: CAMERA_DISTANCE,
  zoomTarget: CAMERA_DISTANCE,
  locked: false,
  orbiting: false,
  focused: true,
});

export type Motion = {
  bodyYaw: number;
  vy: number;
  grounded: boolean;
  jumpHeld: boolean;
  flatHeld: boolean;
  cling: THREE.Vector3 | null;
  reclingGrace: number;
  // What the body was stuck to when its current box was chosen — a box that
  // turned because the surface changed must not be compensated for.
  surface: number;
  coyote: number;
  buffered: number;
  rising: boolean;
  footOffset: number;
  unfolding: number;
};

export const newMotion = (footOffset: number): Motion => ({
  bodyYaw: 0,
  vy: 0,
  grounded: false,
  jumpHeld: false,
  flatHeld: false,
  cling: null,
  reclingGrace: 0,
  surface: 0,
  coyote: 0,
  buffered: 0,
  rising: false,
  footOffset,
  unfolding: 0,
});
