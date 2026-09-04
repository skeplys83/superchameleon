// Plain DOM updated imperatively — routing mouse moves through useState
// re-renders the whole HUD tree 60/s.

export type PickPreview = {
  move(x: number, y: number): void;
  // null on nothing solid — sky/background; leave hollow, the click will
  // fall back to reading the drawn pixel.
  setColor(hex: string | null): void;
  destroy(): void;
};

const SWATCH = 72;
// Below-right so the circle never covers the pixel being sampled.
const OFFSET = 20;

export function createPickPreview(): PickPreview {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${SWATCH}px`,
    `height:${SWATCH}px`,
    "border-radius:9999px",
    "border:1px solid rgba(255,255,255,0.85)",
    "box-shadow:0 0 0 1px rgba(0,0,0,0.35),0 4px 14px rgba(0,0,0,0.45)",
    "pointer-events:none",
    "z-index:60",
    // Parked off-screen so arming does not flash the swatch in a corner.
    "transform:translate(-200px,-200px)",
  ].join(";");
  document.body.appendChild(el);

  return {
    move(x, y) {
      el.style.transform = `translate(${x + OFFSET}px,${y + OFFSET}px)`;
    },
    setColor(hex) {
      el.style.background = hex ?? "transparent";
    },
    destroy() {
      el.remove();
    },
  };
}

export type CursorHint = {
  move(x: number, y: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

export function createCursorHint(text: string): CursorHint {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "padding:3px 7px",
    "border-radius:5px",
    "background:rgba(0,0,0,0.7)",
    "color:rgba(245,245,245,0.95)",
    "font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace",
    "white-space:nowrap",
    "pointer-events:none",
    "z-index:60",
    "opacity:0",
    "transition:opacity 120ms ease",
    "transform:translate(-200px,-200px)",
  ].join(";");
  el.textContent = text;
  document.body.appendChild(el);

  return {
    move(x, y) {
      // Below the cursor and clear of the brush ring drawn around it.
      el.style.transform = `translate(${x + 16}px,${y + 22}px)`;
    },
    setVisible(visible) {
      el.style.opacity = visible ? "1" : "0";
    },
    destroy() {
      el.remove();
    },
  };
}
