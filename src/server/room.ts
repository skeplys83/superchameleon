import { randomUUID } from "node:crypto";
import { matchMaker, Room, type Client } from "colyseus";
import { GameState, Player } from "./schema.ts";
import { cleanName } from "./clean.ts";
import {
  DEFAULT_MATCH_MAP,
  LOBBY_MAP,
  MATCH_MAP_IDS,
} from "../shared/mapIds.ts";
import { mapRoundSeconds } from "../shared/maps.ts";
import { freeRoomCode } from "./code.ts";
import { HostRule } from "./host.ts";
import { clamp, registerMessages } from "./messages.ts";
import { setSessionName } from "./session.ts";
import {
  MESSAGES,
  COUNTDOWN_SECONDS,
  HIDE_SECONDS,
  LEAVE_IN_PROGRESS,
  LEAVE_STARTING,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REVEAL_SECONDS,
  CLING_NONE,
} from "../shared/protocol.ts";

const PATCH_MS = 50;
const SWEEP_MS = 15_000;
const RECONNECT_SECONDS = 20;

type RoomCache = Awaited<ReturnType<typeof matchMaker.createRoom>>;

type Reconnection = { reject(): void };

export class GameRoom extends Room<GameState> {
  private matchId: string | null = null;
  // Start is async and a button — two presses would open two matches.
  private starting = false;
  private ending = false;
  private pass = "";
  /** @internal Read by `messages.ts`. */
  pendingReturn = new Map<string, Reconnection>();
  private hosts = new HostRule();
  private forgetFire: (sessionId: string) => void = () => {};
  private counting: ReturnType<GameRoom["clock"]["setInterval"]> | null = null;
  // Lobby's own clock: hiding mirror while its match runs, and the round-over
  // card if the match ends before the hunter was sent in.
  private lobbyClock: ReturnType<GameRoom["clock"]["setInterval"]> | null = null;
  private hunterId = "";
  private roundPass = "";
  private huntSeconds = 0;

  // @internal Read by `messages.ts`.
  get isLobby() {
    return this.roomName !== "match";
  }

  private reassignHost() {
    if (!this.isLobby) return;
    const here = this.clients
      .map((c) => ({ sessionId: c.sessionId, pid: this.hosts.pidFor(c.sessionId) }))
      .filter((c) => this.state.players.has(c.sessionId));
    this.state.hostId = this.hosts.resolve(here, this.matchId !== null);
  }

  matchEnded(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.matchId = null;
    this.hosts.beginGrace();
    this.publish();
  }

  private publish() {
    if (!this.isLobby) return;
    this.setMetadata({
      host: this.state.players.get(this.state.hostId)?.name ?? "",
      map: this.state.nextMap,
      started: this.matchId !== null,
      // Counting down = closed to strangers (see onJoin).
      starting: this.counting !== null,
      matchId: this.matchId ?? "",
      maxPlayers: this.state.maxPlayers,
    });
  }

