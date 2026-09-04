export type Game = {
  code: string;
  host: string;
  map: string;
  started: boolean;
  starting: boolean;
  players: number;
  maxPlayers: number;
};

let cachedGamePort: number | null = null;

export function getAdvertisedGamePort(): number | null {
  return cachedGamePort;
}

export async function fetchSessions(): Promise<{ ready: boolean; games: Game[] }> {
  try {
    const res = await fetch("/api/sessions", { cache: "no-store" });
    if (!res.ok) return { ready: false, games: [] };
    const data = await res.json();
    if (data.self?.gamePort) {
      cachedGamePort = Number(data.self.gamePort);
    }
    return {
      ready: true,
      games: data.games ?? [],
    };
  } catch {
    return { ready: false, games: [] };
  }
}
