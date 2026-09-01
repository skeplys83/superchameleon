type Row = [key: string, action: string];

/**
 * The chameleon's legend, and the only one there is.
 *
 * **A hunter gets no panel at all.** They walk and they shoot, and both of
 * those are what every first-person game has already taught them — the legend
 * they used to get said "WASD · Space · Mouse · Left click", which is four rows
 * of nothing anybody had to be told. A chameleon is the one who has to learn
 * something: the poses, turning the figure on the spot, and the brush.
 *
 * **What every game already teaches is left out here too**: WASD to move, Space
 * to jump, the mouse to look, the wheel to zoom. Printing them crowded out the
 * keys that are actually particular to this game.
 *
 * **The number keys are not printed.** They still work, but the wheel is the
 * way in that is worth learning and a row of digits under it was the same
 * five poses said twice.
 *
 * **It sits along the bottom of the screen, centred.** It used to be a table in
 * the top-right corner, which is the one part of the screen a third-person
 * player is never looking at — the body they are steering is in the middle and
 * the ground under it is below that. Down here it is under the eye rather than
 * across the room from it, and short enough to read without stopping.
 */
const PLAYING: Row[] = [
  ["R", "Poses"],
  ["X", "Lie / stand"],
  ["F", "Paint"],
  ["Q ←", "Turn left"],
  ["E →", "Turn right"],
];

/**
 * What the keys mean once paint mode is on. It **replaces** the row above
 * rather than sitting beside it: none of it is reachable until `F` is pressed —
 * the pointer is captured the rest of the time — and both at once is ten chips
 * across the bottom of the screen, which is a wall rather than a legend.
 */
const PAINTING: Row[] = [
  ["Right drag", "Brush size"],
  ["G", "Pick a colour"],
  ["F", "Done"],
];

/**
 * One key cap.
 *
 * **The corner radius is a fixed length, not a share of the side.** A
 * percentage radius is taken per axis, so a wide cap — "Right drag" — came out
 * an ellipse while a square one beside it was a squircle. A length in `rem`
 * keeps every cap the same corner however long its name is; it is set to about
 * a third of the height, which is what makes a square one read as a squircle.
 */
function Cap({ label, action }: { label: string; action: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-11 min-w-11 items-center justify-center rounded-[0.9rem] border border-white/20 bg-black/60 px-3 font-mono text-sm font-semibold text-white backdrop-blur">
        {label}
      </div>
      <div className="text-[0.625rem] text-neutral-300">{action}</div>
    </div>
  );
}

export function ControlsPanel({ painting }: { painting: boolean }) {
  const rows = painting ? PAINTING : PLAYING;
  return (
    // `pointer-events-none`, like every legend: the palette and the chat box
    // both reach up into this strip and a transparent bar must not eat a click
    // meant for either.
    <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 select-none items-start gap-2.5">
      {/* Indexed, not keyed on the key: two rows can name the same button. */}
      {rows.map(([key, action], i) => (
        <Cap key={i} label={key} action={action} />
      ))}
    </div>
  );
}
