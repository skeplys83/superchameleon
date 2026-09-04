// Big, bold, round — one look across every panel. Class strings not components
// (elements need disabled/autoFocus/type/state-dependent colours).

export const PANEL =
  "rounded-2xl border border-white/15 bg-neutral-950/85 backdrop-blur shadow-2xl shadow-black/50";

// Never used alone — pick one of the three below.
const BUTTON =
  "rounded-xl border-2 px-5 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40";

export const BUTTON_PRIMARY = `${BUTTON} border-emerald-500 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/45`;
export const BUTTON_QUIET = `${BUTTON} border-neutral-600 bg-white/[0.03] text-neutral-100 hover:border-neutral-400 hover:bg-white/10`;
export const BUTTON_DANGER = `${BUTTON} border-rose-500/70 bg-rose-950/50 text-rose-100 hover:border-rose-400 hover:bg-rose-900/60`;

// Small button in a row (a map chip, Copy).
export const CHIP =
  "rounded-lg border-2 px-3 py-1 text-xs font-bold transition disabled:cursor-not-allowed";

export const INPUT =
  "rounded-xl border-2 border-neutral-700 bg-neutral-900 px-3.5 py-2.5 text-sm font-semibold outline-none transition focus:border-neutral-400";

export const LABEL = "text-[0.6875rem] font-bold uppercase tracking-widest";
