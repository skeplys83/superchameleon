import { BUTTON_DANGER, BUTTON_QUIET, PANEL } from "./ui";

/** One dark panel along the bottom edge. */
export function PauseMenu({
  sessionName,
  onResume,
  onLeave,
}: {
  sessionName: string;
  onResume: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 select-none">
      <div className={`flex flex-col items-center gap-3 px-8 py-5 font-mono ${PANEL}`}>
        <div className="text-center">
          {/* The letter-spacing hangs off the last glyph, so the padding puts
              the word back on the panel's centre line. */}
          <div className="pl-[0.3em] text-lg font-extrabold uppercase tracking-[0.3em] text-neutral-50">
            Paused
          </div>
          <div className="mt-1 max-w-[18rem] truncate text-xs font-medium text-neutral-400">
            {sessionName}
          </div>
        </div>

        <div className="flex w-full gap-3">
          <button
            onClick={onLeave}
            className={`flex-1 basis-0 whitespace-nowrap ${BUTTON_DANGER}`}
          >
            Leave game
          </button>
          <button
            onClick={onResume}
            className={`flex-1 basis-0 whitespace-nowrap ${BUTTON_QUIET}`}
          >
            Resume
          </button>
        </div>

        {/* Not "Esc toggles pause" any more: Esc is what released the pointer,
            and the browser will not give it back for about a second afterwards.
            Resuming has to be a click. */}
        {/* There is no way back into a round you walked out of, so the button
            says so. Leaving a match used to drop you in the waiting room with
            the clock still running, which read as still being in the game. */}
        <div className="text-[0.6875rem] font-medium text-neutral-500">
          {"Leaving ends the game for you \u2014 click Resume to continue"}
        </div>
      </div>
    </div>
  );
}
