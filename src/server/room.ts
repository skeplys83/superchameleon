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

// ROOM_LIMIT, POSE_COUNT, MAX_STROKES and MAX_STROKE_LENGTH are imported above:
// the client reads the same definitions, and each used to exist here as a second
// copy with a comment asking the next person to change both.
const PATCH_MS = 50; // 20 Hz state patches
/** How often an empty lobby checks whether it still has a reason to exist. */
const SWEEP_MS = 15_000;
/** How long a dropped player's seat is held for them, in a match. */
const RECONNECT_SECONDS = 20;

/** A room directory entry, as `matchMaker` hands them back. */
type RoomCache = Awaited<ReturnType<typeof matchMaker.createRoom>>;

/** What `allowReconnection` hands back — a promise that can also be abandoned. */
type Reconnection = { reject(): void };

export class GameRoom extends Room<GameState> {
  /** The match this lobby started, if it has started one. Lobbies only. */
  private matchId: string | null = null;
  /** Start is async and Start is a button. Two presses would open two matches
   *  and send half the room to each. */
  private starting = false;
  /** True from the moment the clock runs out, so the trip home happens once. */
  private ending = false;
  /** The secret that makes a role trustworthy. */
  private pass = "";
  /** @internal Read by `messages.ts`, to let go of a caught player's seat. */
  pendingReturn = new Map<string, Reconnection>();
  /** The host rule, which is a whole thing of its own — see `host.ts`. */
  private hosts = new HostRule();
  /** Drops a departed client from the fire and whistle limiters. */
  private forgetFire: (sessionId: string) => void = () => {};
  /** The lobby's countdown, while one is running. */
  private counting: ReturnType<GameRoom["clock"]["setInterval"]> | null = null;
  /** The lobby's own clock: the hiding mirror while its match runs, and the
   *  round-over card if that match ends before the hunter was ever sent in. */
  private lobbyClock: ReturnType<GameRoom["clock"]["setInterval"]> | null = null;
  private hunterId = "";
  /** The pass minted for this round, kept so the hunter's later seat carries it. */
  private roundPass = "";
  /** The hunt's length, from the map, minus the hiding phase. Matches only. */
  private huntSeconds = 0;

  // @internal Read by `messages.ts`.
  get isLobby() {
    return this.roomName !== "match";
  }

  /** Decide who holds the Start button, and put their session id in state. */
  private reassignHost() {
    if (!this.isLobby) return;
    const here = this.clients
      .map((c) => ({ sessionId: c.sessionId, pid: this.hosts.pidFor(c.sessionId) }))
      .filter((c) => this.state.players.has(c.sessionId));
    this.state.hostId = this.hosts.resolve(here, this.matchId !== null);
  }

  /** Our match telling us it is over, over the matchmaker. */
  matchEnded(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.matchId = null;
    this.hosts.beginGrace();
    this.publish();
  }

