const KEY = "mc_pid";

let cached: string | null = null;

function freshId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function playerId() {
  if (cached) return cached;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // Storage disabled — fall through to a per-page id.
  }

  const fresh = freshId();
  try {
    sessionStorage.setItem(KEY, fresh);
  } catch {
    // As above.
  }
  cached = fresh;
  return fresh;
}