  async onCreate(options?: {
    map?: string;
    listed?: boolean;
    lobby?: string;
    pass?: string;
    pid?: string;
    maxPlayers?: number;
  }) {
    this.setState(new GameState());
    this.setPatchRate(PATCH_MS);

    const cap = clamp(Math.trunc(Number(options?.maxPlayers)), MIN_PLAYERS, MAX_PLAYERS);
    this.maxClients = cap || MAX_PLAYERS;
    this.state.maxPlayers = this.maxClients;

    const wanted =
      typeof options?.map === "string" && MATCH_MAP_IDS.includes(options.map as never)
        ? options.map
        : DEFAULT_MATCH_MAP;

    if (this.isLobby) {
      this.state.mode = "lobby";
      this.state.phase = "waiting";
      this.state.map = LOBBY_MAP;
      this.state.nextMap = wanted;
      // roomId setter throws at any later point in the room's life.
      this.roomId = await freeRoomCode();
      // A lobby outlives its own emptiness on purpose.
      this.autoDispose = false;
      this.clock.setInterval(() => void this.sweep(), SWEEP_MS);
      this.state.listed = options?.listed !== false;
      this.setPrivate(!this.state.listed);
      this.state.lobby = this.roomId;
      // Written explicitly — an unset number encodes as absent, and the client
      // would read undefined where it expects "no clock is running".
      this.state.timeLeft = 0;
      // Written here rather than in onJoin: by then a returning player is
      // indistinguishable from a latecomer.
      this.hosts.claim(String(options?.pid ?? ""));
      this.publish();
    } else {
      this.state.mode = "match";
      this.state.phase = "hiding";
      this.state.map = wanted;
      // Hiding is carved out of roundSeconds, not added to it.
      this.huntSeconds = mapRoundSeconds(wanted) - HIDE_SECONDS;
      this.state.nextMap = wanted;
      this.state.lobby = String(options?.lobby ?? "");
      this.pass = String(options?.pass ?? "");
      // Reached by being moved into it, never by being found.
      this.setPrivate(true);

      this.state.timeLeft = HIDE_SECONDS;
      this.clock.setInterval(() => {
        if (this.state.timeLeft <= 0) return;
        this.state.timeLeft -= 1;
        if (this.state.timeLeft > 0) return;

        if (this.state.phase === "hiding") {
          this.state.phase = "hunt";
          this.state.timeLeft = Math.max(1, this.huntSeconds);
          void this.callLobby("sendHunter", this.roomId);
        } else if (this.state.phase === "hunt") {
          this.finish("chameleons");
        } else if (this.state.phase === "reveal") {
          void this.goHome();
        }
      }, 1000);
    }

    this.onMessage(MESSAGES.toServer.start, (client: Client) => {
      if (!this.isLobby || client.sessionId !== this.state.hostId) return;
      this.beginCountdown();
    });

    // setMap refused during countdown — everyone is preloading.
    this.onMessage(MESSAGES.toServer.setMap, (client: Client, msg: { map?: unknown }) => {
      if (!this.isLobby || client.sessionId !== this.state.hostId) return;
      if (this.starting || this.state.phase !== "waiting") return;
      const map = String(msg?.map ?? "");
      if (!MATCH_MAP_IDS.includes(map as never)) return;
      this.state.nextMap = map;
      this.publish();
    });

    this.forgetFire = registerMessages(this).forget;
  }

  private get canStart() {
    return this.isLobby && !this.matchId && !this.starting && this.state.players.size >= MIN_PLAYERS;
  }

  private beginCountdown() {
    if (this.counting || !this.canStart) return;
    this.state.phase = "countdown";
    this.state.timeLeft = COUNTDOWN_SECONDS;
    this.publish();

    this.counting = this.clock.setInterval(() => {
      if (this.state.players.size < MIN_PLAYERS) {
        this.cancelCountdown();
        return;
      }
      this.state.timeLeft -= 1;
      if (this.state.timeLeft > 0) return;
      this.cancelCountdown();
      void this.start();
    }, 1000);
  }

  private cancelCountdown() {
    this.counting?.clear();
    this.counting = null;
    if (!this.isLobby) return;
    this.state.phase = "waiting";
    this.state.timeLeft = 0;
    this.publish();
  }

  private async start() {
    // matchId check: an empty lobby-with-match lets a joiner become host and
    // open a second match, orphaning the first.
    if (!this.isLobby || this.starting || this.matchId) return;
    this.starting = true;
    try {
      // Pass is known only to this pair of rooms, kept because the hunter's
      // seat is reserved a whole hiding phase later.
      this.roundPass = randomUUID();
      const match = await matchMaker.createRoom("match", {
        map: this.state.nextMap,
        lobby: this.roomId,
        pass: this.roundPass,
        maxPlayers: this.state.maxPlayers,
      });
      this.matchId = match.roomId;

      const going = this.clients.filter((c) => this.state.players.has(c.sessionId));
      this.hunterId = going.length
        ? going[Math.floor(Math.random() * going.length)].sessionId
        : "";

      // Only the chameleons make the trip.
      await Promise.all(
        going
          .filter((client) => client.sessionId !== this.hunterId)
          .map((client) =>
            this.handOver(client, match, {
              name: this.state.players.get(client.sessionId)?.name ?? "player",
              role: "chameleon",
              pass: this.roundPass,
              // Without pid the host returns as a stranger and the button moves.
              pid: this.hosts.pidFor(client.sessionId),
            }),
          ),
      );

      // Display mirror: the hunter is standing here.
      this.state.phase = "hiding";
      this.state.timeLeft = HIDE_SECONDS;
      this.lobbyClock = this.clock.setInterval(() => {
        if (this.state.timeLeft > 0) this.state.timeLeft -= 1;
      }, 1000);
      this.publish();
    } catch (e) {
      this.broadcast(MESSAGES.toClient.moveFailed, {
        reason: e instanceof Error ? e.message : "could not open the match",
      });
    } finally {
      this.starting = false;
    }
  }

