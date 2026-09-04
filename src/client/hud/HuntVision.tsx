/**
 * What the hunt looks like through a hunter's eyes: grain over the picture, and
 * the corners falling away.
 *
 * **It exists because `HUNT_DPR` cannot help at close range.** Rendering at
 * three tenths and upscaling is a *resolution* handicap, so its strength is
 * proportional to how few pixels a chameleon covers: mush at twenty metres,
 * nearly free at two, where a body still fills hundreds of pixels after the
 * downscale. Grain is the opposite — it is the same amplitude everywhere on
 * screen, so it costs a close body as much as a distant one, and what it eats
 * is exactly what gives a still chameleon away: the soft edge between a painted
 * body and the wall behind it.
 *
 * **Deliberately outside the Canvas**, and therefore free: no second render
 * target, no post-process pass, nothing added to a frame budget already capped
 * at `MAX_FPS`. It is two absolutely-positioned divs and a compositor-only
 * animation. `hud/` may not import from `world/`, `figure/`, `players/` or
 * `combat/` — this needs none of them, because it is not about the scene, only
 * about the glass in front of it.
 *
 * **Mounted before the panels**, so the vignette darkens the world and not the
 * HUD: later siblings paint over it. The crosshair is the CSS cursor and is
 * untouched for the same reason.
 */
export function HuntVision() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The noise itself lives in `index.css` — it needs a keyframe, and that
          is the one stylesheet. */}
      <div className="hunt-grain" />
      <Vignette />
    </div>
  );
}

/**
 * The corners falling away, without the grain — used by everyone in the round.
 * The chameleon gets it too, so a hidden player and the hunter looking for them
 * both see the world close in around the middle. Transparent well past the
 * crosshair so it never eats what is being aimed at; the falloff is all in the
 * outer third.
 */
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
