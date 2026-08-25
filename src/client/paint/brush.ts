/** What the brush is, separately from the panel that edits it. */
export type Brush = {
  color: string;
  /**
   * Radius in figure-local units (the figure is 2 tall), so a dot is the same
   * size on a forearm as on the head. `skin.ts` converts it per part.
   */
  size: number;
};

export const DEFAULT_BRUSH: Brush = { color: "#e0245e", size: 0.06 };

/**
 * The finest line the brush can lay down. In figure-local units, and the body's
 * unwrap puts roughly two of those in one UV unit, so this is a dab about four
 * texels across the radius on the 1024² skin — thin enough for a stripe, still
 * several texels wide, which is the floor worth having: below that a dab starts
 * disappearing between texels rather than getting thinner.
 */
export const MIN_SIZE = 0.008;
export const MAX_SIZE = 0.5;
