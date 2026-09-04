import { Suspense, useEffect } from "react";
import { Sky, useGLTF } from "@react-three/drei";
import { beginLoading } from "@/client/app/loading";
import { MAPS, safeMapId, type GameMap } from "@/shared/maps";
import { GltfLevel } from "./GltfLevel";
import { bumpSurfaces } from "./surface";

export { ROOM_SURFACE } from "./surface";
export { ROOM_HALF } from "@/shared/protocol";

// No map currently sets sky. A map that turns it on must aim its own key
// light along this — else the sky and the shadows disagree.
const SUN: [number, number, number] = [100, 150, 100];

export function Room({ map }: { map: string }) {
  const chosen = MAPS[safeMapId(map)];
  return (
    <>
      <color attach="background" args={[chosen.background]} />
      {chosen.sky && <Sky sunPosition={SUN} />}
      {/* No lights here for any map — invariant 15. Suspense scoped to the
          map only; a Suspense any higher blanks the player with it. */}
      <Suspense fallback={<Loading />}>
        <Mounted map={chosen} />
      </Suspense>
    </>
  );
}

function Loading() {
  useEffect(beginLoading, []);
  return null;
}

function Mounted({ map }: { map: GameMap }) {
  useEffect(() => {
    bumpSurfaces();
    return bumpSurfaces;
  }, [map]);

  // Load the file before any collider exists — invariant 8.
  useGLTF(map.src);

  return <GltfLevel level={map} />;
}
