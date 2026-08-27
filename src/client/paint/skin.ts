import * as THREE from "three";
import { characterGeometry } from "@/client/figure/model";
import { buildSurface, dab, settleGutter, type Surface } from "./surface";
import { MAX_STROKES } from "@/shared/protocol";

/** Per-player paint. One canvas per body: the body is a single skinned mesh
 *  wearing a single continuous unwrap, so a stroke is just a point in that
 *  unwrap and there is no per-part bookkeeping at all. */

export type Skin = THREE.CanvasTexture;

export type Stroke = {
  u: number;
  v: number;
  /** Brush radius in figure-local units — the same physical dot everywhere on the body. */
  size: number;
  color: string;
};

const TEXTURE_SIZE = 1024;

/** Built once from the model, the first time anybody paints. */
let surface: Surface | null = null;
function getSurface() {
  if (!surface) {
    const geometry = characterGeometry();
    if (geometry) surface = buildSurface(geometry);
  }
  return surface;
}

/** The canvas behind a skin, kept as pixels so a dab can be composited without
 *  reading the whole texture back on every dot. */
type Painted = { texture: Skin; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData };
const painted = new Map<string, Painted>();

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Everything painted on a body, so a part re-mount can repaint from scratch. */
const skins = new Map<string, Skin>();
const history = new Map<string, Stroke[]>();

/** Local player's id in these maps; remotes use their Colyseus session id. */
export const SELF = "self";

export { MAX_STROKES };

function blank(id: string): Painted {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.flipY = false;
  const entry = { texture, canvas, ctx, image: ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE) };
  painted.set(id, entry);
  skins.set(id, texture);
  return entry;
}

export function getSkin(id: string): Skin {
  return skins.get(id) ?? blank(id).texture;
}

export function paint(id: string, stroke: Stroke) {
  const entry = painted.get(id) ?? blank(id);
  const s = getSurface();
  if (!s) return;

  // The dab is a sphere on the body, so it cannot leak across a UV seam onto a
  // limb you never touched — see `surface.ts`.
  const rect = dab(s, entry.image, stroke.u, stroke.v, stroke.size, hexToRgb(stroke.color));
  if (rect) {
    entry.ctx.putImageData(
      entry.image,
      0,
      0,
      rect.x0,
      rect.y0,
      rect.x1 - rect.x0 + 1,
      rect.y1 - rect.y0 + 1,
    );
    entry.texture.needsUpdate = true;
  }

  const log = history.get(id) ?? [];
  log.push(stroke);
  if (log.length > MAX_STROKES) log.splice(0, log.length - MAX_STROKES);
  history.set(id, log);

  settleSoon(id);
}

/** How long after the last dab the gutter is repainted. Long enough that a
 *  drag pays for it once rather than per dab, short enough to be over before
 *  anyone looks at the result. */
const SETTLE_MS = 200;
const settling = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Repaint the far gutter once the brush stops moving — the deep-mip fix, see
 * `settleGutter` in `surface.ts`.
 *
 * **Debounced, and it walks the whole atlas**, which is why it does not live in
 * `paint`: a drag is hundreds of dabs a second and this is a megapixel pass.
 * Nothing depends on it having run — it changes only what the far mips average
 * to, so a frame drawn before it lands is the old halo for another fifth of a
 * second.
 */
function settleSoon(id: string) {
  clearTimeout(settling.get(id));
  settling.set(
    id,
    setTimeout(() => {
      settling.delete(id);
      const entry = painted.get(id);
      const s = getSurface();
      if (!entry || !s) return;
      if (!settleGutter(s, entry.image)) return;
      entry.ctx.putImageData(entry.image, 0, 0);
      entry.texture.needsUpdate = true;
    }, SETTLE_MS),
  );
}

export function clearSkin(id: string) {
  const entry = painted.get(id);
  if (!entry) return;
  // A settle still pending would repaint the gutter from the body it no longer
  // has, a fifth of a second after the wipe.
  clearTimeout(settling.get(id));
  settling.delete(id);
  entry.ctx.fillStyle = "#ffffff";
  entry.ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  entry.image = entry.ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  entry.texture.needsUpdate = true;
  history.set(id, []);
}

/** Drop every body's paint, yours included. */
export function forgetAllSkins() {
  for (const id of [...skins.keys()]) forgetSkin(id);
}

export function forgetSkin(id: string) {
  skins.get(id)?.dispose();
  skins.delete(id);
  painted.delete(id);
  history.delete(id);
}

/** Compact wire form — strokes are stored per player on the server, so they
 *  have to stay small. `u,v,size,rrggbb`, about 24 characters. */
export function encodeStroke(s: Stroke) {
  return [s.u.toFixed(3), s.v.toFixed(3), s.size.toFixed(3), s.color.replace("#", "")].join(",");
}

export function decodeStroke(raw: string): Stroke | null {
  const [u, v, size, color] = raw.split(",");
  if (!/^[0-9a-fA-F]{6}$/.test(color ?? "")) return null;
  const stroke = {
    u: Number(u),
    v: Number(v),
    size: Number(size),
    color: `#${color}`,
  };
  return Number.isFinite(stroke.u) && Number.isFinite(stroke.v) && Number.isFinite(stroke.size)
    ? stroke
    : null;
}
