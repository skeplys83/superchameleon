import * as THREE from "three";
import { ROOM_SURFACE } from "@/client/world/surface";

/**
 * The *albedo* under the cursor — the surface's own colour, before any light
 * touched it.
 *
 * **This is what the eyedropper has to return, and reading the drawn pixel is
 * not.** Paint is applied as a `map` on a `MeshStandardMaterial`, so whatever
 * the picker hands back is used as albedo and then lit and tone-mapped like
 * everything else. Feed it the *displayed* pixel and the room's lighting is
 * applied a second time: pick a floor at 40% brightness, paint it on, and the
 * body renders at 16%. That is the "I picked the ground and it came out way
 * darker" — the darker the map, the worse it got, which is why the dungeon
 * showed it and the old white arena barely did.
 *
 * Albedo against albedo is also simply what camouflage means. Two surfaces with
 * the same base colour under the same light render the same colour, which is
 * the whole trick a chameleon is trying to pull.
 *
 * Every map makes this exact rather than approximate: each is a swatch atlas
 * or photographic material with a white base factor, and none carries vertex
 * colours. The two metals in the dungeon are the one place a picked colour
 * flatters — see `paint/CLAUDE.md`.
 */

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const out = new THREE.Color();
const texel = new THREE.Color();

/** Decoded pixels per texture, so an atlas is read back from the GPU-bound
 *  image once rather than on every click. */
const decoded = new WeakMap<THREE.Texture, ImageData | null>();

function pixelsOf(texture: THREE.Texture): ImageData | null {
  const cached = decoded.get(texture);
  if (cached !== undefined) return cached;

  let data: ImageData | null = null;
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (image && width && height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    try {
      ctx?.drawImage(image as CanvasImageSource, 0, 0);
      data = ctx?.getImageData(0, 0, width, height) ?? null;
    } catch {
      // A tainted canvas. Nothing here is cross-origin, but a failed read must
      // fall back to the material's own colour rather than throw on a click.
      data = null;
    }
  }
  decoded.set(texture, data);
  return data;
}

/** The texture's own colour at a UV, in the working (linear) space. */
function sample(texture: THREE.Texture, uv: THREE.Vector2): THREE.Color | null {
  const pixels = pixelsOf(texture);
  if (!pixels) return null;

  // Wrapped rather than clamped: a UV outside 0..1 is how tiling is expressed,
  // and `Math.floor` handles negatives the way `%` does not.
  let u = uv.x * texture.repeat.x + texture.offset.x;
  let v = uv.y * texture.repeat.y + texture.offset.y;
  u -= Math.floor(u);
  v -= Math.floor(v);
  // glTF textures load with `flipY` off, canvases with it on. The row a UV
  // names depends on which.
  if (texture.flipY) v = 1 - v;

  const x = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
  const y = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
  const i = (y * pixels.width + x) * 4;
  texel.setRGB(
    pixels.data[i] / 255,
    pixels.data[i + 1] / 255,
    pixels.data[i + 2] / 255,
    texture.colorSpace === THREE.SRGBColorSpace
      ? THREE.SRGBColorSpace
      : THREE.LinearSRGBColorSpace,
  );
  return texel;
}

type Coloured = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };

function materialAt(mesh: THREE.Mesh, hit: THREE.Intersection): Coloured | null {
  const material = mesh.material;
  if (!Array.isArray(material)) return material as Coloured;
  return (material[hit.face?.materialIndex ?? 0] as Coloured) ?? null;
}

/**
 * Everything worth sampling. Gathered rather than raycast wholesale, because
 * `SkinnedMesh.raycast` re-skins the model per triangle and costs about 6 ms a
 * ray (see `pick.ts`) — with several players on screen a single click would
 * drop a frame. Bodies are excluded on those grounds; scenery is the point.
 */
function candidates(scene: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    // The collision layer is drawn only in developer mode and is never a colour
    // anybody is looking at.
    if (mesh.name === ROOM_SURFACE) return;
    const material = mesh.material;
    if (!Array.isArray(material) && material.visible === false) return;
    list.push(mesh);
  });
  return list;
}

/**
 * The surface colour under a click, as an `#rrggbb` in sRGB, or null when the
 * ray hit nothing with a colour — the sky, or empty background. The caller
 * falls back to reading the drawn pixel there, which for an unlit background is
 * the right answer anyway.
 *
 * `ndcX`/`ndcY` are normalised device coordinates: −1..1, y up.
 */
export function albedoAt(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
): string | null {
  ndc.set(ndcX, ndcY);
  ray.setFromCamera(ndc, camera);
  ray.far = Infinity;

  for (const hit of ray.intersectObjects(candidates(scene), false)) {
    const material = materialAt(hit.object as THREE.Mesh, hit);
    if (!material?.color) continue;
    out.copy(material.color);
    if (material.map && hit.uv) {
      const texel = sample(material.map, hit.uv);
      if (texel) out.multiply(texel);
    }
    return `#${out.getHexString(THREE.SRGBColorSpace)}`;
  }
  return null;
}
