import { useEffect, useRef, useState } from "react";
import { fetchSessions, type Game } from "@/client/net";
import { randomName } from "@/shared/names";
import { DEFAULT_MATCH_MAP, mapName, type MapId } from "@/shared/maps";
import { DEFAULT_PLAYERS } from "@/shared/protocol";
import { MapList } from "./MapList";
import { LegalPage } from "./LegalPage";
import { Footer } from "./Footer";
import { getInitialInviteRoom } from "@/client/app/crazygames";
import { DEV } from "@/client/app/dev";
import { BUTTON_QUIET, INPUT, LABEL } from "./ui";

const NAME_KEY = "mc_name";

const SESSION_POLL_MS = 5000;

function readName() {
  try {
    return sessionStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string) {
  try {
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    // Name will not survive a reload.
  }
}

export function StartMenu({
  onCreate,
  onJoinCode,
  onQuickPlay,
}: {
  onCreate: (
    name: string,
    map: MapId,
    listed: boolean,
    maxPlayers: number,
  ) => void;
  onJoinCode: (name: string, code: string) => void;
  onQuickPlay: (name: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState(() => getInitialInviteRoom() ?? "");
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    if (input.current) input.current.value = readName() || randomName();
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      const { ready: isReady, games: open } = await fetchSessions();
      if (!alive) return;
      setReady(isReady);
      setGames(open);
    };

    const run = () => {
      clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      void poll();
      timer = setInterval(() => void poll(), SESSION_POLL_MS);
    };

    run();
    document.addEventListener("visibilitychange", run);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  const [legal, setLegal] = useState(false);

  const takeName = () => {
    const trimmed = (input.current?.value ?? "").trim().slice(0, 16) || "player";
    writeName(trimmed);
    return trimmed;
  };

  if (legal) return <LegalPage onBack={() => setLegal(false)} />;

  return (
    <div className="absolute inset-0 bg-neutral-950/90 text-neutral-100 backdrop-blur-sm">
      {/* The scroller is a plain `overflow-y-auto` around a `min-h-full` grid.
          Centring the scroller itself clips the top of anything taller than the
          viewport, which is the whole reason the middle column does its own
          centring rather than this one doing it for all three. */}
      <div className="h-full overflow-y-auto">
        {/* **Exact thirds, and no gap on the grid.** A `gap` here would make
            each column a third *minus* its share of it, which is the thing
            "the map list takes the first third" stops being true of. The
            breathing room is padding inside each column, so the outer two run
            to the edges of the screen — and both of them start at the *top*,
            in the corners, while only the middle is centred. */}
        <div className="grid min-h-full w-full grid-cols-3 pb-12">
          {/* ── Top-left: what this build ships ──────────────────────────── */}
          <div className="flex min-h-0 min-w-0 flex-col px-6 py-6">
            <MapList />
          </div>

          {/* ── The middle third: the one thing this page is for ──────────── */}
          <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-6 py-10">
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-5xl font-extrabold tracking-tight">Super Chameleon</h1>
              <p className="max-w-md text-center text-sm font-medium text-neutral-400">
                Everyone waits in the lobby, armed. When the host starts, one player keeps the
                shotgun — the rest become chameleons.
              </p>
            </div>

            <input
              ref={input}
              defaultValue=""
              placeholder="Your name"
              maxLength={16}
              className={`mt-2 w-full max-w-sm text-center ${INPUT}`}
            />

            {/* **No modal.** It asked three questions before anybody had seen
                the game: the map is the host's to change in the lobby, a game
                nobody can find is the exception rather than the rule, and the
                size only ever mattered to somebody who already had friends
                waiting. Straight in on the defaults. */}
            <button
              onClick={() =>
                ready && onCreate(takeName(), DEFAULT_MATCH_MAP, true, DEFAULT_PLAYERS)
              }
              disabled={!ready}
              // The nudge is dropped while the button does nothing — a control
              // waving at you that it will not answer is worse than a still one.
              className={`w-full rounded-[2rem] border-4 border-emerald-500 bg-emerald-600/25 py-10 text-4xl font-extrabold uppercase tracking-[0.15em] text-emerald-100 shadow-2xl shadow-emerald-950/60 transition hover:bg-emerald-600/45 disabled:cursor-not-allowed disabled:opacity-40 ${
                ready ? "play-nudge" : ""
              }`}
            >
              Play now
            </button>

            <p className="text-center text-sm font-medium text-neutral-500">
              Opens a lobby straight away, public, with a code to hand out. Change the map from
              inside it — you are the host.
            </p>

            {/* ── Under it, the other way in ─────────────────────────────────
                Below Play now and never beside it: they are the same decision
                asked twice, and a code box level with the button reads as an
                equal choice when it is the exception — you only have four
                letters if somebody handed them to you. */}
            <section className="mt-4 w-full max-w-sm">
              <div className={`mb-3 text-center text-neutral-300 ${LABEL}`}>Join with a code</div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const wanted = code.trim().toUpperCase();
                  if (ready && wanted) onJoinCode(takeName(), wanted);
                }}
                className="flex flex-col gap-3"
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  maxLength={8}
                  autoComplete="off"
                  className={`w-full text-center font-mono text-2xl font-bold tracking-[0.4em] ${INPUT}`}
                />
                <button
                  type="submit"
                  disabled={!ready || !code.trim()}
                  className={`w-full ${BUTTON_QUIET}`}
                >
                  Join
                </button>
              </form>
              <p className="mt-2 text-center text-sm leading-snug text-neutral-600">
                Four letters, from whoever opened the game.
              </p>
            </section>

            {/* Dev builds only, and `DEV` is substituted by vite rather than
                read — so this button and the hook behind it are dropped from
                the production bundle entirely. See `app/dev.ts`. */}
            {DEV && (
              <>
                <button
                  onClick={() => ready && onQuickPlay(takeName())}
                  disabled={!ready}
                  className="mt-4 rounded-2xl border-2 border-amber-500/70 bg-amber-500/10 px-6 py-3 text-base font-bold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
                >
                  Quick play (dev)
                </button>
                <p className="text-center text-sm leading-snug text-neutral-600">
                  Opens a second window as the other player and starts the round. The draw
                  decides which of you gets the gun.
                </p>
              </>
            )}

            {!ready && (
              <p className="text-sm font-medium text-neutral-600">Looking for the game server…</p>
            )}
          </div>

          {/* ── Top-right: what is open right now ─────────────────────────── */}
          <div className="flex min-h-0 min-w-0 flex-col px-6 py-6">
            <section className="flex min-h-0 flex-1 flex-col rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="mb-3 flex shrink-0 items-baseline justify-between">
                <span className={`text-neutral-400 ${LABEL}`}>Public games</span>
                <span className="text-sm font-bold text-neutral-600">{games.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                {games.map((g) => (
                  <button
                    key={g.code}
                    disabled={g.started || g.starting}
                    onClick={() => ready && onJoinCode(takeName(), g.code)}
                    className="mb-2 flex w-full items-center justify-between gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-900 px-4 py-3 text-left text-base font-bold transition hover:border-neutral-600 disabled:opacity-40 disabled:hover:border-neutral-800"
                  >
                    <span className="min-w-0">
                      <span className="font-mono tracking-[0.2em] text-neutral-200">{g.code}</span>
                      <span className="ml-2 truncate text-sm font-medium text-neutral-500">
                        {g.host ? `${g.host}'s game` : "waiting room"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-neutral-500">
                      {mapName(g.map)} · {g.players}
                      {g.maxPlayers ? ` / ${g.maxPlayers}` : ""}
                      {g.started ? " · in play" : g.starting ? " · starting" : ""}
                    </span>
                  </button>
                ))}

                {games.length === 0 && (
                  <p className="px-1 pt-1 text-sm text-neutral-600">No public games right now.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <Footer onLegal={() => setLegal(true)} />
    </div>
  );
}
