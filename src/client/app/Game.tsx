import { useCallback, useEffect, useState } from "react";
import { StartMenu } from "@/client/hud/StartMenu";
import { ControlsPanel } from "@/client/hud/ControlsPanel";
import { PlayerList } from "@/client/hud/PlayerList";
import { PauseMenu } from "@/client/hud/PauseMenu";
import { PaintPanel } from "@/client/paint/PaintPanel";
import { DEFAULT_BRUSH, type Brush } from "@/client/paint/brush";
import { DEFAULT_MAP } from "@/shared/mapIds";
import { preloadCharacter } from "@/client/figure/model";
import { LoadingScreen } from "@/client/hud/LoadingScreen";
import {
  MobileUnsupported,
  useIsMobileOrTablet,
} from "@/client/hud/MobileUnsupported";
import { beginLoading, useLoading } from "@/client/app/loading";
import { LobbyPanel } from "@/client/hud/LobbyPanel";
import { ChatPanel } from "@/client/hud/ChatPanel";
import { HunterWait } from "@/client/hud/HunterWait";
import { DroppedPanel } from "@/client/hud/DroppedPanel";
import { PhaseBanner } from "@/client/hud/PhaseBanner";
import { HuntVision } from "@/client/hud/HuntVision";
import { RoundOverPanel } from "@/client/hud/RoundOverPanel";
import { DebugPanel } from "@/client/hud/DebugPanel";
import { DEV } from "@/client/app/dev";
import {
  createLobby,
  disconnect,
  joinLobby,
  rejoin,
  sendClearSkin,
  type RoomInfo,
} from "@/client/net";
import { clearSkin, forgetAllSkins, SELF } from "@/client/paint/skin";
import { cancelLock } from "@/client/players/pointerLock";
import { stopAllLoops, unlockAudio } from "@/client/sound/engine";
import type { Role } from "@/shared/protocol";
import {
  useAudioUnlockOnGesture,
  useCaughtNotice,
  useCrazyGames,
  useDevHotkey,
  useDevQuickPlay,
  useGameDistribution,
  useNetEvents,
  usePauseControl,
  useRoomChat,
  useRoomGraves,
  useRoundAssets,
  useRoundAudio,
  useWhistle,
} from "./session";

import Scene from "./Scene";

