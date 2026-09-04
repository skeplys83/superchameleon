// GameDistribution HTML5 SDK — ad break plus two events.
// Loaded once on mount (their rule: never from a click, or the ad is too slow).
// Ads are shown only from a user click and only outside gameplay.
// Only enabled for portal traffic (gd_sdk_referrer_url on the URL).

// Empty GAME_ID = integration entirely off.
// Explicit `: string` — TS would narrow to a literal and defeat the `!== ""` check.
const GAME_ID: string = "a12326545a5a48aabf27566e0f4907ec";

// SDK_GAME_START is the only thing that ends a break; timeout is the backstop
// so a blocked SDK does not leave a server-clocked round paused.
const AD_TIMEOUT_MS = 60_000;

type GdEvent = { name?: string };

declare global {
  interface Window {
    GD_OPTIONS?: {
      gameId: string;
      onEvent: (event: GdEvent) => void;
      advertisementSettings?: Record<string, unknown>;
    };
    // Name fixed by their SDK.
    gdsdk?: { showAd?: () => void; openConsole?: () => void };
  }
}

const SCRIPT_ID = "gamedistribution-jssdk";
const SCRIPT_SRC = "https://html5.api.gamedistribution.com/main.min.js";

let started = false;
let playing = false;
let timeout: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<(playing: boolean) => void>();

export function onAdBreak(fn: (playing: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setPlaying(next: boolean) {
  if (playing === next) return;
  playing = next;
  if (timeout) clearTimeout(timeout);
  timeout = null;
  if (next) timeout = setTimeout(() => setPlaying(false), AD_TIMEOUT_MS);
  listeners.forEach((fn) => fn(next));
}

// The wrapper page appends gd_sdk_referrer_url; direct visitors never have it.
// Loading the SDK on our own site could take the game down with it.
function throughPortal() {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has("gd_sdk_referrer_url");
  } catch {
    return false;
  }
}

export const adsEnabled = () => GAME_ID !== "" && throughPortal();

export function initGameDistribution() {
  if (started || !adsEnabled() || typeof window === "undefined") return;
  started = true;

  // Before the script — the SDK reads this global as it loads.
  window.GD_OPTIONS = {
    gameId: GAME_ID,
    onEvent: (event: GdEvent) => {
      switch (event?.name) {
        // Names are from the game's point of view (PAUSE = ad starting).
        case "SDK_GAME_PAUSE":
          setPlaying(true);
          break;
        case "SDK_GAME_START":
          setPlaying(false);
          break;
        // Errors end the break at once, ahead of the timeout.
        case "SDK_ERROR":
        case "AD_ERROR":
          setPlaying(false);
          break;
      }
    },
  };

  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = SCRIPT_SRC;
  script.async = true;
  // A blocked script is normal (ad blockers).
  script.onerror = () => {
    started = false;
  };
  document.head.appendChild(script);
}

// Call from a click handler only — browsers refuse to autoplay otherwise.
export function showAd() {
  if (!adsEnabled() || playing) return false;
  const show = window.gdsdk?.showAd;
  if (typeof show !== "function") return false;
  try {
    show.call(window.gdsdk);
    return true;
  } catch (e) {
    console.warn("GameDistribution: showAd failed:", e);
    return false;
  }
}
