import { useEffect, useRef, useState } from "react";
import { fetchSessions, type Game } from "@/client/net";
import { randomName } from "@/shared/names";
import { mapName, type MapId } from "@/shared/maps";
import { CreateGamePanel } from "./CreateGamePanel";
import { MapList } from "./MapList";
import { LegalPage } from "./LegalPage";
import { Footer } from "./Footer";
import { getInitialInviteRoom } from "@/client/app/crazygames";
import { DEV } from "@/client/app/dev";

/** The name lives in `sessionStorage`, scoped to the tab. */
const NAME_KEY = "mc_name";

/** How often the games list is refreshed while this menu is in front. */
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
    // No storage available — the name will not survive a reload.
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
  /** Dev builds only: straight into a round, second window and all. */
  onQuickPlay: (name: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState(() => getInitialInviteRoom() ?? "");
  const [games, setGames] = useState<Game[]>([]);
  /** The create modal. Map, listing and size all live inside it. */
  const [creating, setCreating] = useState(false);

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

  /** The legal page replaces this menu, so the arena behind it is unchanged. */
  const [legal, setLegal] = useState(false);

  const takeName = () => {
    const trimmed = (input.current?.value ?? "").trim().slice(0, 16) || "player";
    writeName(trimmed);
    return trimmed;
  };

  if (legal) return <LegalPage onBack={() => setLegal(false)} />;

  return (
    <div className="absolute inset-0 bg-neutral-950/90 text-neutral-100 backdrop-blur-sm">
      {/* Centred when it fits, scrolled when it does not. `justify-center` on the
          scroller itself clips the top of anything taller than the viewport —
          the min-h-full inner column is what keeps both behaviours. */}
      <div className="h-full overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center gap-8 py-10 pb-16">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Super Chameleon</h1>
          <p className="max-w-md text-center text-xs text-neutral-500">
            Everyone waits in the arena, armed. When the host starts, one player keeps the shotgun —
            the rest become chameleons.
          </p>
        </div>

        <input
          ref={input}
          defaultValue=""
          placeholder="Your name"
          maxLength={16}
          className="w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-sm outline-none focus:border-neutral-500"
        />

        {/* A third and two thirds. Both carry a min width, so on a screen too
            narrow to honour the split the row wraps and the page scrolls
            rather than squeezing either side into uselessness. */}
        <div className="flex w-full max-w-7xl flex-wrap items-stretch justify-center gap-10 px-6">
          <div className="h-[70vh] min-h-[26rem] min-w-[20rem] grow basis-[calc(33.333%-1.25rem)]">
            <MapList />
          </div>

          <div className="grid min-w-[20rem] grow basis-[calc(66.667%-1.25rem)] grid-cols-1 items-stretch gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-8">
            {/* ── Open a game of your own ─────────────────────────────────── */}
            <section>
              <div className="mb-3 text-xs uppercase tracking-widest text-neutral-400">
                Create game
              </div>

              <p className="mb-4 text-[11px] leading-relaxed text-neutral-500">
                Pick a map, a size and whether strangers can see it. You get a code to hand out
                either way.
              </p>

              <button
                onClick={() => setCreating(true)}
                disabled={!ready}
                className="w-full rounded-lg border border-emerald-500 bg-emerald-600/20 px-6 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-600/40 disabled:opacity-40"
              >
                Create game
              </button>

              {/* Dev builds only, and `DEV` is substituted by vite rather than
                  read — so this button and the hook behind it are dropped from
                  the production bundle entirely. See `app/dev.ts`. */}
              {DEV && (
                <>
                  <button
                    onClick={() => ready && onQuickPlay(takeName())}
                    disabled={!ready}
                    className="mt-3 w-full rounded-lg border border-amber-500/70 bg-amber-500/10 px-6 py-2.5 text-sm text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
                  >
                    Quick play (dev)
                  </button>
                  <p className="mt-2 text-[11px] leading-snug text-neutral-600">
                    Opens a second window as the other player and starts the round.
                    The draw decides which of you gets the gun.
                  </p>
                </>
              )}
            </section>

            {/* ── Or type someone's code ──────────────────────────────────── */}
            <section>
              <div className="mb-3 text-xs uppercase tracking-widest text-neutral-400">
                Join game
              </div>

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
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-3 text-center font-mono text-xl tracking-[0.4em] outline-none focus:border-neutral-500"
                />
                <button
                  type="submit"
                  disabled={!ready || !code.trim()}
                  className="w-full rounded-lg border border-neutral-600 px-6 py-3 text-sm transition hover:border-neutral-400 disabled:opacity-40"
                >
                  Join
                </button>
              </form>
              <p className="mt-2 text-[11px] leading-snug text-neutral-600">
                Four letters, from whoever opened the game.
              </p>
            </section>
          </div>

          {/* ── What is open right now ────────────────────────────────────── */}
          <div className="relative min-h-[18rem]">
            <section className="absolute inset-0 flex min-h-0 flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="mb-2 flex shrink-0 items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  Public games
                </span>
                <span className="text-xs text-neutral-600">{games.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                {games.map((g) => (
                  <button
                    key={g.code}
                    disabled={g.started || g.starting}
                    onClick={() => ready && onJoinCode(takeName(), g.code)}
                    className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-sm transition hover:border-neutral-600 disabled:opacity-40 disabled:hover:border-neutral-800"
                  >
                    <span className="min-w-0">
                      <span className="font-mono tracking-[0.2em] text-neutral-200">{g.code}</span>
                      <span className="ml-2 truncate text-xs text-neutral-500">
                        {g.host ? `${g.host}'s game` : "waiting room"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {mapName(g.map)} · {g.players}
                      {g.maxPlayers ? ` / ${g.maxPlayers}` : ""}
                      {g.started ? " · in play" : g.starting ? " · starting" : ""}
                    </span>
                  </button>
                ))}

                {games.length === 0 && (
                  <p className="px-1 pt-1 text-xs text-neutral-600">No public games right now.</p>
                )}
              </div>
            </section>
          </div>
          </div>
        </div>

        {!ready && <p className="text-xs text-neutral-600">Looking for the game server…</p>}

        {creating && ready && (
          <CreateGamePanel
            onCancel={() => setCreating(false)}
            onCreate={(map, listed, maxPlayers) => {
              setCreating(false);
              onCreate(takeName(), map, listed, maxPlayers);
            }}
          />
        )}
        </div>
      </div>

      <Footer onLegal={() => setLegal(true)} />
    </div>
  );
}
