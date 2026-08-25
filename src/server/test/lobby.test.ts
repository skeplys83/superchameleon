import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ColyseusTestServer } from "@colyseus/testing";
import { bootTestServer, connected, heard, inner, roomOf, settle } from "./harness.ts";
import {
  CHAT_INTERVAL_MS,
  MAX_CHAT_LENGTH,
  MIN_PLAYERS,
} from "../../shared/protocol.ts";
import { DEFAULT_MATCH_MAP, LOBBY_MAP } from "../../shared/mapIds.ts";
import { NAMES } from "../../shared/names.ts";

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await bootTestServer();
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

/** Open a lobby the way `net/client.ts` does. */
const openLobby = (options: Record<string, unknown> = {}) =>
  connected(colyseus.sdk.create("lobby", { name: "host", pid: "host-tab", ...options }));

/** Join an existing lobby by its code, as somebody handed the invite would. */
const joinLobby = (code: string, name: string) =>
  connected(colyseus.sdk.joinById(code, { name, pid: `${name}-tab` }));

describe("a lobby", () => {
  it("waits in the arena under a readable four-letter code", async () => {
    const client = await openLobby();

    expect(client.roomId).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(client.state.mode).toBe("lobby");
    expect(client.state.phase).toBe("waiting");
    expect(client.state.map).toBe(LOBBY_MAP);
    // A clock that is not running is 0, never absent — see invariant 18.
    expect(client.state.timeLeft).toBe(0);
  });

  it("arms everybody, because nobody picks a side", async () => {
    const host = await openLobby();
    const guest = await joinLobby(host.roomId, "guest");

    expect(host.state.players.get(host.sessionId)!.role).toBe("hunter");
    expect(host.state.players.get(guest.sessionId)!.role).toBe("hunter");
  });

  it("refuses a kill even though everyone in it is armed", async () => {
    const host = await openLobby();
    const victim = await joinLobby(host.roomId, "victim");

    host.send("kill", { id: victim.sessionId });
    await settle();

    // The shot still bangs; only the consequence is withheld.
    expect(host.state.players.get(victim.sessionId)!.role).toBe("hunter");
    expect(host.state.graves.length).toBe(0);
  });

  it("refuses the arena as a match map, at creation and from the host", async () => {
    const host = await openLobby({ map: LOBBY_MAP });
    expect(host.state.nextMap).toBe(DEFAULT_MATCH_MAP);

    host.send("setMap", { map: LOBBY_MAP });
    await settle();
    expect(host.state.nextMap).toBe(DEFAULT_MATCH_MAP);
  });

  it("refuses a map change once the countdown is running", async () => {
    const host = await openLobby({ map: "dungeon", maxPlayers: MIN_PLAYERS });
    await joinLobby(host.roomId, "guest");
    expect(host.state.phase).toBe("countdown");

    // The map everybody is already preloading cannot be swapped under them.
    host.send("setMap", { map: "hospital" });
    await settle();

    expect(host.state.nextMap).toBe("dungeon");
  });

  it("ignores start and setMap from anyone but the host", async () => {
    const host = await openLobby({ map: "dungeon" });
    const guest = await joinLobby(host.roomId, "guest");

    guest.send("setMap", { map: "arena" });
    guest.send("start", {});
    await settle();

    expect(host.state.nextMap).toBe("dungeon");
    expect(host.state.phase).toBe("waiting");
  });

  it("counts down when it fills up, and cancels if it stops being startable", async () => {
    const host = await openLobby({ maxPlayers: MIN_PLAYERS });
    const guest = await joinLobby(host.roomId, "guest");

    // Filling to maxPlayers is one of the two roads into `beginCountdown`.
    expect(host.state.phase).toBe("countdown");
    expect(host.state.timeLeft).toBeGreaterThan(0);

    await guest.leave(true);
    await settle();

    // Below MIN_PLAYERS there is no round to start, so it goes back to waiting
    // immediately rather than on the next tick.
    expect(host.state.phase).toBe("waiting");
    expect(host.state.timeLeft).toBe(0);
  });

  it("closes its door to strangers while it counts down, but not to its own", async () => {
    // Room for a third, so capacity plays no part in what is being tested here.
    const host = await openLobby({ maxPlayers: 3 });
    const known = await joinLobby(host.roomId, "known");
    host.send("start", {});
    await settle();
    expect(host.state.phase).toBe("countdown");

    await expect(
      colyseus.sdk.joinById(host.roomId, { name: "stranger", pid: "stranger-tab" }),
    ).rejects.toBeDefined();

    // A wifi blip inside the ten seconds is not an ejection from your own round.
    await known.leave(false);
    await settle();
    const back = await joinLobby(host.roomId, "known");
    expect(back.roomId).toBe(host.roomId);
  });

  it("draws exactly one hunter, and not always the host", async () => {
    const drawn = new Set<string>();

    for (let round = 0; round < 12; round++) {
      const host = await openLobby({ maxPlayers: 4 });
      const a = await joinLobby(host.roomId, `a${round}`);
      const b = await joinLobby(host.roomId, `b${round}`);
      const room = roomOf(colyseus, host.roomId);

      // Straight to the hand-off: the countdown is ten real seconds and is
      // tested above on its own.
      await inner(room).start();

      const hunterId = inner(room).hunterId;
      expect([host.sessionId, a.sessionId, b.sessionId]).toContain(hunterId);
      drawn.add(hunterId === host.sessionId ? "host" : "guest");

      await colyseus.cleanup();
    }

    // The draw is over whoever is present, so opening the room must not be a
    // way to keep the gun — nor a way to be spared it.
    expect([...drawn].sort()).toEqual(["guest", "host"]);
  });

  it("sends only the chameleons, and keeps the hunter waiting in the arena", async () => {
    const host = await openLobby({ maxPlayers: 4 });
    const guest = await joinLobby(host.roomId, "guest");

    const travelled = new Set<string>();
    host.onMessage("moveTo", () => travelled.add(host.sessionId));
    guest.onMessage("moveTo", () => travelled.add(guest.sessionId));

    const room = roomOf(colyseus, host.roomId);
    await inner(room).start();
    await settle();

    const hunterId = inner(room).hunterId;
    expect(travelled.size).toBe(1);
    expect(travelled.has(hunterId)).toBe(false);
    // The lobby stays in `hiding` until the hunter has actually been handed
    // over, or no bell rings for the one person it is about.
    expect(host.state.phase).toBe("hiding");
  });

  it("releases the hunter when the round ends before they are sent in", async () => {
    const host = await openLobby();
    const room = roomOf(colyseus, host.roomId);
    inner(room).matchId = "FAKE";

    await inner(room).roundAborted("FAKE");
    await settle();

    // The hunter never left this room, so this is where they have to be told —
    // otherwise they watch a mirror countdown run down to a bell that will
    // never ring.
    expect(host.state.phase).toBe("reveal");
    expect(host.state.winner).toBe("hunters");
    expect(host.state.timeLeft).toBeGreaterThan(0);

    // And it hands the lobby back afterwards rather than sticking there.
    roomOf(colyseus, host.roomId).state.timeLeft = 1;
    await settle(1600);
    expect(host.state.phase).toBe("waiting");
    expect(host.state.winner).toBe("");
    expect(host.state.timeLeft).toBe(0);
  });

  it("does not dispose when its last player leaves", async () => {
    const host = await openLobby();
    const code = host.roomId;
    inner(roomOf(colyseus, code)).matchId = "pretend-match";

    await host.leave(true);
    await settle();

    // The invite code has to survive the whole match its players are away in.
    expect(colyseus.getRoomById(code)).toBeDefined();
  });
});

