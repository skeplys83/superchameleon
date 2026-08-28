import * as THREE from "three";

/**
 * Painting on the body rather than on its texture.
 *
 * A brush dab is a *sphere in the body's own space*, not a circle in UV space.
 * Drawing a circle into the texture was wrong in two visible ways: a dab that
 * reached the edge of a UV island spilled onto whatever island happened to be
 * packed beside it — paint appearing somewhere you never touched — and the same
 * dab was cut along the seam, which is the torn, notched edge it left behind.
 *
 * Here a texel is painted if and only if the point on the body it belongs to is
 * inside the sphere, so seams stop existing as far as the brush is concerned:
 * both sides of a cut are painted from the same test, and no unrelated island
 * is ever touched.
 */

export type Surface = {
  /** Bind-space vertex positions, UVs, and the triangle index. */
  pos: Float32Array;
  uv: Float32Array;
  tri: Uint32Array;
  /** One face normal per triangle, so a dab cannot paint through the body. */
  faceNormal: Float32Array;
  /** Triangles bucketed by UV cell, for finding what a hit's UV landed on. */
  uvGrid: Map<number, number[]>;
  /** Triangles bucketed by position, for finding what a sphere reaches. */
  posGrid: Map<number, number[]>;
  cell: number;
  /** Texel coverage and the padding map, built on first use — see `coverage`. */
  pad: Pad | null;
};

/**
 * Which texels the model actually covers, and where the ones just outside it
 * should copy their colour from.
 *
 * A texture is sampled with bilinear filtering and mipmaps, so at the edge of a
 * UV island the GPU mixes painted texels with the empty gutter beside them. On
 * a white canvas that reads as a **white hairline tracing every seam** across
 * the body. The cure is standard and has to happen on every write: paint the
 * gutter too, by copying outward from the nearest covered texel.
 */
type Pad = {
  size: number;
  covered: Uint8Array;
  /** Reused by `settleGutter`, which is a breadth-first walk of the whole
   *  atlas and would otherwise allocate four megabytes every time it runs. */
  queue: Int32Array;
};

/** How far paint is pushed into the gutter. Enough for bilinear and the first
 *  couple of mip levels; beyond that a seam is cheaper to leave than to pad. */
const PAD_TEXELS = 6;

const UV_CELLS = 64;
/** In figure-local units. A brush is ~0.06, so this keeps buckets small but
 *  means a dab rarely touches more than a handful of them. */
const POS_CELL = 0.08;

const key3 = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);

function push(map: Map<number, number[]>, k: number, v: number) {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}

export function buildSurface(geometry: THREE.BufferGeometry): Surface | null {
  const position = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  const index = geometry.index;
  if (!position || !uvAttr || !index) return null;

  const pos = new Float32Array(position.array as ArrayLike<number>);
  const uv = new Float32Array(uvAttr.array as ArrayLike<number>);
  const tri = new Uint32Array(index.array as ArrayLike<number>);
  const count = tri.length / 3;
  const faceNormal = new Float32Array(count * 3);
  const uvGrid = new Map<number, number[]>();
  const posGrid = new Map<number, number[]>();

  for (let t = 0; t < count; t++) {
    const a = tri[t * 3] * 3;
    const b = tri[t * 3 + 1] * 3;
    const c = tri[t * 3 + 2] * 3;

    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    faceNormal[t * 3] = nx;
    faceNormal[t * 3 + 1] = ny;
    faceNormal[t * 3 + 2] = nz;

    const ia = tri[t * 3] * 2;
    const ib = tri[t * 3 + 1] * 2;
    const ic = tri[t * 3 + 2] * 2;
    const u0 = Math.min(uv[ia], uv[ib], uv[ic]);
    const u1 = Math.max(uv[ia], uv[ib], uv[ic]);
    const v0 = Math.min(uv[ia + 1], uv[ib + 1], uv[ic + 1]);
    const v1 = Math.max(uv[ia + 1], uv[ib + 1], uv[ic + 1]);
    for (let gy = Math.floor(v0 * UV_CELLS); gy <= Math.floor(v1 * UV_CELLS); gy++) {
      for (let gx = Math.floor(u0 * UV_CELLS); gx <= Math.floor(u1 * UV_CELLS); gx++) {
        push(uvGrid, gy * UV_CELLS + gx, t);
      }
    }

    const x0 = Math.min(pos[a], pos[b], pos[c]);
    const x1 = Math.max(pos[a], pos[b], pos[c]);
    const y0 = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]);
    const y1 = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
    const z0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]);
    const z1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
    for (let gz = Math.floor(z0 / POS_CELL); gz <= Math.floor(z1 / POS_CELL); gz++) {
      for (let gy = Math.floor(y0 / POS_CELL); gy <= Math.floor(y1 / POS_CELL); gy++) {
        for (let gx = Math.floor(x0 / POS_CELL); gx <= Math.floor(x1 / POS_CELL); gx++) {
          push(posGrid, key3(gx, gy, gz), t);
        }
      }
    }
  }

  return { pos, uv, tri, faceNormal, uvGrid, posGrid, cell: POS_CELL, pad: null };
}

