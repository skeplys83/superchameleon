import * as THREE from "three";
import { ROOM_SURFACE } from "@/client/world/surface";

// Paint is albedo (a `map` on MeshStandardMaterial). Feeding it the *drawn*
// pixel applies the room's lighting twice — a floor at 40% comes out at 16%.

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const out = new THREE.Color();
const texel = new THREE.Color();

// Decoded pixels per texture — atlases are read back from the GPU-bound image
// once, not per click.
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
      // Tainted canvas — fall back rather than throw on a click.
      data = null;
    }
  }
  decoded.set(texture, data);
  return data;
}

function sample(texture: THREE.Texture, uv: THREE.Vector2): THREE.Color | null {
  const pixels = pixelsOf(texture);
  if (!pixels) return null;

  // Wrap, not clamp — UV outside 0..1 is how tiling is expressed.
  let u = uv.x * texture.repeat.x + texture.offset.x;
  let v = uv.y * texture.repeat.y + texture.offset.y;
  u -= Math.floor(u);
  v -= Math.floor(v);
  // glTF loads flipY off; canvases have it on.
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

// SkinnedMesh excluded — see pick.ts. A click sampling several players would
// drop a frame.
function candidates(scene: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (mesh.name === ROOM_SURFACE) return;
    const material = mesh.material;
    if (!Array.isArray(material) && material.visible === false) return;
    list.push(mesh);
  });
  return list;
}

// Returns null on sky/background — the caller falls back to reading the pixel.
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
