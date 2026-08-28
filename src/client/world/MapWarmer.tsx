import { Suspense, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAPS, safeMapId } from "@/shared/maps";

/**
 * Push the next map's textures onto the GPU before anybody stands on it.
 *
 * **`preloadMap` was only ever half the job.** It fetches the `.glb` and parses
 * it — the images are decoded — but a texture does not reach the GPU until the
 * first frame that *draws* it, and that upload is synchronous. The hospital
 * carries 46 images: twenty-seven 2048², three 4096², the rest smaller. That is
 * 177 megapixels, about 900 MB once it is RGBA in video memory with mipmaps,
 * and it all landed on one frame.
 *
 * Chameleons pay it when they are moved to the map at the start of hiding,
 * where thirty-five seconds of standing about hides it. **The hunter pays it at
 * the bell** — the one moment in the round nobody is willing to wait through.
 *
 * So it is paid in the lobby instead, one texture a frame, while the player is
 * walking around a map that is already resident. By the bell there is nothing
 * left to upload.
 */

/** Textures uploaded per frame. One, because a single 4096² is already tens of
 *  milliseconds on its own and the point is to *not* be a hitch — there are
 *  thousands of frames in a lobby and 46 textures to get through. */
const PER_FRAME = 1;

/** Every map slot three is going to have to upload. */
const SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "lightMap",
  "bumpMap",
] as const;

function texturesOf(scene: THREE.Object3D): THREE.Texture[] {
  const seen = new Set<string>();
  const out: THREE.Texture[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const slot of SLOTS) {
        const texture = (material as unknown as Record<string, unknown>)[slot];
        if (!(texture instanceof THREE.Texture)) continue;
        if (seen.has(texture.uuid)) continue;
        seen.add(texture.uuid);
        out.push(texture);
      }
    }
  });
  return out;
}

function Warm({ src }: { src: string }) {
  // Suspends until the file is parsed — which is why the caller wraps this in
  // its own `Suspense`. Nothing else may be inside that boundary: a map still
  // arriving would otherwise blank the room the player is standing in.
  const { scene } = useGLTF(src);
  const gl = useThree((state) => state.gl);
  /** Null until the first frame, so the traverse is not done during render. */
  const queue = useRef<THREE.Texture[] | null>(null);

  useFrame(() => {
    queue.current ??= texturesOf(scene);
    const left = queue.current;
    for (let i = 0; i < PER_FRAME && left.length; i++) {
      const texture = left.pop();
      // Uploads and builds the mipmaps, exactly as the first draw would have.
      if (texture) gl.initTexture(texture);
    }
  });

  return null;
}

/**
 * @param id The map this room is about to send everyone to, or null.
 * @param current The map already on screen — warming that one is work already
 *   done, and a lobby names itself as its own `nextMap` between rounds.
 */
export function MapWarmer({ id, current }: { id?: string | null; current: string }) {
  if (!id || safeMapId(id) === safeMapId(current)) return null;
  return (
    <Suspense fallback={null}>
      <Warm src={MAPS[safeMapId(id)].src} />
    </Suspense>
  );
}
