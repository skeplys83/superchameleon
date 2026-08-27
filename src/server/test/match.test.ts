import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ColyseusTestServer } from "@colyseus/testing";
import { bootTestServer, connected, heard, inner, roomOf, settle, told } from "./harness.ts";
import { DEFAULT_MATCH_MAP } from "../../shared/mapIds.ts";

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await bootTestServer();
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

const PASS = "the-round-pass";

/** A match, opened the way a lobby's `start` opens one. */
const openMatch = () =>
  connected(
    colyseus.sdk.create("match", {
      map: DEFAULT_MATCH_MAP,
      lobby: "NONE",
      pass: PASS,
      maxPlayers: 6,
      name: "first",
      role: "chameleon",
    }),
  );

/** Take a seat in a running match, with whatever this player claims to be. */
const joinMatch = (code: string, name: string, options: Record<string, unknown> = {}) =>
  connected(colyseus.sdk.joinById(code, { name, pid: `${name}-tab`, ...options }));

/** Skip the hiding phase without waiting it out. */
const beginHunt = async (code: string) => {
  roomOf(colyseus, code).state.phase = "hunt";
  await settle();
};

describe("a match", () => {
  it("opens with everybody hiding and a clock the map decided", async () => {
    const client = await openMatch();

    expect(client.state.mode).toBe("match");
    expect(client.state.phase).toBe("hiding");
    expect(client.state.map).toBe(DEFAULT_MATCH_MAP);
    expect(client.state.timeLeft).toBeGreaterThan(0);
  });

  it("rings the bell on its own clock, without a second timer", async () => {
    const client = await openMatch();
    // The real interval, one tick from the end of hiding.
    roomOf(colyseus, client.roomId).state.timeLeft = 1;

    await settle(1600);

    expect(client.state.phase).toBe("hunt");
    expect(client.state.timeLeft).toBeGreaterThan(0);
  });

  it("makes a chameleon of anyone claiming the gun without the round's pass", async () => {
    const first = await openMatch();

    const liar = await joinMatch(first.roomId, "liar", { role: "hunter" });
    const wrong = await joinMatch(first.roomId, "wrong", { role: "hunter", pass: "guessed" });
    await settle();

    expect(first.state.players.get(liar.sessionId)!.role).toBe("chameleon");
    expect(first.state.players.get(wrong.sessionId)!.role).toBe("chameleon");
  });

  it("honours the gun on a seat its lobby reserved", async () => {
    const first = await openMatch();

    const hunter = await joinMatch(first.roomId, "hunter", { role: "hunter", pass: PASS });
    await settle();

    expect(first.state.players.get(hunter.sessionId)!.role).toBe("hunter");
  });

  it("converts the caught rather than removing them, and marks the spot", async () => {
    const victim = await openMatch();
    const hunter = await joinMatch(victim.roomId, "hunter", { role: "hunter", pass: PASS });
    const bystander = await joinMatch(victim.roomId, "bystander");
    await beginHunt(victim.roomId);

    hunter.send("kill", { id: victim.sessionId, position: [1, 2, 3] });
    await settle();

    const caught = victim.state.players.get(victim.sessionId)!;
    expect(caught).toBeDefined(); // still in the room — being caught keeps you playing
    expect(caught.role).toBe("hunter");
    expect(victim.state.graves.length).toBe(1);
    expect(victim.state.graves[0]).toContain("first");
    // One left free, so the round is not over.
    expect(victim.state.phase).toBe("hunt");
    expect(victim.state.players.get(bystander.sessionId)!.role).toBe("chameleon");
  });

  it("ends the round when the last chameleon is caught", async () => {
    const victim = await openMatch();
    const hunter = await joinMatch(victim.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(victim.roomId);

    hunter.send("kill", { id: victim.sessionId });
    await settle();

    expect(victim.state.phase).toBe("reveal");
    expect(victim.state.winner).toBe("hunters");
  });

  it("gives the round to the chameleons when the hunt clock runs out", async () => {
    const client = await openMatch();
    await joinMatch(client.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(client.roomId);
    roomOf(colyseus, client.roomId).state.timeLeft = 1;

    await settle(1600);

    expect(client.state.phase).toBe("reveal");
    expect(client.state.winner).toBe("chameleons");
  });

  it("gives the round to the chameleons when the last hunter walks out", async () => {
    const chameleon = await openMatch();
    const hunter = await joinMatch(chameleon.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(chameleon.roomId);

    await hunter.leave(true);
    await settle();

    // Nobody is looking any more, so the clock must not run down over an empty
    // search — which reads as the game having hung.
    expect(chameleon.state.phase).toBe("reveal");
    expect(chameleon.state.winner).toBe("chameleons");
  });

  it("keeps hiding while anyone is still hiding, hunter or no hunter", async () => {
    const chameleon = await openMatch();
    const second = await joinMatch(chameleon.roomId, "second");
    await settle();
    expect(chameleon.state.phase).toBe("hiding");

    // No hunter is in this room during hiding — theirs is in the lobby — so
    // `huntersLeft` is legitimately zero and must not read as everyone giving
    // up. One chameleon leaving is not the last one, either.
    await second.leave(true);
    await settle();

    expect(chameleon.state.phase).toBe("hiding");
    // Falsy rather than "": an unset schema field is absent from the encoded
    // state and arrives as undefined, which is why `timeLeft` is written
    // explicitly and this one is not.
    expect(chameleon.state.winner).toBeFalsy();
  });

  it("ends the round the moment the last hider leaves during hiding", async () => {
    const chameleon = await openMatch();
    const room = roomOf(colyseus, chameleon.roomId);

    await chameleon.leave(true);
    await settle();

    // Nobody left to find, so the clock must not run on towards a bell that
    // would ring into an empty map.
    expect(room.state.phase).toBe("reveal");
    expect(room.state.winner).toBe("hunters");
  });

  it("refuses a kill during the reveal, so it cannot be played through", async () => {
    const victim = await openMatch();
    const survivor = await joinMatch(victim.roomId, "survivor");
    const hunter = await joinMatch(victim.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(victim.roomId);
    inner(roomOf(colyseus, victim.roomId)).finish("chameleons");
    await settle();
    expect(victim.state.phase).toBe("reveal");

    hunter.send("kill", { id: survivor.sessionId });
    await settle();

    expect(victim.state.players.get(survivor.sessionId)!.role).toBe("chameleon");
    expect(victim.state.graves.length).toBe(0);
  });

  it("refuses a chameleon's kill, and one aimed at another hunter", async () => {
    const chameleon = await openMatch();
    const target = await joinMatch(chameleon.roomId, "target");
    const hunter = await joinMatch(chameleon.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(chameleon.roomId);

    chameleon.send("kill", { id: target.sessionId });
    await settle();
    expect(chameleon.state.players.get(target.sessionId)!.role).toBe("chameleon");

    hunter.send("kill", { id: hunter.sessionId });
    await settle();
    expect(chameleon.state.graves.length).toBe(0);
  });

  it("clamps the cling surface, and refuses one from a hunter", async () => {
    const chameleon = await openMatch();
    const hunter = await joinMatch(chameleon.roomId, "hunter", { role: "hunter", pass: PASS });

    // It is a small enum now, not a flag: every client reads it as which way up
    // to draw a body, so a junk value is a body lying against nothing.
    chameleon.send("state", { p: [0, 1, 0], yaw: 0, pitch: 0, pose: 0, cling: 99 });
    // Clinging is what silences footsteps, so a hunter who could set it would
    // hunt without making a sound.
    hunter.send("state", { p: [0, 1, 0], yaw: 0, pitch: 0, pose: 0, cling: 2 });
    await settle();

    expect(chameleon.state.players.get(chameleon.sessionId)!.cling).toBe(2);
    expect(chameleon.state.players.get(hunter.sessionId)!.cling).toBe(0);
  });

  it("clamps a reported position to the map rather than trusting it", async () => {
    const client = await openMatch();

    client.send("state", { p: [9999, 9999, -9999], yaw: Number.NaN, pitch: 0, pose: 99 });
    await settle();

    const me = client.state.players.get(client.sessionId)!;
    expect(Math.abs(me.x)).toBeLessThanOrEqual(40);
    expect(me.y).toBeLessThanOrEqual(30);
    // A NaN written into schema propagates to every client, so it becomes 0.
    expect(Number.isFinite(me.yaw)).toBe(true);
    expect(me.pose).toBeLessThanOrEqual(4);
  });

  it("buries a junk catch position where the victim is, not at the origin", async () => {
    const victim = await openMatch();
    const hunter = await joinMatch(victim.roomId, "hunter", { role: "hunter", pass: PASS });
    await beginHunt(victim.roomId);
    roomOf(colyseus, victim.roomId).state.players.get(victim.sessionId)!.x = 7;

    // A clamped NaN is 0, which would put every junk grave in the middle of the
    // map — a plausible-looking spot rather than a refused one.
    hunter.send("kill", { id: victim.sessionId, position: [Number.NaN, 0, 0] });
    await settle();

    expect(victim.state.graves[0]).toContain("7.00");
  });
});

describe("a shot", () => {
  type Mark = { position: number[]; rotation: number[]; origin: number[] };

  it("is relayed with its position, rotation and origin", async () => {
    const client = await openMatch();
    const marks = told<Mark>(client, "mark");

    client.send("shoot", { position: [1, 2, 3], rotation: [0, 1, 0], origin: [0, 1, 0] });
    await settle();

    expect(marks.length).toBe(1);
    expect(marks[0].position).toEqual([1, 2, 3]);
  });

  it("is refused outright when its payload is not three vectors", async () => {
    const client = await openMatch();
    const marks = told<Mark>(client, "mark");
    const shots = told<{ id: string }>(client, "shot");

    // Marks are the one relayed payload with no size cap, and every client
    // hands the numbers straight to a renderer. This used to be typed as a
    // vector and relayed untouched, which is a claim about a stranger's input
    // rather than a check on it.
    client.send("shoot", { position: "over there", rotation: [0, 1, 0], origin: [0, 1, 0] });
    client.send("shoot", { position: [1, 2], rotation: [0, 1, 0], origin: [0, 1, 0] });
    client.send("shoot", { position: [1, 2, 3], rotation: [Number.NaN, 1, 0], origin: [0, 1, 0] });
    client.send("shoot", { position: [1, 2, 3], rotation: [0, 1, 0] });
    await settle();

    expect(marks).toEqual([]);
    // Not even the bang: a refused shot never happened.
    expect(shots).toEqual([]);
  });

  it("bounds a wild position to the map before anyone renders it", async () => {
    const client = await openMatch();
    const marks = told<Mark>(client, "mark");

    client.send("shoot", {
      position: [1e12, 1e12, -1e12],
      rotation: [1e9, 0, 0],
      origin: [0, 1, 0],
    });
    await settle();

    expect(marks.length).toBe(1);
    const [x, y, z] = marks[0].position;
    expect(Math.abs(x)).toBeLessThanOrEqual(40);
    expect(y).toBeLessThanOrEqual(30);
    expect(Math.abs(z)).toBeLessThanOrEqual(40);
    expect(Math.abs(marks[0].rotation[0])).toBeLessThanOrEqual(Math.PI * 2);
  });
});

describe("chat in a match", () => {
  it("is refused, in hiding and in the hunt alike", async () => {
    const first = await openMatch();
    const said = heard(first);

    first.send("chat", { text: "behind the second pillar" });
    await settle();
    expect(said).toEqual([]);

    await beginHunt(first.roomId);
    first.send("chat", { text: "still nothing" });
    await settle();

    // Chat is a waiting-room thing. A channel between the people being hunted
    // is coordination against the one player looking for them.
    expect(said).toEqual([]);
  });
});
