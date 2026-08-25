import { useState } from "react";
import { sendMap, sendStart } from "@/client/net";
import { playableMaps, mapName } from "@/shared/maps";
import { DEV } from "@/client/app/dev";
import { MIN_PLAYERS, type Phase } from "@/shared/protocol";
import { generateInviteLink } from "@/client/app/crazygames";

/** The waiting room's own overlay: the invite code, the map you are about to play, and Start. */
export function LobbyPanel({
  code,
  nextMap,
  isHost,
  isListed,
  phase,
  timeLeft,
  players,
  maxPlayers,
}: {
  code: string;
  nextMap: string;
  isHost: boolean;
  isListed: boolean;
  /** `"waiting"` or `"countdown"`, and `"reveal"` if the round ended before the
   *  hunter was ever sent in. Never `"hiding"` — `HunterWait` replaces this. */
  phase: Phase;
  /** Seconds left on the countdown. Zero while waiting. */
  timeLeft: number;
  players: number;
  maxPlayers: number;
}) {
  const [copied, setCopied] = useState(false);
  const counting = phase === "countdown";
  /** A lobby only reaches `reveal` when its match ended before the hunter was
   *  ever sent in — everybody hiding left. The round-over card is over this. */
  const roundOver = phase === "reveal";
  /** Two is the floor: a round needs a hunter and something to hunt. The server
   *  refuses Start below it too — this only greys the button out. */
  const enough = players >= MIN_PLAYERS;

  /** Copy the code or invite link, by whichever of the two routes exists here. */
  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };

    const textToCopy = generateInviteLink(code);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy).then(done, () => {});
      return;
    }

    const scratch = document.createElement("textarea");
    scratch.value = textToCopy;
    // Off-screen rather than hidden: `display: none` cannot hold a selection.
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    try {
      if (document.execCommand("copy")) done();
    } catch {
      // Nothing left to try. The code is legible on the panel.
    }
    scratch.remove();
  };

  return (
    <div className="pointer-events-auto w-[22rem] rounded-lg border border-neutral-700 bg-neutral-950/90 px-4 py-3 text-neutral-100">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">
            Invite code · {isListed ? "public" : "unlisted"}
            {isHost && (
              <span className="font-semibold text-red-400">
                {" "}
                · you are host
              </span>
            )}
          </div>
          <div className="font-mono text-2xl tracking-[0.35em]">{code}</div>
        </div>
        <button
          onClick={copy}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-500"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* The roster, and the countdown when there is one. It is the same strip
          for everybody: whether the round is about to begin is not a host's
          private business, and the tick everyone hears needs a number to belong
          to. */}
      <div
        className={`mt-3 flex items-baseline justify-between rounded-md px-2.5 py-1.5 ${
          counting ? "bg-emerald-950/60" : "bg-neutral-900/70"
        }`}
      >
        <span className="text-[10px] uppercase tracking-widest text-neutral-400">
          {counting ? "Starting" : "Waiting"}
        </span>
        <span className="flex items-baseline gap-3">
          {counting && (
            <span className="font-mono text-xl tabular-nums text-emerald-300">
              {timeLeft}
            </span>
          )}
          <span className="font-mono text-sm tabular-nums text-neutral-300">
            {players} / {maxPlayers}
          </span>
        </span>
      </div>
      {!counting && !roundOver && !enough && (
        <div className="mt-1 text-[10px] leading-snug text-neutral-500">
          Waiting for {MIN_PLAYERS - players} more — a round needs at least{" "}
          {MIN_PLAYERS}.
        </div>
      )}

      {isHost ? (
        <>
          <div className="mt-3 mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-widest text-neutral-500">
            <span>Map</span>
            {counting && <span className="text-neutral-600">locked in</span>}
          </div>
          {/* Locked once the countdown runs: everybody is already preloading
              this map, and the server refuses the change anyway. */}
          <div className="flex flex-wrap gap-1.5">
            {playableMaps(DEV).map((m) => (
              <button
                key={m.id}
                disabled={counting}
                onClick={() => sendMap(m.id)}
                title={counting ? "The map is settled once the countdown starts" : m.blurb}
                className={`rounded-md border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed ${
                  nextMap === m.id
                    ? "border-neutral-300 bg-neutral-800 text-neutral-100"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500 disabled:hover:border-neutral-700"
                } ${counting && nextMap !== m.id ? "opacity-30" : ""}`}
              >
                {m.name}
              </button>
            ))}
          </div>
          {/* No Start while the countdown runs: it is already starting, and the
              server ignores a second press anyway rather than restarting the
              clock. */}
          {!counting && !roundOver && (
            <button
              onClick={sendStart}
              disabled={!enough}
              className="mt-3 w-full rounded-md border border-emerald-500 bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start on {mapName(nextMap)}
            </button>
          )}
        </>
      ) : (
        <>
          {/* The map is the one thing a non-host actually needs from this panel,
              so it gets the weight the Start button has for the host rather than
              being buried mid-sentence. */}
          <div className="mt-3 text-[10px] uppercase tracking-widest text-neutral-500">
            Next map
          </div>
          <div className="text-lg font-medium text-neutral-100">
            {mapName(nextMap)}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Waiting for the host to start. One player keeps the shotgun and the
            rest become chameleons — your paint comes with you.
          </p>
        </>
      )}
    </div>
  );
}
