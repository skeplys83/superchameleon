// One-frame pulse from trigger to viewmodel — a Game.tsx prop would React-render on every shot.
let pending = false;

export const kickViewmodel = () => {
  pending = true;
};

export function takeKick() {
  if (!pending) return false;
  pending = false;
  return true;
}
