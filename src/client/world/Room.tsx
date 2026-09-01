import { Suspense, useEffect } from "react";
import { Sky, useGLTF } from "@react-three/drei";
import { beginLoading } from "@/client/app/loading";
import { MAPS, safeMapId, type GameMap } from "@/shared/maps";
import { GltfLevel } from "./GltfLevel";
import { bumpSurfaces } from "./surface";

export { ROOM_SURFACE } from "./surface";
export { ROOM_HALF } from "@/shared/protocol";

/**
 * Where the sun sits, for the maps that are open to it. **No map sets
 * `sky` today** — the lobby was the last one and is now a closed cavern — so
 * this draws nothing until an outdoor map arrives. It is kept because `sky` is
 * part of the map schema rather than dead code, and because the number is hard
 * won: at the 23° elevation this used to be, shadows raked the old arena end to
 * end and the shadow map striped with acne, the depth error across a texel
 * going as 1/tan(elevation). **A map that turns `sky` back on has to aim its
 * own key light along this**, or the sky and the shadows disagree.
 */
const SUN: [number, number, number] = [100, 150, 100];

/** Whichever map this room is playing. */
export function Room({ map }: { map: string }) {
  const chosen = MAPS[safeMapId(map)];
  return (
    <>
      <color attach="background" args={[chosen.background]} />
      {chosen.sky && <Sky sunPosition={SUN} />}
      {/* No light of any kind here, for any map — invariant 15. The old arena
          used to be the exception because its `.glb` carried none; every map
          has shipped its own since, the lobby included. */}
      {/* Scoped tightly around the map and nothing else. A map suspends while
          its file arrives, and a `Suspense` any higher would blank the player
          with it — the same trap `<Environment>` set. */}
      <Suspense fallback={<Loading />}>
        <Mounted map={chosen} />
      </Suspense>
    </>
  );
}

/** The fallback: it draws nothing, and says the player is waiting. */
function Loading() {
  useEffect(beginLoading, []);
  return null;
}

/** Tells the rest of the game the world's surfaces have changed. */
function Mounted({ map }: { map: GameMap }) {
  useEffect(() => {
    bumpSurfaces();
    return bumpSurfaces;
  }, [map]);

  /** The file, before a single collider exists — invariant 8. */
  useGLTF(map.src);

  return <GltfLevel level={map} />;
}
