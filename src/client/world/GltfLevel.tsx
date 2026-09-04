import { useEffect, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import {
  BallCollider,
  ConvexHullCollider,
  CuboidCollider,
  TrimeshCollider,
} from "@react-three/rapier";
import type * as THREE from "three";
import { ROOM_SURFACE } from "./surface";
import { useDevMode } from "@/client/app/dev";
import { checkLevel, prepareLevel, type LevelCollider } from "./levelScene";
import { ShadowBudget } from "./ShadowBudget";
import type { GameMap } from "@/shared/maps";

export function GltfLevel({ level }: { level: GameMap }) {
  const { scene } = useGLTF(level.src);
  const showCollision = useDevMode();

  // useMemo (not effect) so ROOM_SURFACE meshes exist by the time Player
  // collects them (invariant 9).
  const prepared = useMemo(
    () =>
      prepareLevel(scene, { lights: level.render.lights, matte: level.render.matte }),
    [scene, level.render.lights, level.render.matte],
  );

  useEffect(() => {
    if (import.meta.env.DEV) checkLevel(level, prepared);
  }, [level, prepared]);

  return (
    <>
      {/* No lights added here — every lamp is in the .blend (invariant 15). */}
      <primitive object={prepared.scene} />
      {(level.render.lights?.shadow?.budget ?? 0) > 0 && (
        <ShadowBudget lamps={prepared.lamps} budget={level.render.lights!.shadow!.budget!} />
      )}
      {prepared.colliders.map((collider, i) => (
        <Collider key={i} collider={collider} show={showCollision} />
      ))}
    </>
  );
}

// The invisible mesh a shot, ground test and camera raycast — colliders alone
// are walls you can shoot through.
function Proxy({
  children,
  show,
  shell = false,
  ...placement
}: {
  children?: ReactNode;
  show: boolean;
  shell?: boolean;
  geometry?: THREE.BufferGeometry;
  position?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
}) {
  return (
    <mesh name={ROOM_SURFACE} userData={SHELL_FLAG(shell)} {...placement}>
      {children}
      {/* visible on the MATERIAL, not the mesh — three's raycaster skips an
          object whose own visible is false, and this must stay findable. */}
      <meshBasicMaterial
        visible={show}
        wireframe
        color="#39ff88"
        toneMapped={false}
      />
    </mesh>
  );
}

const NOT_SHELL = { shell: false };
const IS_SHELL = { shell: true };
const SHELL_FLAG = (shell: boolean) => (shell ? IS_SHELL : NOT_SHELL);

function Collider({ collider, show }: { collider: LevelCollider; show: boolean }) {
  switch (collider.kind) {
    case "cuboid": {
      const { half, position, quaternion } = collider;
      return (
        <>
          <CuboidCollider args={half} position={position} quaternion={quaternion} />
          <Proxy show={show} shell={collider.shell} position={position} quaternion={quaternion}>
            <boxGeometry args={[half[0] * 2, half[1] * 2, half[2] * 2]} />
          </Proxy>
        </>
      );
    }
    case "ball": {
      const { radius, position, quaternion } = collider;
      return (
        <>
          <BallCollider args={[radius]} position={position} quaternion={quaternion} />
          <Proxy show={show} shell={collider.shell} position={position} quaternion={quaternion}>
            <sphereGeometry args={[radius, 16, 12]} />
          </Proxy>
        </>
      );
    }
    case "hull":
      return (
        <>
          <ConvexHullCollider args={[collider.vertices]} />
          <Proxy show={show} shell={collider.shell} geometry={collider.geometry} />
        </>
      );
    case "trimesh":
      return (
        <>
          <TrimeshCollider args={[collider.vertices, collider.indices]} />
          <Proxy show={show} shell={collider.shell} geometry={collider.geometry} />
        </>
      );
  }
}
