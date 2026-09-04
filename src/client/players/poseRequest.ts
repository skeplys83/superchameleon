// Channel between the pose wheel (in hud/, outside the Canvas) and Player.
// Requests are TAKEN, not read — a value left here would fight the number keys.
let requested: number | null = null;
let current = 0;

export const requestPose = (index: number) => {
  requested = index;
};

export const takePoseRequest = () => {
  const wanted = requested;
  requested = null;
  return wanted;
};

export const reportPose = (index: number) => {
  current = index;
};

export const currentPose = () => current;