export function Game() {
  /** Whether this client is in a game at all. Not the same question as which
   *  side it is on, which only the room can answer. */
  const [joined, setJoined] = useState(false);
  const [brush, setBrush] = useState<Brush>(DEFAULT_BRUSH);
  /** The eyedropper has been armed: the next click in the world takes its
   *  colour. Whether it *is* armed is `picking` below — the palette going away
   *  disarms it, and deriving that rather than clearing it from an effect is
   *  what stops an armed pick outliving the panel and swallowing a click. */
  const [pickArmed, setPickArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("player");
  /** The connection died on its own. Distinct from every deliberate exit, and
   *  the only state where the game on screen is not connected to anything. */
  const [dropped, setDropped] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);

  /** Which side you are on, read off the room rather than chosen. */
  const role: Role = room?.role ?? "chameleon";
  /** Rooted where you are, camera free. */
  const rooted = room?.phase === "reveal" && role === "chameleon";
  const loading = useLoading();
  const isMobile = useIsMobileOrTablet();

  /** An ad has the screen, and the handle the two placements hang on. */
  const { adBreak, requestAd } = useGameDistribution();

  const {
    paused,
    painting,
    chatting,
    pausedRef,
    paintingRef,
    resume,
    setPaintOpen,
    setChatOpen,
    closeOverlays,
  } = usePauseControl({ joined, role, dropped, adBreak });

  /** Chat is a waiting-room thing, in the two phases where nobody has a side
   *  yet — the same window the server accepts a `chat` message in. During
   *  `hiding` the lobby holds the drawn hunter alone, with nobody to talk to. */
  const canChat =
    room?.mode === "lobby" &&
    !dropped &&
    (room.phase === "waiting" || room.phase === "countdown");

  /** Whether the palette is on screen at all — a hunter has nothing to
   *  camouflage, and the exhibit is not repainted. The eyedropper and its F key
   *  live and die with it. */
  const canPaint = !paused && !dropped && !rooted && role === "chameleon";
  /** The eyedropper is armed *and* still has a palette to belong to. */
  const picking = pickArmed && canPaint;

  const graves = useRoomGraves();
  // Subscribed here rather than in the panel: the backlog is replayed during
  // the join, long before anything conditional on `room` has mounted.
  const messages = useRoomChat();
  const { caughtBy } = useCaughtNotice(joined, () => setPaintOpen(false));

  useNetEvents({ setRoom, setDropped, setError, closeOverlays });
  useRoundAssets(room);
  useRoundAudio(room?.phase, room?.timeLeft ?? 0);
  useAudioUnlockOnGesture();
  useWhistle(joined, role, dropped);
  useDevHotkey();

  const enter = useCallback(
    (who: string, go: () => Promise<RoomInfo>, what: string) => {
      // This runs from a button's click handler, which is the user gesture the
      // audio context has been waiting for. Unlocking anywhere else — an effect,
      // a timer — is silently refused and the whole game stays mute.
      unlockAudio();
      // The body everyone wears, 124 KB. Nothing renders a figure before this
      // click, and `StickFigure` draws nothing until it lands rather than
      // suspending — suspending there would tear down the collider it sits in.
      void preloadCharacter();
      // Joining is a clean slate.
      forgetAllSkins();
      setBrush(DEFAULT_BRUSH);
      setPickArmed(false);
      setError(null);
      setName(who);
      setJoined(true);
      // Nothing about the room we are leaving is true of the one we are opening,
      // and a stale `map` or `role` would be rendered for the round trip.
      setRoom(null);
      closeOverlays();
      setDropped(false);
      // Connecting is the other thing worth waiting on, and until now it showed
      // nothing: `joined` flips instantly, `room` arrives a few hundred ms later,
      // and in between the menu is gone and the world is an empty arena nobody
      // is in yet. It ends on the room *or* on the error — never left hanging.
      const arrived = beginLoading();
      go()
        .then((info) => {
          setRoom(info);
          sendClearSkin();
        })
        .catch((e: unknown) => {
          setError(`Could not ${what}. ${e instanceof Error ? e.message : ""}`);
        })
        .finally(arrived);
    },
    [closeOverlays],
  );

  const create = useCallback(
    (who: string, wanted: string, listed: boolean, maxPlayers: number) =>
      enter(
        who,
        () => createLobby(who, wanted, listed, maxPlayers),
        "open a game",
      ),
    [enter],
  );

  const joinCode = useCallback(
    (who: string, code: string) =>
      enter(who, () => joinLobby(who, code), `join ${code}`),
    [enter],
  );

  useCrazyGames({ joined, room, name, create, joinCode });

  // Dev builds only, and dropped from the production bundle with `DEV`.
  const quickPlay = useDevQuickPlay(room);

  // Pre-roll, on the two buttons that actually start a game. Wrapped rather
  // than put inside `create`/`joinCode` themselves: those are also called by
  // the `?code=` auto-join above, which is a page load rather than a click —
  // an ad there breaks their "user input only" rule and a browser would refuse
  // to autoplay it regardless. `reconnect` is exempt for the same reason.
  const createFromMenu = useCallback(
    (who: string, wanted: string, listed: boolean, maxPlayers: number) => {
      requestAd();
      create(who, wanted, listed, maxPlayers);
    },
    [create, requestAd],
  );

  const joinFromMenu = useCallback(
    (who: string, code: string) => {
      requestAd();
      joinCode(who, code);
    },
    [joinCode, requestAd],
  );

  // T opens the chat box. `preventDefault` because otherwise the same keypress
  // types its own "t" into the input it just opened; `KeyT` is free in
  // `players/controls.ts`, where turning is Q and E.
  //
  // Deliberately *not* gated on `paused` or `painting`: the prompt under the
  // log is on screen for as long as the lobby is, so the key it names has to
  // work whenever it is legible. `setChatOpen` already shuts both of them, and
  // neither has a text field to steal the keystroke from — the palette's two
  // inputs are sliders.
  useEffect(() => {
    if (!canChat || chatting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyT" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setChatOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canChat, chatting, setChatOpen]);

  // F arms and disarms the eyedropper. It is the one paint control worth a key:
  // the click it waits for lands in the world, so reaching back to the panel to
  // arm it means looking away from the surface you wanted. `KeyF` is free in
  // `players/controls.ts`.
  //
  // Not gated on the palette being open — minimised, the button is a colour
  // swatch and the crosshair plus the cursor swatch are the whole interface.
  useEffect(() => {
    if (!canPaint || chatting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      setPickArmed((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPaint, chatting]);

  // The box cannot outlive the window it belongs to: the countdown ending is
  // what closes it for everybody, rather than each client noticing separately.
  useEffect(() => {
    if (!canChat && chatting) setChatOpen(false);
  }, [canChat, chatting, setChatOpen]);

  // Opening the palette clears `paused`, so a hover arriving while the menu is
  // up would dismiss it. Player already stops reporting hovers when paused;
  // this is the second lock on the same door.
  const onHoverBody = useCallback(
    (hovering: boolean) => {
      if (pausedRef.current) return;
      if (hovering && !paintingRef.current) setPaintOpen(true);
    },
    [setPaintOpen, pausedRef, paintingRef],
  );

  const leave = useCallback(() => {
    // Mid-roll. A click, and squarely outside gameplay — this is the player
    // walking out of the round.
    requestAd();
    cancelLock();
    stopAllLoops();
    void disconnect();
    setJoined(false);
    setRoom(null);
    closeOverlays();
    setDropped(false);
  }, [closeOverlays, requestAd]);

  // Back into the seat the server is still holding, if it still is — and a plain
  // re-join of the same room if it is not.
  const reconnect = useCallback(() => {
    if (!room) return;
    const { code } = room;
    enter(name, () => rejoin(name, code), "reconnect");
  }, [enter, name, room]);

  useEffect(() => {
    return () => {
      stopAllLoops();
      void disconnect();
    };
  }, []);

  if (isMobile) {
    return <MobileUnsupported />;
  }

  // The Canvas stays mounted and the menu sits over it, so creating or joining a
  // game drops you straight into the room instead of swapping out the whole tree.
  return (
    <div className="relative h-dvh w-full">
      <Scene
        map={room?.map ?? DEFAULT_MAP}
        // The player is keyed on this, so crossing between a lobby and its
        // match rebuilds them at the spawn point rather than carrying the pose
        // and position of the game that just ended.
        room={room?.code ?? ""}
        role={room ? role : null}
        reveal={room?.phase === "reveal"}
        hunting={room?.phase === "hunt"}
        // The survivors are the exhibit, so they hold their spot while everyone
        // else walks over to look at it. They keep their camera.
        frozen={rooted}
        graves={graves}
        painting={painting}
        // A dropped player's input goes nowhere. The reveal is *not* in here:
        // the round is decided but everyone keeps walking, which is how you go
        // and look at the spot that beat you.
        paused={paused || dropped || chatting || adBreak}
        brush={brush}
        onBrush={setBrush}
        picking={picking}
        onPicked={(hex) => {
          setBrush((b) => ({ ...b, color: hex }));
          setPickArmed(false);
        }}
        onHoverBody={onHoverBody}
      />
      {/* Over the world and under every panel, and on exactly the condition
          `Scene` blurs for: everyone in a lobby is nominally a hunter, so the
          role alone would grain the waiting room. */}
      {role === "hunter" && room?.phase === "hunt" && <HuntVision />}
      {joined ? (
        <>
          {/* Chameleons only. A hunter walks and shoots, which no legend has
              to say — and everyone waiting in a lobby is nominally one, so the
              panel appears when the draw hands you a side that has something
              to learn. */}
          {role === "chameleon" && <ControlsPanel />}
          {/* Sides are secret until they exist. Everyone waiting in a lobby is
              nominally a hunter — that is what `onJoin` sets — so labelling the
              rows before the draw would print "hunter" beside every name and
              read as a spoiler of something that has not happened. */}
          <PlayerList
            name={name}
            role={role}
            showRoles={
              room
                ? room.phase !== "waiting" && room.phase !== "countdown"
                : false
            }
          />
          {/* One top-centre column, because the hunter waits out the hiding
              phase in the lobby and both of these would otherwise be pinned to
              the same spot — which is how the clock ended up behind the panel.
              Stacking them means the gap is laid out rather than guessed at,
              and the banner still sits at the top when there is no panel. */}
          <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-3">
            {room?.mode === "lobby" && !dropped && room.phase === "hiding" && (
              <HunterWait />
            )}
            {room?.mode === "lobby" && !dropped && room.phase !== "hiding" && (
              <LobbyPanel
                code={room.code}
                nextMap={room.nextMap}
                isHost={room.isHost}
                isListed={room.isListed}
                phase={room.phase}
                timeLeft={room.timeLeft}
                players={room.playerCount}
                maxPlayers={room.maxPlayers}
              />
            )}
            {room && !dropped && room.phase !== "reveal" && (
              <PhaseBanner
                phase={room.phase}
                seconds={room.timeLeft}
                role={role}
              />
            )}
          </div>
          {/* A hunter has nothing to camouflage, and the server wipes their
              paint the moment they are caught — so the palette belongs to
              chameleons and to the waiting room, where everybody is still one
              button press from being either. */}
          {canPaint && (
            <PaintPanel
              open={painting}
              onOpenChange={setPaintOpen}
              brush={brush}
              onBrush={setBrush}
              picking={picking}
              onPickingChange={setPickArmed}
              onClear={() => {
                clearSkin(SELF);
                sendClearSkin();
              }}
            />
          )}
          {role === "hunter" && !paused && !painting && !dropped && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70" />
          )}
          {paused && !painting && !dropped && (
            <PauseMenu
              sessionName={room?.code ? `Game ${room.code}` : "Super Chameleon"}
              onResume={resume}
              onLeave={leave}
            />
          )}
          {canChat && (
            <ChatPanel
              open={chatting}
              onOpenChange={setChatOpen}
              messages={messages}
            />
          )}
          {dropped && <DroppedPanel onReconnect={reconnect} onExit={leave} />}
          {/* The round is decided. Everything above is still rendered behind
              this — the world, the bodies, the graves — because seeing where
              people were is the whole point of the thirty seconds. */}
          {room?.phase === "reveal" && !dropped && (
            <RoundOverPanel
              winner={room.winner}
              role={role}
              seconds={room.timeLeft}
              graves={graves}
            />
          )}
          {caughtBy && room?.phase !== "reveal" && (
            <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-lg border border-rose-500/60 bg-rose-950/85 px-5 py-3 text-center">
              <div className="text-sm font-semibold tracking-wide text-rose-200">
                Caught by {caughtBy}
              </div>
              <div className="mt-0.5 text-[11px] text-rose-300/80">
                You are a hunter now — go and find the rest.
              </div>
            </div>
          )}
          {error && (
            <div className="absolute bottom-4 left-1/2 max-w-lg -translate-x-1/2 rounded-md border border-amber-600/60 bg-amber-950/80 px-4 py-2 text-center text-xs text-amber-200">
              {error}
            </div>
          )}
        </>
      ) : (
        <StartMenu
          onCreate={createFromMenu}
          onJoinCode={joinFromMenu}
          onQuickPlay={(who) =>
            quickPlay((map, listed, maxPlayers) =>
              create(who, map, listed, maxPlayers),
            )
          }
        />
      )}
      {/* Last, and over everything including the menu, because it is the one
          overlay that is not about the game: while it is up there is no floor
          under the player and nothing behind it worth seeing. It cannot appear
          on the start menu — the arena downloads nothing and never suspends. */}
      {/* Developer mode only, and compiled out of the build — see
          `app/dev.ts`. Over the panels, because it is scaffolding rather
          than part of the game, and pinned to the one corner nothing else uses.
          Mounted whether or not the mode is *on*: the chip inside it is the
          toggle, and a switch that vanishes when you use it is a trap. */}
      {DEV && joined && (
        <DebugPanel map={room?.map ?? DEFAULT_MAP} phase={room?.phase ?? "—"} />
      )}
      {loading && <LoadingScreen />}
    </div>
  );
}
