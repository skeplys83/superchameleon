export type SoundName =
  | "shotgun"
  | "squash"
  | "step"
  | "brush"
  | "whistle"
  | "tick"
  | "bell"
  | "gong"
  | "hideMusic"
  | "huntMusic";

export type SoundSpec = {
  url: string;
  gain: number;
  // Positional sounds must be mono (trap 3).
  positional: boolean;
  deferred?: boolean;
};

export const SOUNDS: Record<SoundName, SoundSpec> = {
  shotgun: { url: "/sounds/shotgun.mp3", gain: 0.9, positional: true },
  squash: { url: "/sounds/squash.mp3", gain: 1.0, positional: true },
  step: { url: "/sounds/step.mp3", gain: 0.6, positional: true },
  brush: { url: "/sounds/brush.mp3", gain: 0.28, positional: false },
  whistle: { url: "/sounds/whistle.mp3", gain: 0.9, positional: true },

  tick: { url: "/sounds/tick.mp3", gain: 0.3, positional: false },
  bell: { url: "/sounds/bell.mp3", gain: 0.85, positional: false },
  gong: { url: "/sounds/gong.mp3", gain: 0.42, positional: false },
  // The two music beds are loudness-matched (−15.2 LUFS, 0.1 LU apart) so
  // this single number sets the level of "the music" (invariant 4a).
  hideMusic: { url: "/sounds/hide-music.mp3", gain: 0.095, positional: false, deferred: true },
  huntMusic: { url: "/sounds/hunt-music.mp3", gain: 0.095, positional: false, deferred: true },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

export const EAGER_SOUNDS = SOUND_NAMES.filter((n) => !SOUNDS[n].deferred);
export const DEFERRED_SOUNDS = SOUND_NAMES.filter((n) => SOUNDS[n].deferred);
