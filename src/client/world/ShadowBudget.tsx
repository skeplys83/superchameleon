import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

/**
 * Which lamps cast, decided by where the camera is rather than by their names.
 *
 * **A map has far more lamps than a browser can cast from.** The hospital has
 * 24, and a point light's shadow is a cube — six render passes each, so casting
 * from all of them is 144 passes a frame and casting from three is a hospital
 * with shadows in one room and none in the other nineteen. Naming three of them
 * `shadow_` in Blender only moves the problem: whichever rooms you did not pick
 * have no grounding at all, and the pick is made once, by somebody who is not
 * standing there.
 *
 * So the budget is spent on the lamps **nearest the camera**, and it follows
 * you. Everywhere you stand has shadows; the frame only ever pays for `budget`
 * of them.
 *
 * **Demotion disposes the map.** A lamp that has ever cast keeps its shadow
 * texture — 4096x2048 for a cube at the default 1024, about 33 MB — so leaving
 * them allocated as you walk the map would collect all 24 of them, which is the
 * memory the budget exists to avoid.
 */
export function ShadowBudget({ lamps, budget }: { lamps: THREE.Light[]; budget: number }) {
  const casting = useRef<Set<THREE.Light>>(new Set());
  /** Seconds until the next re-rank. */
  const due = useRef(0);

  useFrame(({ camera }, delta) => {
    due.current -= delta;
    if (due.current > 0) return;
    // **Four times a second, not sixty.** Ranking is cheap but promotion is
    // not — a lamp that starts casting allocates a shadow map — and a camera
    // walking a corridor would otherwise swap the set on any frame two lamps
    // are equidistant.
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
      // Frees the texture; three builds a new one if it is promoted again.
      // Typed off `PointLight` because `Light` itself declares no shadow — only
      // the subclasses that can cast do, and a lamp is always one of those.
      (light as THREE.PointLight).shadow?.dispose();
    }
    for (const light of wanted) light.castShadow = true;
    casting.current = wanted;
  });

  return null;
}

const scratch = new THREE.Vector3();
const probe = new THREE.Vector3();