/** Barycentric weights of a point in a triangle's UV, or null if outside. */
function barycentric(
  s: Surface,
  t: number,
  u: number,
  v: number,
): [number, number, number] | null {
  const ia = s.tri[t * 3] * 2;
  const ib = s.tri[t * 3 + 1] * 2;
  const ic = s.tri[t * 3 + 2] * 2;
  const ax = s.uv[ia];
  const ay = s.uv[ia + 1];
  const bx = s.uv[ib] - ax;
  const by = s.uv[ib + 1] - ay;
  const cx = s.uv[ic] - ax;
  const cy = s.uv[ic + 1] - ay;
  const den = bx * cy - cx * by;
  if (Math.abs(den) < 1e-12) return null;
  const px = u - ax;
  const py = v - ay;
  const w1 = (px * cy - cx * py) / den;
  const w2 = (bx * py - px * by) / den;
  const w0 = 1 - w1 - w2;
  const e = -1e-6;
  return w0 >= e && w1 >= e && w2 >= e ? [w0, w1, w2] : null;
}

/**
 * Where on the body a UV lands: its position and the face normal there.
 *
 * A hit exactly on an island edge belongs to no triangle by the strict test, so
 * the nearest one in the same bucket is taken instead — otherwise a click on a
 * seam silently paints nothing.
 */
export function locate(s: Surface, u: number, v: number) {
  const gx = Math.floor(u * UV_CELLS);
  const gy = Math.floor(v * UV_CELLS);
  const bucket = s.uvGrid.get(gy * UV_CELLS + gx);
  if (!bucket) return null;
  let nearest = -1;
  let nearestD = Infinity;
  for (const t of bucket) {
    const w = barycentric(s, t, u, v);
    if (!w) {
      const ia = s.tri[t * 3] * 2;
      const d = Math.hypot(s.uv[ia] - u, s.uv[ia + 1] - v);
      if (d < nearestD) {
        nearestD = d;
        nearest = t;
      }
      continue;
    }
    const a = s.tri[t * 3] * 3;
    const b = s.tri[t * 3 + 1] * 3;
    const c = s.tri[t * 3 + 2] * 3;
    return {
      x: w[0] * s.pos[a] + w[1] * s.pos[b] + w[2] * s.pos[c],
      y: w[0] * s.pos[a + 1] + w[1] * s.pos[b + 1] + w[2] * s.pos[c + 1],
      z: w[0] * s.pos[a + 2] + w[1] * s.pos[b + 2] + w[2] * s.pos[c + 2],
      nx: s.faceNormal[t * 3],
      ny: s.faceNormal[t * 3 + 1],
      nz: s.faceNormal[t * 3 + 2],
    };
  }
  if (nearest < 0) return null;
  const a = s.tri[nearest * 3] * 3;
  return {
    x: s.pos[a],
    y: s.pos[a + 1],
    z: s.pos[a + 2],
    nx: s.faceNormal[nearest * 3],
    ny: s.faceNormal[nearest * 3 + 1],
    nz: s.faceNormal[nearest * 3 + 2],
  };
}

/**
 * How soft the edge of a dab is, as a fraction of its radius — about one texel
 * at the default brush size. The edge is meant to read as *sharp*; this exists
 * only so it is not a staircase of hard texels.
 */
const FEATHER = 0.05;
/** A dab may not wrap onto a surface facing away from the one it landed on —
 *  otherwise painting between the thighs paints both of them. */
const FACING_MIN = 0.0;

export type Dirty = { x0: number; y0: number; x1: number; y1: number } | null;

/** Rasterise every triangle once to learn which texels the body covers, then
 *  flood outward from them so each gutter texel knows what to mirror. */
function coverage(s: Surface, size: number): Pad {
  if (s.pad && s.pad.size === size) return s.pad;
  const covered = new Uint8Array(size * size);
  const count = s.tri.length / 3;
  for (let t = 0; t < count; t++) {
    const ia = s.tri[t * 3] * 2;
    const ib = s.tri[t * 3 + 1] * 2;
    const ic = s.tri[t * 3 + 2] * 2;
    const u0 = Math.max(0, Math.floor(Math.min(s.uv[ia], s.uv[ib], s.uv[ic]) * size) - 1);
    const u1 = Math.min(size - 1, Math.ceil(Math.max(s.uv[ia], s.uv[ib], s.uv[ic]) * size));
    const v0 = Math.max(0, Math.floor(Math.min(s.uv[ia + 1], s.uv[ib + 1], s.uv[ic + 1]) * size) - 1);
    const v1 = Math.min(size - 1, Math.ceil(Math.max(s.uv[ia + 1], s.uv[ib + 1], s.uv[ic + 1]) * size));
    for (let ty = v0; ty <= v1; ty++) {
      for (let tx = u0; tx <= u1; tx++) {
        if (covered[ty * size + tx]) continue;
        if (barycentric(s, t, (tx + 0.5) / size, (ty + 0.5) / size)) covered[ty * size + tx] = 1;
      }
    }
  }

  s.pad = { size, covered, queue: new Int32Array(size * size) };
  return s.pad;
}

