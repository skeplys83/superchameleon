// CrazyGames SDK integration is OFF (SDK_ENABLED = false). What remains live
// is the plain invite link (generateInviteLink / getInitialInviteRoom), which
// the game runs on now. To re-enable: flip SDK_ENABLED and add back
//   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
// to index.html.
const SDK_ENABLED = false;

type UpdateRoomOptions = {
  roomId?: string;
  isJoinable?: boolean;
  inviteParams?: Record<string, string>;
};

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: {
        environment?: "local" | "crazygames" | "disabled";
        init: () => Promise<void>;
        game?: {
          isInstantMultiplayer?: boolean;
          inviteParams?: Record<string, string> | null;
          getInviteParam?: (key: string) => string | null;
          inviteLink?: (params: Record<string, string | number>) => string;
          updateRoom?: (options: UpdateRoomOptions) => void;
          leftRoom?: () => void;
          addJoinRoomListener?: (cb: (params: Record<string, string>) => void) => void;
          removeJoinRoomListener?: (cb: (params: Record<string, string>) => void) => void;
        };
      };
    };
  }
}

let sdkPromise: Promise<boolean> | null = null;

const CRAZY_HOSTS = ["crazygames.com", "crazygames.co.uk"];

function isCrazyHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CRAZY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin window.top throws — that is itself an embed.
    return true;
  }
}

// ancestorOrigins is the reliable answer (Chromium/Safari); Firefox has none,
// so fall back to the referrer.
function hasCrazyAncestor(): boolean {
  const origins = window.location.ancestorOrigins;
  if (origins && origins.length > 0) {
    for (let i = 0; i < origins.length; i++) {
      if (isCrazyHost(origins[i])) return true;
    }
    return false;
  }
  if (document.referrer) return isCrazyHost(document.referrer);
  return true;
}

let supported: boolean | null = null;

function isSupportedSdkEnvironment(): boolean {
  if (!SDK_ENABLED) return false;
  if (supported !== null) return supported;
  const environment = window.CrazyGames?.SDK?.environment;
  if (!environment) return false;
  supported =
    environment === "local" ||
    (environment === "crazygames" && isEmbedded() && hasCrazyAncestor());
  return supported;
}

export async function initCrazySDK(): Promise<boolean> {
  if (!SDK_ENABLED || typeof window === "undefined") return false;
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    try {
      if (isSupportedSdkEnvironment() && window.CrazyGames?.SDK?.init) {
        await window.CrazyGames.SDK.init();
        return true;
      }
    } catch (e) {
      console.warn("CrazyGames SDK failed to initialize:", e);
    }
    return false;
  })();

  return sdkPromise;
}

export function isInstantMultiplayer(): boolean {
  if (typeof window === "undefined" || !isSupportedSdkEnvironment()) return false;
  return Boolean(window.CrazyGames?.SDK?.game?.isInstantMultiplayer);
}

export function getInitialInviteRoom(): string | null {
  if (typeof window === "undefined") return null;

  try {
    if (isSupportedSdkEnvironment()) {
      const sdkParam = window.CrazyGames?.SDK?.game?.getInviteParam?.("roomId");
      if (sdkParam) return sdkParam.trim().toUpperCase();

      const inviteParams = window.CrazyGames?.SDK?.game?.inviteParams;
      if (inviteParams && typeof inviteParams === "object" && inviteParams.roomId) {
        return String(inviteParams.roomId).trim().toUpperCase();
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code") || urlParams.get("room");
    if (code) {
      return code.trim().toUpperCase();
    }
  } catch {
    // URL parsing failure or restricted environment
  }

  return null;
}

export function generateInviteLink(roomId: string): string {
  const cleanId = roomId.trim().toUpperCase();

  try {
    if (isSupportedSdkEnvironment() && window.CrazyGames?.SDK?.game?.inviteLink) {
      return window.CrazyGames.SDK.game.inviteLink({ roomId: cleanId });
    }
  } catch (e) {
    console.warn("Failed to generate CrazyGames invite link:", e);
  }

  if (typeof window !== "undefined" && window.location) {
    return `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(cleanId)}`;
  }

  return cleanId;
}

export function updateCrazyRoom(roomId: string, isJoinable: boolean) {
  try {
    if (!isSupportedSdkEnvironment()) return;
    const cleanId = roomId.trim().toUpperCase();
    window.CrazyGames?.SDK?.game?.updateRoom?.({
      roomId: cleanId,
      isJoinable,
      inviteParams: { roomId: cleanId },
    });
  } catch (e) {
    console.warn("Failed to update CrazyGames room state:", e);
  }
}

export function leaveCrazyRoom() {
  try {
    if (!isSupportedSdkEnvironment()) return;
    window.CrazyGames?.SDK?.game?.leftRoom?.();
  } catch (e) {
    console.warn("Failed to notify CrazyGames leftRoom:", e);
  }
}

export function addCrazyJoinListener(
  cb: (params: Record<string, string>) => void,
) {
  try {
    if (!isSupportedSdkEnvironment()) return;
    window.CrazyGames?.SDK?.game?.addJoinRoomListener?.(cb);
  } catch {
    // SDK not active
  }
}

export function removeCrazyJoinListener(
  cb: (params: Record<string, string>) => void,
) {
  try {
    if (!isSupportedSdkEnvironment()) return;
    window.CrazyGames?.SDK?.game?.removeJoinRoomListener?.(cb);
  } catch {
    // SDK not active
  }
}
