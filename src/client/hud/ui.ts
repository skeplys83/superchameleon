/**
 * The HUD's one look, in a handful of class strings.
 *
 * **Big, bold and round, everywhere.** Every panel used to carry its own sizes,
 * so the pause menu was a font size smaller than the lobby card beside it and
 * the chat prompt smaller again — a difference nobody chose, arrived at one
 * component at a time. These are the sizes; a panel that wants something else
 * should have a reason and a comment.
 *
 * They are plain strings rather than components on purpose. Half of these
 * elements need a `disabled`, an `autoFocus`, a `type="submit"` or a colour that
 * depends on state, and wrapping each in a component that forwards all of it is
 * more code than the class list it replaces.
 */

/** A card: the lobby panel, the pause menu, the round-over card. */
export const PANEL =
  "rounded-2xl border border-white/15 bg-neutral-950/85 backdrop-blur shadow-2xl shadow-black/50";

/** Shared by every button. Never used alone — one of the three below. */
const BUTTON =
  "rounded-xl border-2 px-5 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40";

/** The one thing a panel wants you to press. */
export const BUTTON_PRIMARY = `${BUTTON} border-emerald-500 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/45`;
/** Everything else. */
export const BUTTON_QUIET = `${BUTTON} border-neutral-600 bg-white/[0.03] text-neutral-100 hover:border-neutral-400 hover:bg-white/10`;
/** Leaving, and nothing else. */
export const BUTTON_DANGER = `${BUTTON} border-rose-500/70 bg-rose-950/50 text-rose-100 hover:border-rose-400 hover:bg-rose-900/60`;

/** A small button in a row of them — a map chip, Copy. */
export const CHIP =
  "rounded-lg border-2 px-3 py-1 text-xs font-bold transition disabled:cursor-not-allowed";

export const INPUT =
  "rounded-xl border-2 border-neutral-700 bg-neutral-900 px-3.5 py-2.5 text-sm font-semibold outline-none transition focus:border-neutral-400";

/** The small capitals over a section. */
export const LABEL = "text-[11px] font-bold uppercase tracking-widest";
