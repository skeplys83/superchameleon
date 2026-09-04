import type { Phase, Role } from "@/shared/protocol";

export type NetMark = {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  origin: [number, number, number];
};

export type Grave = { id: string; position: [number, number, number]; name: string };

// id is a counter, used only as a React key.
export type ChatMessage = { id: string; name: string; text: string };

export type RoomInfo = {
  mode: "lobby" | "match";
  role: Role;
  map: string;
  // Equal to `map` in a match.
  nextMap: string;
  // Invite code — the room's id.
  code: string;
  isHost: boolean;
  isListed: boolean;
  // For a match: the lobby to go back to.
  lobbyCode: string;
  timeLeft: number;
  phase: Phase;
  winner: string;
  maxPlayers: number;
  playerCount: number;
};

// Session ids on the wire — every client already knows where that player is.
const shotListeners = new Set<(shooterId: string) => void>();
const whistleListeners = new Set<(whistlerId: string) => void>();
const markListeners = new Set<(mark: NetMark) => void>();
const graveListeners = new Set<(grave: Grave) => void>();
// Whole list each time (the panel takes it that way); client.ts holds the copy.
const chatListeners = new Set<(messages: ChatMessage[]) => void>();
const caughtListeners = new Set<
  (victimId: string, by: string, position?: [number, number, number]) => void
>();
const roomListeners = new Set<(info: RoomInfo) => void>();
const moveFailedListeners = new Set<(reason: string) => void>();
const droppedListeners = new Set<() => void>();
const movedListeners = new Set<() => void>();
const leftRoomListeners = new Set<() => void>();

export function onLeftRoom(fn: () => void) {
  leftRoomListeners.add(fn);
  return () => {
    leftRoomListeners.delete(fn);
  };
}

export function emitLeftRoom() {
  leftRoomListeners.forEach((fn) => fn());
}

export function onShot(fn: (shooterId: string) => void) {
  shotListeners.add(fn);
  return () => {
    shotListeners.delete(fn);
  };
}

export function onWhistle(fn: (whistlerId: string) => void) {
  whistleListeners.add(fn);
  return () => {
    whistleListeners.delete(fn);
  };
}

export function onMark(fn: (mark: NetMark) => void) {
  markListeners.add(fn);
  return () => {
    markListeners.delete(fn);
  };
}

export function onGrave(fn: (grave: Grave) => void) {
  graveListeners.add(fn);
  return () => {
    graveListeners.delete(fn);
  };
}

export function onCaught(
  fn: (victimId: string, by: string, position?: [number, number, number]) => void,
) {
  caughtListeners.add(fn);
  return () => {
    caughtListeners.delete(fn);
  };
}

export function onChat(fn: (messages: ChatMessage[]) => void) {
  chatListeners.add(fn);
  return () => {
    chatListeners.delete(fn);
  };
}

export function onRoom(fn: (info: RoomInfo) => void) {
  roomListeners.add(fn);
  return () => {
    roomListeners.delete(fn);
  };
}

export function onMoveFailed(fn: (reason: string) => void) {
  moveFailedListeners.add(fn);
  return () => {
    moveFailedListeners.delete(fn);
  };
}

export function onDropped(fn: () => void) {
  droppedListeners.add(fn);
  return () => {
    droppedListeners.delete(fn);
  };
}

export function emitDropped() {
  droppedListeners.forEach((fn) => fn());
}

export function onMoved(fn: () => void) {
  movedListeners.add(fn);
  return () => {
    movedListeners.delete(fn);
  };
}

export function emitMoved() {
  movedListeners.forEach((fn) => fn());
}

export function emitRoom(info: RoomInfo) {
  roomListeners.forEach((fn) => fn(info));
}

export function emitMoveFailed(reason: string) {
  moveFailedListeners.forEach((fn) => fn(reason));
}

export function emitShot(shooterId: string) {
  shotListeners.forEach((fn) => fn(shooterId));
}

export function emitWhistle(whistlerId: string) {
  whistleListeners.forEach((fn) => fn(whistlerId));
}

export function emitMark(mark: NetMark) {
  markListeners.forEach((fn) => fn(mark));
}

export function emitGrave(grave: Grave) {
  graveListeners.forEach((fn) => fn(grave));
}

export function emitChat(messages: ChatMessage[]) {
  chatListeners.forEach((fn) => fn(messages));
}

export function emitCaught(
  victimId: string,
  by: string,
  position?: [number, number, number],
) {
  caughtListeners.forEach((fn) => fn(victimId, by, position));
}