describe("lobby chat", () => {
  it("puts a line in front of everybody, attributed to whoever typed it", async () => {
    const host = await openLobby();
    const guest = await joinLobby(host.roomId, "guest");
    const atHost = heard(host);
    const atGuest = heard(guest);

    guest.send("chat", { text: "one more coming" });
    await settle();

    // A broadcast, and the sender is in it: nobody draws their own line
    // locally, so this is the one delivery.
    expect(atHost).toEqual([{ name: "guest", text: "one more coming" }]);
    expect(atGuest).toEqual([{ name: "guest", text: "one more coming" }]);
  });

  it("hands whoever arrives next none of the conversation", async () => {
    const host = await openLobby();
    host.send("chat", { text: "said before you got here" });
    await settle();

    const latecomer = await joinLobby(host.roomId, "latecomer");
    const atLatecomer = heard(latecomer);
    await settle();

    // Nothing is stored, so there is nothing to replay: a lobby can only be
    // heard by whoever is standing in it.
    expect(atLatecomer).toEqual([]);
  });

  it("trims a message and drops one that is only whitespace or control codes", async () => {
    const host = await openLobby();
    const said = heard(host);

    host.send("chat", { text: "   \n\t  " });
    await settle();
    expect(said.length).toBe(0);

    host.send("chat", { text: "  spaced out  " });
    await settle();
    expect(said[0].text).toBe("spaced out");
  });

  it("keeps one message to one line, and to MAX_CHAT_LENGTH", async () => {
    const host = await openLobby();
    const said = heard(host);

    host.send("chat", { text: "first\nsecond" });
    await settle();
    expect(said[0].text).toBe("first second");

    await settle(CHAT_INTERVAL_MS);
    host.send("chat", { text: "x".repeat(MAX_CHAT_LENGTH + 50) });
    await settle();
    expect(said[1].text.length).toBe(MAX_CHAT_LENGTH);
  });

  it("takes one message per CHAT_INTERVAL_MS from a client", async () => {
    const host = await openLobby();
    const said = heard(host);

    host.send("chat", { text: "first" });
    host.send("chat", { text: "hot on its heels" });
    await settle();

    expect(said).toEqual([{ name: "host", text: "first" }]);
  });

  it("goes quiet once the lobby is no longer a waiting room", async () => {
    const host = await openLobby();
    const room = roomOf(colyseus, host.roomId);
    const said = heard(host);

    // The lobby during `hiding` holds the drawn hunter alone, and a line
    // written now would be talking to nobody.
    room.state.phase = "hiding";
    await settle();
    host.send("chat", { text: "they went left" });
    await settle();

    expect(said).toEqual([]);
  });
});

describe("what a player may make everyone else read", () => {
  it("hands a foul name back as one of the fallbacks", async () => {
    const host = await openLobby({ name: "fuckface" });

    const seated = host.state.players.get(host.sessionId)!.name;
    expect(seated).not.toBe("fuckface");
    expect(NAMES.some((n) => seated.startsWith(n))).toBe(true);
  });

  it("leaves an ordinary name exactly as it was typed", async () => {
    const host = await openLobby({ name: "Martin" });
    expect(host.state.players.get(host.sessionId)!.name).toBe("Martin");
  });

  it("masks a chat line rather than dropping it", async () => {
    const host = await openLobby();
    const said = heard(host);
    host.send("chat", { text: "what the fuck are you doing" });
    await settle();

    // The line still lands — a message that silently vanishes reads as the
    // server being broken, and gets typed again.
    expect(said.length).toBe(1);
    expect(said[0].text).not.toContain("fuck");
    expect(said[0].text).toContain("are you doing");
  });
});