/**
 * Grow the body outward across the whole atlas: every texel off the model takes
 * the colour of the nearest texel on it.
 *
 * **Padding alone cannot fix a mipmapped atlas.** The flood in `dab` reaches
 * `PAD_TEXELS`, which covers bilinear and the first couple of mip levels — but
 * the unwrap covers only about a quarter of the texture, so that flood is under
 * a tenth of the gutter. Everything past it is still whatever the canvas was
 * cleared to, and a hunter sees the world at `HUNT_DPR`, where the figure is
 * about sixty pixels tall against a 1024 atlas — mip four, where one texel is
 * an average of sixteen by sixteen. At that depth the gutter is most of what is
 * being averaged, and since a blank canvas is white, a body painted black comes
 * back ringed in white speckle.
 *
 * This used to fill that far gutter with **one average of the whole body**,
 * which fails on any body that is not one colour: a chameleon with black legs
 * and unpainted white arms averages to pale grey, so the legs sat in a pale
 * field and every seam and silhouette wore a thin light stripe wherever
 * anisotropy or a mip reached seven texels off the island. The fix is the
 * standard one and it is not an average at all — dilate. A nearest-body colour
 * everywhere means a deep mip averages the body against more of the same body,
 * whatever is painted where.
 *
 * A breadth-first walk of the atlas from every covered texel at once, so the
 * colour a gutter texel inherits is the nearest one by chessboard distance.
 * Costly enough to be worth doing on a debounce rather than per dab — see
 * `skin.ts`. Returns false when the model covers nothing.
 */
export function settleGutter(s: Surface, image: ImageData): boolean {
  const size = image.width;
  const pad = coverage(s, size);
  const data = image.data;
  const queue = pad.queue;

  let tail = 0;
  for (let i = 0; i < pad.covered.length; i++) if (pad.covered[i]) queue[tail++] = i;
  if (!tail) return false;

  // `covered` doubles as the visited mark: a gutter texel is set the moment it
  // is claimed, so the first island to reach it wins and nothing is queued twice.
  const seen = pad.covered.slice();
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % size;
    const y = (i / size) | 0;
    const from = i * 4;
    const x0 = x > 0 ? -1 : 0;
    const x1 = x < size - 1 ? 1 : 0;
    const y0 = y > 0 ? -1 : 0;
    const y1 = y < size - 1 ? 1 : 0;
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const n = (y + dy) * size + (x + dx);
        if (seen[n]) continue;
        seen[n] = 1;
        const to = n * 4;
        data[to] = data[from];
        data[to + 1] = data[from + 1];
        data[to + 2] = data[from + 2];
        data[to + 3] = 255;
        queue[tail++] = n;
      }
    }
  }
  return true;
}

/**
 * Paint one dab into `image`, returning the texel rectangle it touched.
 * `radius` is in figure-local units, the same units the brush is sized in.
 */
