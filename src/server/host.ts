const HOST_GRACE_MS = 10_000;

export type Seat = { sessionId: string; pid: string };

// Who holds the Start button — longest-participating player, with a grace
// window around the match so a returning host is not replaced.
export class HostRule {
  private pidOf = new Map<string, string>();

  // First arrival per player id, kept for the room's whole life.
  private firstSeen = new Map<string, number>();

  private holder = "";

  private graceUntil = 0;

  claim(pid: string) {
    this.holder = pid;
  }

  seat(sessionId: string, pid: string) {
    if (!pid) return;
    this.pidOf.set(sessionId, pid);
    if (!this.firstSeen.has(pid)) this.firstSeen.set(pid, Date.now());
  }

  // Only the seat is released — the player is remembered.
  release(sessionId: string) {
    this.pidOf.delete(sessionId);
  }

  pidFor(sessionId: string) {
    return this.pidOf.get(sessionId) ?? "";
  }

  knows(pid: string) {
    return this.firstSeen.has(pid);
  }

  beginGrace() {
    this.graceUntil = Date.now() + HOST_GRACE_MS;
  }

  resolve(here: Seat[], matchLive: boolean): string {
    // Holder here (their sessionId may have changed if they just returned).
    const present = here.find((c) => c.pid !== "" && c.pid === this.holder);
    if (present) return present.sessionId;

    // Match live or grace window — wait rather than reassign.
    if (matchLive || Date.now() < this.graceUntil) return "";

    // Longest-participating wins.
    let best: Seat | null = null;
    let bestSeen = Infinity;
    for (const candidate of here) {
      if (candidate.pid === "") continue;
      const seen = this.firstSeen.get(candidate.pid) ?? Infinity;
      if (seen < bestSeen) {
        best = candidate;
        bestSeen = seen;
      }
    }

    this.holder = best?.pid ?? "";
    return best?.sessionId ?? "";
  }
}
