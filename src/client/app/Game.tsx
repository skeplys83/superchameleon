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
import { HuntVision, Vignette } from "@/client/hud/HuntVision";
import { RoundOverPanel } from "@/client/hud/RoundOverPanel";
import { DebugPanel } from "@/client/hud/DebugPanel";
import { PoseWheel } from "@/client/hud/PoseWheel";
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
import { currentPose, requestPose } from "@/client/players/poseRequest";
import { controlMap } from "@/client/players/controls";
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

const WALK_KEYS = new Set(
  controlMap
    .filter(({ name }) => ["forward", "backward", "left", "right"].includes(name))
    .flatMap(({ keys }) => keys ?? []),
);

export function Game() {
  const [joined, setJoined] = useState(false);
  const [brush, setBrush] = useState<Brush>(DEFAULT_BRUSH);
  const [pickArmed, setPickArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("player");
  const [dropped, setDropped] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  // Pose wheel is up. Not one of usePauseControl's overlays — it keeps the
  // lock because it is steered by raw pointer movement.
  const [posing, setPosing] = useState(false);

  const role: Role = room?.role ?? "chameleon";
  const rooted = room?.phase === "reveal" && role === "chameleon";
  const loading = useLoading();
  const isMobile = useIsMobileOrTablet();

  const { adBreak, requestAd } = useGameDistribution();

  const {
    paused,
    painting,
    chatting,
    paintingRef,
    resume,
    setPaintOpen,
    setChatOpen,
    closeOverlays,
  } = usePauseControl({ joined, dropped, adBreak });

  const canChat =
    room?.mode === "lobby" &&
    !dropped &&
    (room.phase === "waiting" || room.phase === "countdown");

  const canPaint = !paused && !dropped && !rooted && role === "chameleon";
  // Derived so an armed pick cannot outlive the mode.
  const picking = pickArmed && canPaint && painting;
  const canPose =
    joined && role === "chameleon" && !paused && !painting && !chatting && !dropped && !rooted;

  const graves = useRoomGraves();
  // Subscribed here — the backlog is replayed during the join.
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
      // Runs from a click — the audio context's required user gesture.
      unlockAudio();
      void preloadCharacter();
      forgetAllSkins();
      setBrush(DEFAULT_BRUSH);
      setPickArmed(false);
      setError(null);
      setName(who);
      setJoined(true);
      // Clear stale room so we do not render the old map/role during the round-trip.
      setRoom(null);
      closeOverlays();
      setDropped(false);
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

  const quickPlay = useDevQuickPlay(room);

  // Pre-roll ads only from user clicks — auto-joins would fail the SDK's rule.
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

  // T opens chat. preventDefault so the T does not also enter the input.
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

  // F is paint mode (a toggle — mixing takes both hands).
  useEffect(() => {
    if (!canPaint || chatting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      setPaintOpen(!paintingRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPaint, chatting, setPaintOpen, paintingRef]);

  // G arms the eyedropper inside paint mode.
  useEffect(() => {
    if (!canPaint || !painting || chatting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyG" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      setPickArmed((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPaint, painting, chatting]);

  // Walking leaves paint mode — on keydown, before the body moves.
  useEffect(() => {
    if (!painting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!WALK_KEYS.has(e.code)) return;
      setPaintOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [painting, setPaintOpen]);

  useEffect(() => {
    if (!canChat && chatting) setChatOpen(false);
  }, [canChat, chatting, setChatOpen]);

  const leave = useCallback(() => {
    // Mid-roll on a click, outside gameplay.
    requestAd();
    cancelLock();
    stopAllLoops();
    void disconnect();
    setJoined(false);
    setRoom(null);
    closeOverlays();
    setDropped(false);
  }, [closeOverlays, requestAd]);

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

  return (
    <div className="relative h-dvh w-full">
      <Scene
        map={room?.map ?? DEFAULT_MAP}
        nextMap={room?.nextMap}
        // Keyed on code — crossing lobby↔match rebuilds the player at spawn.
        room={room?.code ?? ""}
        role={room ? role : null}
        reveal={room?.phase === "reveal"}
        hunting={room?.phase === "hunt"}
        frozen={rooted}
        graves={graves}
        painting={painting}
        paused={paused || dropped || chatting || adBreak || posing}
        brush={brush}
        onBrush={setBrush}
        picking={picking}
        onPicked={(hex) => {
          setBrush((b) => ({ ...b, color: hex }));
          setPickArmed(false);
        }}
      />
      {/* Same condition Scene blurs on — the two must not disagree. */}
      {role === "hunter" &&
        (room?.phase === "hunt" || room?.phase === "reveal") && <HuntVision />}
      {role === "chameleon" &&
        (room?.phase === "hiding" || room?.phase === "hunt" || room?.phase === "reveal") && (
          <Vignette />
        )}
      {joined ? (
        <>
          {role === "chameleon" && !paused && !dropped && (
            <ControlsPanel painting={painting} />
          )}
          {/* Roles are secret until the draw. */}
          <PlayerList
            name={name}
            role={role}
            showRoles={
              room
                ? room.phase !== "waiting" && room.phase !== "countdown"
                : false
            }
          />
          {/* One top-centre column so the panel and the banner do not overlap. */}
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
          <PoseWheel
            enabled={canPose}
            current={currentPose}
            onOpenChange={setPosing}
            onPick={requestPose}
          />
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
              <div className="mt-0.5 text-[0.6875rem] text-rose-300/80">
                You are a hunter now — go and find the rest.
              </div>
            </div>
          )}
          {error && (
            <div className="absolute bottom-32 left-1/2 max-w-lg -translate-x-1/2 rounded-md border border-amber-600/60 bg-amber-950/80 px-4 py-2 text-center text-xs text-amber-200">
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
      {DEV && joined && (
        <DebugPanel map={room?.map ?? DEFAULT_MAP} phase={room?.phase ?? "—"} />
      )}
      {loading && <LoadingScreen />}
    </div>
  );
}
