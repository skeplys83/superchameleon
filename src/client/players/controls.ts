import type { KeyboardControlsEntry } from "@react-three/drei";
import { POSES } from "@/client/figure/poses";

export type Control =
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "jump"
  | "turnLeft"
  | "turnRight"
  | "flatToggle"
  | `pose${number}`;

/** `1`–`5` select a pose; index 0 is the upright stance. */
export const poseControl = (index: number) => `pose${index}` as Control;

export const controlMap: KeyboardControlsEntry<Control>[] = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "turnLeft", keys: ["KeyQ"] },
  { name: "turnRight", keys: ["KeyE"] },
  // Whether a pose that *can* lie flat actually does. Not a HUD key like `F`,
  // `G` and `R` — it changes the body, so it is polled by the frame loop with
  // everything else that does.
  { name: "flatToggle", keys: ["KeyX"] },
  ...POSES.map((_, i) => ({
    name: poseControl(i),
    keys: [`Digit${i + 1}`],
  })),
];