  async sendHunter(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.lobbyClock?.clear();
    this.lobbyClock = null;

    const [match] = await matchMaker.query({ roomId: id });
    const hunter = this.clients.find((c) => c.sessionId === this.hunterId);
    this.hunterId = "";
    if (!match || !hunter) {
      // No hunter to send: the round runs on without one and the chameleons win.
      this.state.phase = "waiting";
      this.state.timeLeft = 0;
      this.publish();
      return;
    }

    await this.handOver(hunter, match, {
      name: this.state.players.get(hunter.sessionId)?.name ?? "player",
      role: "hunter",
      pass: this.roundPass,
      pid: this.hosts.pidFor(hunter.sessionId),
    });

    this.state.phase = "waiting";
    this.state.timeLeft = 0;
    this.publish();
  }

  // Public so matchMaker.remoteRoomCall can reach it. The reveal happens in
  // the lobby because the hunter never went to the match.
  async roundAborted(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.lobbyClock?.clear();
    this.lobbyClock = null;
    this.hunterId = "";
    this.matchId = null;
    this.hosts.beginGrace();

    this.state.winner = "hunters";
    this.state.phase = "reveal";
    this.state.timeLeft = REVEAL_SECONDS;
    this.lobbyClock = this.clock.setInterval(() => {
      if (this.state.timeLeft > 0) this.state.timeLeft -= 1;
      if (this.state.timeLeft > 0) return;
      this.lobbyClock?.clear();
      this.lobbyClock = null;
      this.state.winner = "";
      this.state.phase = "waiting";
      this.publish();
    }, 1000);
    this.publish();
  }

  private async callLobby(method: string, ...args: unknown[]) {
    if (this.isLobby) return;
    const [lobby] = await matchMaker.query({ roomId: this.state.lobby });
    if (!lobby) return;
    await matchMaker.remoteRoomCall(lobby.roomId, method, args).catch(() => {
      // The sweep is the backstop.
    });
  }

