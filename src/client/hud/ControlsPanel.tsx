type Row = [key: string, action: string];

// Chameleon-only. Hunter walks and shoots (nothing every FPS has not taught).
// WASD/Space/mouse are left out for the same reason.
const PLAYING: Row[] = [
  ["R", "Poses"],
  ["X", "Lie / stand"],
  ["F", "Paint"],
  ["Q ←", "Turn left"],
  ["E →", "Turn right"],];

// Replaces PLAYING rather than sitting beside it — none is reachable until F
// is pressed, and both at once is ten chips wide.
const PAINTING: Row[] = [
  ["Right drag", "Brush size"],
  ["G", "Pick a colour"],
  ["F", "Done"],
];

// Fixed-length radius, not a percentage — a percentage radius resolves per
// axis, so "Right drag" would come out an ellipse.
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
    // pointer-events-none — palette and chat reach up into this strip.
    <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 select-none items-start gap-2.5">
      {/* Indexed key — two rows can name the same button. */}
      {rows.map(([key, action], i) => (
        <Cap key={i} label={key} action={action} />
      ))}
    </div>
  );
}
