export type Brush = {
  color: string;
  // Radius in figure-local units (figure is 2 tall) — a dot is the same size
  // on a forearm as on the head.
  size: number;
};

export const DEFAULT_BRUSH: Brush = { color: "#e0245e", size: 0.06 };

// ~4 texels across the radius on the 1024² skin — below that dabs disappear
// between texels rather than getting thinner.
export const MIN_SIZE = 0.008;
export const MAX_SIZE = 0.5;
