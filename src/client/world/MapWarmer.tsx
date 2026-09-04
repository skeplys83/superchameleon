import { Suspense, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAPS, safeMapId } from "@/shared/maps";

// Uploads the next map's textures one per frame in the lobby, so the hunter
// does not pay ~900 MB of synchronous mipmap builds at the bell.

// One per frame — a single 4096² is already tens of ms.
const PER_FRAME = 1;

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
  // Suspends until parsed — caller wraps in its own Suspense so the current
  // map is not blanked.
  const { scene } = useGLTF(src);
  const gl = useThree((state) => state.gl);
  const queue = useRef<THREE.Texture[] | null>(null);

  useFrame(() => {
    queue.current ??= texturesOf(scene);
    const left = queue.current;
    for (let i = 0; i < PER_FRAME && left.length; i++) {
      const texture = left.pop();
      if (texture) gl.initTexture(texture);
    }
  });

  return null;
}

export function MapWarmer({ id, current }: { id?: string | null; current: string }) {
  if (!id || safeMapId(id) === safeMapId(current)) return null;
  return (
    <Suspense fallback={null}>
      <Warm src={MAPS[safeMapId(id)].src} />
    </Suspense>
  );
}
