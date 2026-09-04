import type { Role } from "@/shared/protocol";

export type RemoteTarget = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  pose: number;
  cling: number;
  upright: boolean;
};

export type Remote = {
  id: string;
  name: string;
  role: Role;
  target: RemoteTarget;
};

// Mutated in place — re-rendering per patch is 60 renders/s per player.
export const remotes = new Map<string, Remote>();

const rosterListeners = new Set<(ids: string[]) => void>();

// Fires on join/leave only, never on a movement patch.
export function onRoster(fn: (ids: string[]) => void) {
  rosterListeners.add(fn);
  return () => {
    rosterListeners.delete(fn);
  };
}

export function emitRoster() {
  const ids = [...remotes.keys()];
  rosterListeners.forEach((fn) => fn(ids));
}

export function clearRemotes() {
  if (!remotes.size) return;
  remotes.clear();
  emitRoster();
}
