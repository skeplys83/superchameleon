/** Every sound in the game, and how loud it is relative to the others. See trap 3. */

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
  /** Baseline volume. Relative to the others, not absolute. */
  gain: number;
  /** Whether this sound is ever played at a point in the world. Mono-only. */
  positional: boolean;
  /** Fetched later than the rest, and separately. */
  deferred?: boolean;
};

export const SOUNDS: Record<SoundName, SoundSpec> = {
  /** A shot, at the shooter. Fires whether it hit a wall or a person. */
  shotgun: { url: "/sounds/shotgun.mp3", gain: 0.9, positional: true },
  /** Someone died, at the body. Everyone hears it — it is how a chameleon learns
   *  the hunter is finding people, and roughly where. */
  squash: { url: "/sounds/squash.mp3", gain: 1.0, positional: true },
  /** One footfall. Pitched by body size, see `footsteps.ts`. */
  step: { url: "/sounds/step.mp3", gain: 0.6, positional: true },
  /** Looped while you are dragging the brush across your own body. */
  brush: { url: "/sounds/brush.mp3", gain: 0.28, positional: false },
  /** Every player's periodic tell, at whoever let it out. */
  whistle: { url: "/sounds/whistle.mp3", gain: 0.9, positional: true },

  /** One second of a countdown. */
  tick: { url: "/sounds/tick.mp3", gain: 0.3, positional: false },
  /** The hiding phase is over and the hunter is coming. The one sound in the
   *  game that changes what you should be doing. */
  bell: { url: "/sounds/bell.mp3", gain: 0.85, positional: false },
  /** The round is decided, either way. See invariant 2. */
  gong: { url: "/sounds/gong.mp3", gain: 0.42, positional: false },
  /** The two music beds, one per phase. **Their gains are equal on purpose** —
   *  the files are loudness-matched to each other (−15.2 LUFS integrated, 0.1 LU
   *  apart), so one number sets the level of the music as such rather than of
   *  either track. See invariant 4a. 0.095 puts them where `ambient` used to sit,
   *  ~20 dB under the announcements: present, and never over a footstep. */
  hideMusic: { url: "/sounds/hide-music.mp3", gain: 0.095, positional: false, deferred: true },
  /** Played once `MUSIC_DELAY_MS` after the bell, so the bell rings alone. */
  huntMusic: { url: "/sounds/hunt-music.mp3", gain: 0.095, positional: false, deferred: true },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

export const EAGER_SOUNDS = SOUND_NAMES.filter((n) => !SOUNDS[n].deferred);
export const DEFERRED_SOUNDS = SOUND_NAMES.filter((n) => SOUNDS[n].deferred);

