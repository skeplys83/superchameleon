// The canvas lives inside r3f but the pause menu lives outside — element kept here.
let target: HTMLCanvasElement | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

// Rough window during which the browser refuses a re-lock after Esc.
const RETRY_MS = 250;
const RETRY_ATTEMPTS = 8;

export function setLockTarget(canvas: HTMLCanvasElement | null) {
  target = canvas;
  if (!canvas) cancelLock();
}

export function lockTargetEl() {
  return target;
}

export function isLocked() {
  return !!target && document.pointerLockElement === target;
}

export function requestLock() {
  cancelLock();

  let left = RETRY_ATTEMPTS;
  const attempt = () => {
    retry = null;
    if (isLocked()) return;
    if (!target) {
      if (--left > 0) retry = setTimeout(attempt, RETRY_MS);
      return;
    }

    try {
      const pending = target.requestPointerLock() as unknown;
      if (pending && typeof (pending as Promise<void>).catch === "function") {
        void (pending as Promise<void>).catch(() => {});
      }
    } catch {
      // Refused for now — the retry is the plan.
    }

    if (--left > 0) retry = setTimeout(attempt, RETRY_MS);
  };
  attempt();
}

export function cancelLock() {
  if (retry) clearTimeout(retry);
  retry = null;
}
