import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

// Spends the shadow budget on the lamps nearest the camera, so shadows follow
// the player. Demotion disposes the shadow map (~33 MB per point cube at
// 1024) — otherwise walking the map collects them all.
export function ShadowBudget({ lamps, budget }: { lamps: THREE.Light[]; budget: number }) {
  const casting = useRef<Set<THREE.Light>>(new Set());
  const due = useRef(0);

  useFrame(({ camera }, delta) => {
    due.current -= delta;
    if (due.current > 0) return;
    // 4 Hz — promotion allocates. Sixty Hz swaps the set on equidistant frames.
    due.current = 0.25;

    const at = camera.getWorldPosition(scratch);
    const nearest = lamps
      .map((light) => ({ light, d: light.getWorldPosition(probe).distanceToSquared(at) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, budget)
      .map((entry) => entry.light);

    const wanted = new Set(nearest);
    for (const light of casting.current) {
      if (wanted.has(light)) continue;
      light.castShadow = false;
      (light as THREE.PointLight).shadow?.dispose();
    }
    for (const light of wanted) light.castShadow = true;
    casting.current = wanted;
  });

  return null;
}

const scratch = new THREE.Vector3();
const probe = new THREE.Vector3();
