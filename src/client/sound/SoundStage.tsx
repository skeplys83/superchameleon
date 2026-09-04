import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { onCaught, onShot, onWhistle, remotes } from "@/client/net";
import { playSound, updateListener } from "./engine";
import { Stepper, jitteredStepRate, strideFor } from "./footsteps";

export function SoundStage() {
  const steppers = useRef(new Map<string, Stepper>());

  // Your own shot resolves to no position — remotes never holds you — which
  // is right (a panner at zero distance misbehaves).
  useEffect(
    () =>
      onShot((shooterId) => {
        const shooter = remotes.get(shooterId);
        playSound("shotgun", {
          position: shooter
            ? [shooter.target.x, shooter.target.y, shooter.target.z]
            : undefined,
        });
      }),
    [],
  );

  useEffect(
    () =>
      onWhistle((whistlerId) => {
        const who = remotes.get(whistlerId);
        playSound("whistle", {
          position: who ? [who.target.x, who.target.y, who.target.z] : undefined,
        });
      }),
    [],
  );

  // Positional so hiding chameleons hear roughly where the hunt is closing in.
  useEffect(
    () =>
      onCaught((_victimId, _by, position) => {
        playSound("squash", { position });
      }),
    [],
  );

  // Priority 1 — listener copies the camera, must run after it is placed.
  useFrame(({ camera }, delta) => {
    updateListener(camera);

    const live = steppers.current;
    for (const [id, remote] of remotes) {
      let stepper = live.get(id);
      if (!stepper) {
        stepper = new Stepper(strideFor(remote.role));
        live.set(id, stepper);
      }
      const { x, y, z } = remote.target;
      // Climbing is silent — a wall slide looks like a floor walk to a stepper.
      if (remote.target.cling) {
        stepper.reset();
        continue;
      }
      if (stepper.update(x, y, z, delta)) {
        playSound("step", { position: [x, y, z], rate: jitteredStepRate(remote.role) });
      }
    }

    if (live.size > remotes.size) {
      for (const id of live.keys()) if (!remotes.has(id)) live.delete(id);
    }
  }, 1);

  return null;
}
