import { BUTTON_PRIMARY, BUTTON_QUIET } from "./ui";

/** The connection died. */
export function DroppedPanel({
  onReconnect,
  onExit,
}: {
  onReconnect: () => void;
  onExit: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
      <div className="flex w-[23rem] flex-col items-center gap-4 rounded-2xl border-2 border-amber-600/50 bg-neutral-950/90 px-8 py-6 text-center">
        <div className="text-lg font-extrabold uppercase tracking-[0.25em] text-amber-300">
          Connection lost
        </div>
        <p className="text-xs font-medium leading-relaxed text-neutral-400">
          The game is still running without you. Reconnect quickly and you keep
          your side, where you were standing and your paint.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onReconnect}
            className={BUTTON_PRIMARY}
          >
            Reconnect
          </button>
          <button
            onClick={onExit}
            className={BUTTON_QUIET}
          >
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
