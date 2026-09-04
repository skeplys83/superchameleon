// Recently-used colours, most recent first. Client-side, in memory only, and
// deliberately outlives a room (the map you were matching is often the map
// you go back to). A "use" is a stroke begun (from usePointerControls), not a
// colour chosen — else the history is a log of dragging across the wheel.

const MAX_RECENT = 10;

export const WHITE = "#ffffff";

let recent: string[] = [];
const listeners = new Set<() => void>();

export function recentColors(): string[] {
  return recent;
}

export function rememberColor(hex: string) {
  const colour = hex.toLowerCase();
  // Common call is a repeat of the head — avoid re-rendering on every stroke.
  if (recent[0] === colour) return;
  recent = [colour, ...recent.filter((c) => c !== colour)].slice(0, MAX_RECENT);
  listeners.forEach((fn) => fn());
}

export function subscribeColors(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