  /** What the menu's listing reads off this lobby. */
  private publish() {
    if (!this.isLobby) return;
    this.setMetadata({
      host: this.state.players.get(this.state.hostId)?.name ?? "",
      map: this.state.nextMap,
      started: this.matchId !== null,
      /** Counting down, and therefore closed to strangers — see the gate in `onJoin`. */
      starting: this.counting !== null,
      matchId: this.matchId ?? "",
      // So the menu can show "4 / 8" rather than a bare count, and grey out a
      // game there is no room in.
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

    /** How many people this game holds. */
    const cap = clamp(Math.trunc(Number(options?.maxPlayers)), MIN_PLAYERS, MAX_PLAYERS);
    this.maxClients = cap || MAX_PLAYERS;
    this.state.maxPlayers = this.maxClients;

    // The lobby map is where lobbies wait, never a map a match runs on, so it is
    // refused here as well as absent from the picker.
    const wanted =
      typeof options?.map === "string" && MATCH_MAP_IDS.includes(options.map as never)
        ? options.map
        : DEFAULT_MATCH_MAP;

    if (this.isLobby) {
      this.state.mode = "lobby";
      this.state.phase = "waiting";
      // The waiting room is always the lobby map. It is somewhere to *be* while
      // people arrive, and the map you are about to play should still be a
      // surprise when you get there.
      this.state.map = LOBBY_MAP;
      this.state.nextMap = wanted;
      // The invite code is the room id, and `roomId` may only be replaced here —
      // the setter throws at any later point in the room's life.
      this.roomId = await freeRoomCode();
      // A lobby outlives its own emptiness on purpose.
      this.autoDispose = false;
      this.clock.setInterval(() => void this.sweep(), SWEEP_MS);
      // Listed unless the creator said otherwise, and only ever decided here.
      this.state.listed = options?.listed !== false;
      this.setPrivate(!this.state.listed);
      // A lobby is its own home. Everything downstream — a client leaving a
      // match, a match sending everyone back — reads this one field.
      this.state.lobby = this.roomId;
      // Written rather than left alone: an unset number is simply absent from
      // the encoded state, and the client would read `undefined` where it
      // expects "no clock is running".
      this.state.timeLeft = 0;
      // Whoever opened it holds the button, and keeps holding it for as long as
      // the room exists — through the match and back again. `onJoin` is too late
      // for this: by then a returning player is indistinguishable from a
      // latecomer, which is precisely the confusion this is here to end.
      this.hosts.claim(String(options?.pid ?? ""));
      this.publish();
    } else {
      this.state.mode = "match";
      // A round opens with everybody hiding and the hunter still in the lobby.
      this.state.phase = "hiding";
      this.state.map = wanted;
      // The map decides how long a round is; the hiding phase is carved out of
      // it rather than added to it, so "two minutes" means two minutes.
      this.huntSeconds = mapRoundSeconds(wanted) - HIDE_SECONDS;
      this.state.nextMap = wanted;
      this.state.lobby = String(options?.lobby ?? "");
      this.pass = String(options?.pass ?? "");
      // Reached by being moved into it, never by being found. `joinById` still
      // works, which is what a respawn uses.
      this.setPrivate(true);

      // The match clock, and the only thing that moves a round forward.
      this.state.timeLeft = HIDE_SECONDS;
      this.clock.setInterval(() => {
        if (this.state.timeLeft <= 0) return;
        this.state.timeLeft -= 1;
        if (this.state.timeLeft > 0) return;

        if (this.state.phase === "hiding") {
          // The bell. Everyone is told by the phase changing — see
          // `net/CLAUDE.md` — and the hunter is fetched from the lobby.
          this.state.phase = "hunt";
          this.state.timeLeft = Math.max(1, this.huntSeconds);
          void this.callLobby("sendHunter", this.roomId);
        } else if (this.state.phase === "hunt") {
          // Time ran out with somebody still free.
          this.finish("chameleons");
        } else if (this.state.phase === "reveal") {
          void this.goHome();
        }
      }, 1000);
    }

    // Only a host may start, and only a lobby has anything to start. Pressing it
    // does not open a match — it starts the countdown, which does.
    this.onMessage(MESSAGES.toServer.start, (client: Client) => {
      if (!this.isLobby || client.sessionId !== this.state.hostId) return;
      this.beginCountdown();
    });

    // The host may still change their mind while people are arriving. It only
    // moves `nextMap`: the lobby's own geometry never changes under anyone.
    //
    // **Not once the countdown is running.** Everyone is already being told
    // which map they are about to load — `app/` preloads it on the phase change
    // — so a switch at second four sends half the lobby to a map the other half
    // is not fetching. The picker greys out client-side too; this is the check
    // that actually holds.
    this.onMessage(MESSAGES.toServer.setMap, (client: Client, msg: { map?: unknown }) => {
      if (!this.isLobby || client.sessionId !== this.state.hostId) return;
      if (this.starting || this.state.phase !== "waiting") return;
      const map = String(msg?.map ?? "");
      if (!MATCH_MAP_IDS.includes(map as never)) return;
      this.state.nextMap = map;
      this.publish();
    });

    // Everything a client may say — movement, paint, the trigger, the whistle
    // — is wired up in `messages.ts`. See there for the trust model.
    this.forgetFire = registerMessages(this).forget;
  }

  /** Whether this lobby could begin a round right now. */
  private get canStart() {
    return this.isLobby && !this.matchId && !this.starting && this.state.players.size >= MIN_PLAYERS;
  }

  /** Start the ten seconds before a round. */
  private beginCountdown() {
    if (this.counting || !this.canStart) return;
    this.state.phase = "countdown";
    this.state.timeLeft = COUNTDOWN_SECONDS;
    this.publish();

    this.counting = this.clock.setInterval(() => {
      // Someone left and there is no longer a game to start. Back to waiting
      // rather than starting a round one person cannot play.
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

  /** Stop counting and go back to waiting. Safe to call when not counting. */
  private cancelCountdown() {
    this.counting?.clear();
    this.counting = null;
    if (!this.isLobby) return;
    this.state.phase = "waiting";
    this.state.timeLeft = 0;
    this.publish();
  }

  /** Take everyone in this lobby to a match. */
  private async start() {
    // A match already running is the third way this can be asked for wrongly,
    // after "not a lobby" and "asked twice". It used to be reachable: a lobby is
    // empty while its match runs, so anyone joining by the code became host and
    // could open a second match, orphaning the first.
    if (!this.isLobby || this.starting || this.matchId) return;
    this.starting = true;
    try {
      // The pass is minted here and known only to this pair of rooms. It is what
      // makes the roles below trustworthy on the other side, and it is kept
      // because the hunter's seat is reserved a whole hiding phase later.
      this.roundPass = randomUUID();
      const match = await matchMaker.createRoom("match", {
        map: this.state.nextMap,
        lobby: this.roomId,
        pass: this.roundPass,
        // The same cap, or a full lobby could arrive at a room that will not
        // take all of it.
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
              // Carried through so the match can hand it back on the way home.
              // Without it the host returns as a stranger and the button moves.
              pid: this.hosts.pidFor(client.sessionId),
            }),
          ),
      );

      // The lobby shows the hiding countdown too, because the hunter is standing
      // in it. Display only — see the note on `hiding`.
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

  /** The match ringing the bell: send the hunter in. */
  async sendHunter(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.lobbyClock?.clear();
    this.lobbyClock = null;

    const [match] = await matchMaker.query({ roomId: id });
    const hunter = this.clients.find((c) => c.sessionId === this.hunterId);
    this.hunterId = "";
    if (!match || !hunter) {
      // Nobody to send, or nowhere to send them. The round runs on without a
      // hunter and the chameleons win it, which is a strange game but not a
      // broken one.
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

    // The lobby stays in `hiding` until the hunter has been handed over.
    this.state.phase = "waiting";
    this.state.timeLeft = 0;
    this.publish();
  }

  /**
   * Our match ended before the hunter was ever sent in, because everybody who
   * was hiding left. Public for the same reason `matchEnded` is:
   * `matchMaker.remoteRoomCall` reaches it by name.
   *
   * The news has to arrive here rather than being shown in the match, because
   * the hunter never went to the match — they are standing in this lobby
   * watching a countdown that is now counting towards nothing.
   */
  async roundAborted(id: string) {
    if (!this.isLobby || this.matchId !== id) return;
    this.lobbyClock?.clear();
    this.lobbyClock = null;
    this.hunterId = "";
    this.matchId = null;
    this.hosts.beginGrace();

    // They won it: there was nobody left to find. The same reveal the client
    // already knows how to draw, in the room they never left.
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

  /** Reach the lobby that owns this match, by name. */
  private async callLobby(method: string, ...args: unknown[]) {
    if (this.isLobby) return;
    const [lobby] = await matchMaker.query({ roomId: this.state.lobby });
    if (!lobby) return;
    await matchMaker.remoteRoomCall(lobby.roomId, method, args).catch(() => {
      // The sweep is the backstop. Nothing here is worth failing a round for.
    });
  }

  // How many players are still hiding. Zero of them ends the round.
  // @internal Read by `messages.ts`.
  get chameleonsLeft() {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.role === "chameleon") n += 1;
    });
    return n;
  }

  /** How many are still hunting. Zero of them ends the round the other way. */
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

    // Anyone still away is not coming back to a round that is over.
    for (const pending of this.pendingReturn.values()) pending.reject();
    this.pendingReturn.clear();

    this.state.winner = winner;
    this.state.phase = "reveal";
    this.state.timeLeft = REVEAL_SECONDS;
  }

  /** The reveal is over: everybody goes back to the waiting room. */
  private async goHome() {
    if (this.isLobby) return;

    const [lobby] = await matchMaker.query({ roomId: this.state.lobby });
    if (!lobby) {
      // The lobby outlived its match by design, so this is the odd case: the
      // whole group left and the sweep closed it. Nothing to go back to.
      this.broadcast(MESSAGES.toClient.moveFailed, { reason: "the waiting room is gone" });
      return;
    }

    // Told rather than discovered: the lobby's own sweep would get there
    // eventually, but "eventually" is a Start button that does nothing.
    await this.callLobby("matchEnded", this.roomId);

    await Promise.all(
      this.clients.map((client) =>
        this.handOver(client, lobby, {
          name: this.state.players.get(client.sessionId)?.name ?? "player",
          // The other half of the round trip: this is what tells the lobby that
          // the player walking back in is the one who opened it.
          pid: this.hosts.pidFor(client.sessionId),
        }),
      ),
    );
  }

  /** Hold a seat for one client in another room and tell them where to go. */
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

  /** End a lobby that has nothing left to wait for. */
  private async sweep() {
    if (!this.isLobby) return;
    if (this.matchId && (await matchMaker.query({ roomId: this.matchId })).length === 0) {
      this.matchId = null;
      this.publish();
    }
    // The backstop for a host who never came back: once the grace window has
    // passed, this is where the button finally moves on.
    this.reassignHost();
    this.publish();

    if (this.clients.length === 0 && !this.matchId) this.disconnect();
  }

  onJoin(
    client: Client,
    options?: { name?: string; role?: string; pass?: string; pid?: string },
  ) {
    const pid = String(options?.pid ?? "");

    /** While a round is running, a lobby admits only people who were already in this game. */
    if (this.isLobby && this.matchId && (!pid || !this.hosts.knows(pid))) {
      client.leave(LEAVE_IN_PROGRESS);
      return;
    }

    /** A countdown is closed too. */
    if (this.isLobby && this.counting && (!pid || !this.hosts.knows(pid))) {
      client.leave(LEAVE_STARTING);
      return;
    }

    // Tie this seat to the tab behind it before anything else looks at either.
    // A player with no id — an old client, or storage refused — simply never
    // holds the button; they can still play.
    this.hosts.seat(client.sessionId, pid);

    const player = new Player();
    // Trimmed to length first, so a name cannot smuggle something past the
    // filter in characters that were going to be cut off anyway.
    player.name = cleanName(String(options?.name ?? "player").slice(0, 16));
    /** Nobody picks a side. */
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

    // Never "claim the button if it looks vacant" — that is what handed it to
    // whoever wandered into an empty lobby mid-match. `reassignHost` knows the
    // difference between vacant and waiting.
    this.reassignHost();
    this.publish();

    // The first person to join names the session, so it shows up in the list as
    // "Martin's Session" rather than the OS account name.
    if (this.state.players.size === 1 && !process.env.SESSION_NAME) {
      setSessionName(player.name);
    }

    // A full lobby starts itself. The host may still press Start earlier; both
    // roads lead to the same countdown, and `beginCountdown` ignores the second
    // caller rather than restarting the clock.
    if (this.isLobby && this.state.players.size >= this.state.maxPlayers) {
      this.beginCountdown();
    }
  }

  async onLeave(client: Client, consented?: boolean) {
    /** A drop is not a departure. */
    if (!this.isLobby && !consented && !this.ending && this.state.players.has(client.sessionId)) {
      const pending = this.allowReconnection(client, RECONNECT_SECONDS);
      this.pendingReturn.set(client.sessionId, pending as unknown as Reconnection);
      try {
        await pending;
        return; // They came back to the seat they left. State was never touched.
      } catch {
        // Never came back, or was killed while away. Fall through and clean up.
      } finally {
        this.pendingReturn.delete(client.sessionId);
      }
    }

    this.state.players.delete(client.sessionId);
    this.forgetFire(client.sessionId);
    // The seat is gone; the *player* is remembered in `firstSeen`, because
    // stepping out and coming back does not shorten how long you have been here.
    this.hosts.release(client.sessionId);

    // A countdown that outlived its second player would open a round for one
    // person. The interval checks this too, but doing it here means the panel
    // stops counting the moment somebody leaves rather than up to a second
    // later.
    if (this.counting && this.state.players.size < MIN_PLAYERS) this.cancelCountdown();

    /**
     * A quit can end a round, and which side it ends for depends on the phase.
     *
     * **During the hunt** the last chameleon leaving is the same as the last
     * one caught, and the last *hunter* leaving is its mirror: nobody is
     * looking any more, so the survivors have won it rather than the clock
     * running down over an empty search.
     *
     * **During hiding** there is no hunter in this room at all — theirs is
     * still in the lobby — so only one side can empty out. When it does the
     * round is over before it began, and the news has to be carried to the
     * lobby: this room is about to dispose with nobody left in it to see a
     * reveal, and the hunter would otherwise watch a mirror countdown run down
     * to a bell that never rings.
     */
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