export function dab(
  s: Surface,
  image: ImageData,
  u: number,
  v: number,
  radius: number,
  color: [number, number, number],
): Dirty {
  const hit = locate(s, u, v);
  if (!hit) return null;

  const size = image.width;
  const data = image.data;
  const r2 = radius * radius;
  const inner = radius * (1 - FEATHER);
  const seen = new Set<number>();
  const touched: number[] = [];
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;

  const g0 = Math.floor((hit.x - radius) / s.cell);
  const g1 = Math.floor((hit.x + radius) / s.cell);
  const h0 = Math.floor((hit.y - radius) / s.cell);
  const h1 = Math.floor((hit.y + radius) / s.cell);
  const i0 = Math.floor((hit.z - radius) / s.cell);
  const i1 = Math.floor((hit.z + radius) / s.cell);

  for (let gz = i0; gz <= i1; gz++) {
    for (let gy = h0; gy <= h1; gy++) {
      for (let gx = g0; gx <= g1; gx++) {
        const bucket = s.posGrid.get(key3(gx, gy, gz));
        if (!bucket) continue;
        for (const t of bucket) {
          if (seen.has(t)) continue;
          seen.add(t);

          const facing =
            s.faceNormal[t * 3] * hit.nx +
            s.faceNormal[t * 3 + 1] * hit.ny +
            s.faceNormal[t * 3 + 2] * hit.nz;
          if (facing < FACING_MIN) continue;

          // Cheap reject before rasterising: a bucket is coarser than the dab,
          // so most of what it hands back is out of reach. Skipping those here
          // is the difference between ~10 ms a dab and under one.
          const qa = s.tri[t * 3] * 3;
          const qb = s.tri[t * 3 + 1] * 3;
          const qc = s.tri[t * 3 + 2] * 3;
          if (
            Math.min(s.pos[qa], s.pos[qb], s.pos[qc]) > hit.x + radius ||
            Math.max(s.pos[qa], s.pos[qb], s.pos[qc]) < hit.x - radius ||
            Math.min(s.pos[qa + 1], s.pos[qb + 1], s.pos[qc + 1]) > hit.y + radius ||
            Math.max(s.pos[qa + 1], s.pos[qb + 1], s.pos[qc + 1]) < hit.y - radius ||
            Math.min(s.pos[qa + 2], s.pos[qb + 2], s.pos[qc + 2]) > hit.z + radius ||
            Math.max(s.pos[qa + 2], s.pos[qb + 2], s.pos[qc + 2]) < hit.z - radius
          ) {
            continue;
          }

          const ia = s.tri[t * 3] * 2;
          const ib = s.tri[t * 3 + 1] * 2;
          const ic = s.tri[t * 3 + 2] * 2;
          const pa = s.tri[t * 3] * 3;
          const pb = s.tri[t * 3 + 1] * 3;
          const pc = s.tri[t * 3 + 2] * 3;

          const tu0 = Math.max(0, Math.floor(Math.min(s.uv[ia], s.uv[ib], s.uv[ic]) * size) - 1);
          const tu1 = Math.min(size - 1, Math.ceil(Math.max(s.uv[ia], s.uv[ib], s.uv[ic]) * size));
          const tv0 = Math.max(
            0,
            Math.floor(Math.min(s.uv[ia + 1], s.uv[ib + 1], s.uv[ic + 1]) * size) - 1,
          );
          const tv1 = Math.min(
            size - 1,
            Math.ceil(Math.max(s.uv[ia + 1], s.uv[ib + 1], s.uv[ic + 1]) * size),
          );

          for (let ty = tv0; ty <= tv1; ty++) {
            for (let tx = tu0; tx <= tu1; tx++) {
              const w = barycentric(s, t, (tx + 0.5) / size, (ty + 0.5) / size);
              if (!w) continue;
              const px = w[0] * s.pos[pa] + w[1] * s.pos[pb] + w[2] * s.pos[pc];
              const py = w[0] * s.pos[pa + 1] + w[1] * s.pos[pb + 1] + w[2] * s.pos[pc + 1];
              const pz = w[0] * s.pos[pa + 2] + w[1] * s.pos[pb + 2] + w[2] * s.pos[pc + 2];
              const dx = px - hit.x;
              const dy = py - hit.y;
              const dz = pz - hit.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > r2) continue;

              const d = Math.sqrt(d2);
              const alpha = d <= inner ? 1 : (radius - d) / (radius - inner);
              const o = (ty * size + tx) * 4;
              data[o] += (color[0] - data[o]) * alpha;
              data[o + 1] += (color[1] - data[o + 1]) * alpha;
              data[o + 2] += (color[2] - data[o + 2]) * alpha;
              data[o + 3] = 255;
              touched.push(ty * size + tx);
              if (tx < x0) x0 = tx;
              if (ty < y0) y0 = ty;
              if (tx > x1) x1 = tx;
              if (ty > y1) y1 = ty;
            }
          }
        }
      }
    }
  }

  if (x1 < 0) return null;

  // Push this dab into the gutter around every island it touched, or the seams
  // show as white hairlines the moment the texture is filtered. The flood
  // starts from *this dab's* texels rather than from a precomputed map: a
  // gutter texel can sit between two islands, and it has to mirror the one that
  // was just painted, not whichever a one-time pass happened to pick.
  const pad = coverage(s, size);
  const done = new Set<number>(touched);
  let frontier = touched;
  for (let step = 0; step < PAD_TEXELS && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % size;
      const y = (i / size) | 0;
      const from = i * 4;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const n = ny * size + nx;
          if (pad.covered[n] || done.has(n)) continue;
          done.add(n);
          const to = n * 4;
          data[to] = data[from];
          data[to + 1] = data[from + 1];
          data[to + 2] = data[from + 2];
          data[to + 3] = 255;
          next.push(n);
          if (nx < x0) x0 = nx;
          if (ny < y0) y0 = ny;
          if (nx > x1) x1 = nx;
          if (ny > y1) y1 = ny;
        }
      }
    }
    frontier = next;
  }

  return { x0, y0, x1, y1 };
}