  // @internal Read by `messages.ts`.
  get chameleonsLeft() {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.role === "chameleon") n += 1;
    });
    return n;
  }

  private get huntersLeft() {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.role === "hunter") n += 1;
    });
    return n;
  }

  /** @internal Called by `messages.ts` when the last chameleon is caught. */
  finish(winner: "chameleons" | "hunters") {
    if (this.isLobby || this.ending) return;
    this.ending = true;

    for (const pending of this.pendingReturn.values()) pending.reject();
    this.pendingReturn.clear();

    this.state.winner = winner;
    this.state.phase = "reveal";
    this.state.timeLeft = REVEAL_SECONDS;
  }

  private async goHome() {
    if (this.isLobby) return;

    const [lobby] = await matchMaker.query({ roomId: this.state.lobby });
    if (!lobby) {
      this.broadcast(MESSAGES.toClient.moveFailed, { reason: "the waiting room is gone" });
      return;
    }

    // Told rather than discovered: the sweep is too slow — a Start button that
    // does nothing.
    await this.callLobby("matchEnded", this.roomId);

    await Promise.all(
      this.clients.map((client) =>
        this.handOver(client, lobby, {
          name: this.state.players.get(client.sessionId)?.name ?? "player",
          pid: this.hosts.pidFor(client.sessionId),
        }),
      ),
    );
  }

  private async handOver(client: Client, to: RoomCache, options: Record<string, string>) {
    try {
      const seat = await matchMaker.reserveSeatFor(to, options);
      client.send(MESSAGES.toClient.moveTo, {
        sessionId: seat.sessionId,
        room: {
          roomId: to.roomId,
          name: to.name,
          publicAddress: to.publicAddress,
          clients: to.clients,
          maxClients: to.maxClients,
        },
      });
    } catch (e) {
      client.send(MESSAGES.toClient.moveFailed, { reason: e instanceof Error ? e.message : "no seat" });
    }
  }

  private async sweep() {
    if (!this.isLobby) return;
    if (this.matchId && (await matchMaker.query({ roomId: this.matchId })).length === 0) {
      this.matchId = null;
      this.publish();
    }
    this.reassignHost();
    this.publish();

    if (this.clients.length === 0 && !this.matchId) this.disconnect();
  }

  onJoin(
    client: Client,
    options?: { name?: string; role?: string; pass?: string; pid?: string },
  ) {
    const pid = String(options?.pid ?? "");

    // A running round admits only people already in this game.
    if (this.isLobby && this.matchId && (!pid || !this.hosts.knows(pid))) {
      client.leave(LEAVE_IN_PROGRESS);
      return;
    }

    if (this.isLobby && this.counting && (!pid || !this.hosts.knows(pid))) {
      client.leave(LEAVE_STARTING);
      return;
    }

    this.hosts.seat(client.sessionId, pid);

    const player = new Player();
    // Trimmed first so a name cannot smuggle past the filter in characters that
    // were going to be cut off anyway.
    player.name = cleanName(String(options?.name ?? "player").slice(0, 16));
    // Nobody picks a side.
    const vouched = this.pass !== "" && options?.pass === this.pass;
    player.role = this.isLobby || (vouched && options?.role === "hunter") ? "hunter" : "chameleon";
    player.x = 0;
    player.y = 4;
    player.z = 0;
    player.yaw = 0;
    player.pitch = 0;
    player.pose = 0;
    player.cling = CLING_NONE;
    this.state.players.set(client.sessionId, player);

    // Never "claim the button if it looks vacant" — that hands it to anyone
    // wandering into an empty lobby mid-match.
    this.reassignHost();
    this.publish();

    if (this.state.players.size === 1 && !process.env.SESSION_NAME) {
      setSessionName(player.name);
    }

    if (this.isLobby && this.state.players.size >= this.state.maxPlayers) {
      this.beginCountdown();
    }
  }

  async onLeave(client: Client, consented?: boolean) {
    // A drop is not a departure.
    if (!this.isLobby && !consented && !this.ending && this.state.players.has(client.sessionId)) {
      const pending = this.allowReconnection(client, RECONNECT_SECONDS);
      this.pendingReturn.set(client.sessionId, pending as unknown as Reconnection);
      try {
        await pending;
        return;
      } catch {
        // Never came back, or was killed while away.
      } finally {
        this.pendingReturn.delete(client.sessionId);
      }
    }

    this.state.players.delete(client.sessionId);
    this.forgetFire(client.sessionId);
    // The seat is gone; the player is remembered in firstSeen.
    this.hosts.release(client.sessionId);

    // Cancel here as well as in the interval so the panel stops the moment
    // somebody leaves, not up to a second later.
    if (this.counting && this.state.players.size < MIN_PLAYERS) this.cancelCountdown();

    // A quit can end a round, and which side depends on the phase — see the
    // server CLAUDE.md's rule 3.
    if (!this.isLobby && this.state.phase === "hiding" && this.chameleonsLeft === 0) {
      this.finish("hunters");
      void this.callLobby("roundAborted", this.roomId);
    } else if (!this.isLobby && this.state.phase === "hunt") {
      if (this.chameleonsLeft === 0) this.finish("hunters");
      else if (this.huntersLeft === 0) this.finish("chameleons");
    }

    this.reassignHost();
    this.publish();
  }
}
