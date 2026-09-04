// Grain + vignette — HuntVision is the hunter's, Vignette is exported for the
// chameleon too. Outside the Canvas: no post-process pass, no frame cost.
// Mounted before the panels so it darkens the world and not the HUD.

export function HuntVision() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Keyframe lives in index.css (the one stylesheet). */}
      <div className="hunt-grain" />
      <Vignette />
    </div>
  );
}

// Transparent past the crosshair so it never eats what is being aimed at.
export function Vignette() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 75% 75% at 50% 50%," +
          " rgba(0,0,0,0) 34%," +
          " rgba(0,0,0,0.34) 66%," +
          " rgba(0,0,0,0.8) 100%)",
      }}
    />
  );
}
