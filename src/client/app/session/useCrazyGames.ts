import { useEffect } from "react";
import {
  addCrazyJoinListener,
  getInitialInviteRoom,
  initCrazySDK,
  isInstantMultiplayer,
  leaveCrazyRoom,
  removeCrazyJoinListener,
  updateCrazyRoom,
} from "@/client/app/crazygames";
import { fetchSessions } from "@/client/net/sessions";
import { randomName } from "@/shared/names";
import { DEFAULT_MAP } from "@/shared/mapIds";
import type { RoomInfo } from "@/client/net";

const INSTANT_LOBBY_SIZE = 8;

type Options = {
  joined: boolean;
  room: RoomInfo | null;
  name: string;
  create: (who: string, map: string, listed: boolean, maxPlayers: number) => void;
  joinCode: (who: string, code: string) => void;
};

// Inert unless the SDK is in local/crazygames env AND a crazygames frame is
// above us — see crazygames.ts. Direct visits use the ?code= URL invite instead.
export function useCrazyGames({ joined, room, name, create, joinCode }: Options) {
  useEffect(() => {
    let active = true;

    void initCrazySDK().then(async () => {
      if (!active) return;

      // 1. Portal invite / ?code=
      const inviteCode = getInitialInviteRoom();
      if (inviteCode) {
        joinCode(randomName(), inviteCode);
        return;
      }

      // 2. Instant multiplayer: join or create.
      if (!isInstantMultiplayer()) return;
      const playerName = randomName();
      try {
        const { games: openSessions } = await fetchSessions();
        if (!active) return;

        const joinable = openSessions.find(
          (g) => !g.started && !g.starting && g.players < g.maxPlayers,
        );
        if (joinable) joinCode(playerName, joinable.code);
        else create(playerName, DEFAULT_MAP, true, INSTANT_LOBBY_SIZE);
      } catch {
        if (active) create(playerName, DEFAULT_MAP, true, INSTANT_LOBBY_SIZE);
      }
    });

    // 3. Live invitation while already in a game.
    const onLiveInvite = (params: Record<string, string>) => {
      const targetRoom = params?.roomId || params?.roomName;
      if (targetRoom) joinCode(name || randomName(), targetRoom);
    };

    addCrazyJoinListener(onLiveInvite);
    return () => {
      active = false;
      removeCrazyJoinListener(onLiveInvite);
    };
  }, [create, joinCode, name]);

  useEffect(() => {
    if (!joined || !room) {
      leaveCrazyRoom();
      return;
    }
    updateCrazyRoom(room.lobbyCode ?? room.code, room.phase === "waiting");
  }, [joined, room]);
}
