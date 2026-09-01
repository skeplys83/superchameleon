import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { recentColors, subscribeColors, WHITE } from "@/client/paint/palette";
import { MAX_SIZE, MIN_SIZE, type Brush } from "./brush";

/**
 * The wheel's *backing* resolution, and nothing to do with how big it is drawn.
 *
 * **It used to be both**, at 208, which was also exactly the panel's inner
 * width — `w-[14.5rem]` is 232px and `p-3` takes 24 of them. Two numbers in
 * different files that had to agree to the pixel, with no slack: the wheel
 * spilled past the panel the moment either moved. It is laid out at `w-full`
 * now and cannot overflow whatever the panel is; this only decides how many
 * pixels the gradient is generated at.
 */
const WHEEL = 256;

/** One channel of HSV→RGB, 0..1. Kept numeric and separate from the hex form:
 *  the wheel redraws whole every time the brightness moves, and going through a
 *  string per pixel made that 43 000 allocations a frame. */
function hsvChannel(n: number, h: number, s: number, v: number) {
  const k = (n + h * 6) % 6;
  return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) =>
    Math.round(hsvChannel(n, h, s, v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${f(5)}${f(3)}${f(1)}`;
}

/** The wheel carries hue and saturation, the slider carries value. */
function hexToHsv(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function ColorWheel({
  h,
  s,
  v,
  onPick,
}: {
  h: number;
  s: number;
  v: number;
  onPick: (h: number, s: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  // **Redrawn at the brightness the slider is on.** It used to be drawn once at
  // full value, on the grounds that a wheel which never changes is a map you
  // can learn — but the colour you are mixing is the one you are about to
  // paint, and a wheel glowing at full brightness while the brush is dark
  // showed every colour except that one.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const image = ctx.createImageData(WHEEL, WHEEL);
    const radius = WHEEL / 2;
    for (let y = 0; y < WHEEL; y++) {
      for (let x = 0; x < WHEEL; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.hypot(dx, dy);
        const i = (y * WHEEL + x) * 4;
        if (dist > radius) {
          image.data[i + 3] = 0;
          continue;
        }
        const hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
        const sat = Math.min(1, dist / radius);
        image.data[i] = Math.round(hsvChannel(5, hue, sat, v) * 255);
        image.data[i + 1] = Math.round(hsvChannel(3, hue, sat, v) * 255);
        image.data[i + 2] = Math.round(hsvChannel(1, hue, sat, v) * 255);
        // Feather the rim so the circle does not look jagged.
        image.data[i + 3] = Math.round(255 * Math.min(1, radius - dist));
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [v]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const radius = WHEEL / 2;
    const dx = ((e.clientX - rect.left) / rect.width) * WHEEL - radius;
    const dy = ((e.clientY - rect.top) / rect.height) * WHEEL - radius;
    const hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    onPick(hue, Math.min(1, Math.hypot(dx, dy) / radius));
  };

  // In per cent, not pixels: the wheel is laid out fluid, so the marker has to
  // be too or it drifts off the colour it is pointing at at any other size.
  const angle = h * Math.PI * 2;
  const marker = {
    left: `${50 + Math.cos(angle) * s * 50}%`,
    top: `${50 + Math.sin(angle) * s * 50}%`,
  };

  return (
    <div className="relative aspect-square w-full">
      <canvas
        ref={canvas}
        width={WHEEL}
        height={WHEEL}
        className="h-full w-full cursor-crosshair touch-none rounded-full"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      {/* Where the current colour sits, so the wheel reflects the brush. */}
      <span
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{ left: marker.left, top: marker.top, background: hsvToHex(h, s, v) }}
      />
    </div>
  );
}

/** The palette. */
export function PaintPanel({
  open,
  onOpenChange,
  brush,
  onBrush,
  picking,
  onPickingChange,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brush: Brush;
  onBrush: (b: Brush) => void;
  /** The eyedropper is armed and the next click in the world takes its colour. */
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
  onClear: () => void;
}) {
  const { h, s, v } = useMemo(() => hexToHsv(brush.color), [brush.color]);
  // The colours this tab has painted with. Client-side and in memory only —
  // `palette.ts` says why a history beat a fixed row of presets.
  const recent = useSyncExternalStore(subscribeColors, recentColors);

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="absolute bottom-4 right-4 flex select-none items-center gap-3 rounded-xl bg-black/70 px-5 py-3.5 font-mono text-base text-neutral-200 backdrop-blur transition hover:bg-black/80"
      >
        <span
          className="h-5 w-5 rounded-full border border-white/40"
          style={{ background: brush.color }}
        />
        Paint
      </button>
    );
  }

  return (
    <div
      className="absolute bottom-4 right-4 w-[19rem] select-none rounded-xl bg-black/70 p-4 font-mono text-sm text-neutral-100 backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="uppercase tracking-widest text-neutral-400">Paint</span>
        <button
          onClick={() => onOpenChange(false)}
          title="Minimise"
          className="flex h-8 w-9 items-center justify-center rounded-md border border-neutral-500 text-lg leading-none text-neutral-100 transition hover:bg-neutral-600"
        >
          ▾
        </button>
      </div>

      <ColorWheel
        h={h}
        s={s}
        v={v}
        onPick={(hue, sat) => onBrush({ ...brush, color: hsvToHex(hue, sat, v || 1) })}
      />

      <label className="mt-4 block text-xs uppercase tracking-wide text-neutral-400">
        Brightness
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={v}
          onChange={(e) => onBrush({ ...brush, color: hsvToHex(h, s, Number(e.target.value)) })}
          className="mt-1.5 h-2.5 w-full cursor-pointer accent-neutral-200"
        />
      </label>
      <label className="mt-3 block text-xs uppercase tracking-wide text-neutral-400">
        Brush size
        <input
          type="range"
          min={MIN_SIZE}
          max={MAX_SIZE}
          step={0.005}
          value={brush.size}
          onChange={(e) => onBrush({ ...brush, size: Number(e.target.value) })}
          className="mt-1.5 h-2.5 w-full cursor-pointer accent-neutral-300"
        />
      </label>
      <p className="mt-1.5 text-xs leading-tight text-neutral-500">
        or right-drag across your body
      </p>

      {/* The three actions, one row, one size. They were scattered — pick full
          width here, white and clear tucked in beside the size readout — which
          made three equal choices look like one heading and two footnotes. */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <button
          onClick={() => onPickingChange(!picking)}
          title="Take a colour from the world (F)"
          className={`flex h-10 items-center justify-center gap-1.5 rounded-md border transition ${
            picking
              ? "border-white bg-white/15 text-white"
              : "border-neutral-600 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          <span aria-hidden>◎</span>
          pick
          <span className={picking ? "text-neutral-300" : "text-neutral-500"}>F</span>
        </button>
        <button
          onClick={() => onBrush({ ...brush, color: WHITE })}
          title="Back to plain white"
          className="flex h-10 items-center justify-center rounded-md border border-neutral-600 text-neutral-300 transition hover:bg-neutral-700"
        >
          white
        </button>
        <button
          onClick={onClear}
          title="Wipe the paint off your body"
          className="flex h-10 items-center justify-center rounded-md border border-neutral-600 text-neutral-300 transition hover:bg-neutral-700"
        >
          clear
        </button>
      </div>

      {/* Empty until something has been painted, and nothing stands in for it:
          a row of placeholders is a row of buttons that do nothing. */}
      {recent.length > 0 && (
        <>
          <div className="mt-3 text-xs uppercase tracking-wide text-neutral-400">
            Recent
          </div>
          <div className="mt-1.5 grid grid-cols-5 gap-2">
            {recent.map((hex) => (
              <button
                key={hex}
                onClick={() => onBrush({ ...brush, color: hex })}
                title={hex}
                style={{ background: hex }}
                className={`h-9 rounded-md border transition ${
                  brush.color.toLowerCase() === hex
                    ? "border-white"
                    : "border-white/20 hover:border-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center gap-2.5 text-xs text-neutral-400">
        <span
          className="rounded-full border border-white/30"
          style={{
            background: brush.color,
            width: 8 + brush.size * 56,
            height: 8 + brush.size * 56,
          }}
        />
        {brush.color}
      </div>
    </div>
  );
}
