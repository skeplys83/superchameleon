import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { POSES, safePose } from "./poses";
import { CLING_NONE } from "@/shared/protocol";
import { flatFor } from "./flat";
import { getSkin } from "@/client/paint/skin";
import { makeCharacter, preloadCharacter, type Character } from "./model";
import {
  applyPose,
  buildChain,
  copyAngles,
  dampAngles,
  makeAngles,
  poseTargets,
} from "./rig";
import { addWalk, WALK_DAMP, WALK_EPSILON } from "./walk";

const POSE_DAMP = 8;

// Elbow to wrist — the rig ends at the forearm; the shotgun grip is pushed
// down its +Y axis by this.
const FOREARM_LENGTH = 0.58;

const REVEAL_ORDER = 20;
const REVEAL_COLOR = new THREE.Color("#ff2a36");
const REVEAL_HZ = 1.15;

// Shared across every highlighted body — one pulse for the whole scene.
const revealMaterial = new THREE.MeshBasicMaterial({
  color: REVEAL_COLOR,
  toneMapped: false,
  depthTest: false,
  transparent: true,
  // transparent + no depth-write so body parts do not punch holes in each other.
  depthWrite: false,
});

function pulseReveal(elapsed: number) {
  revealMaterial.opacity = (Math.sin(elapsed * Math.PI * 2 * REVEAL_HZ) + 1) / 2;
}

type Rig = {
  character: Character;
  material: THREE.Material;
  overlay: THREE.SkinnedMesh | null;
  chain: ReturnType<typeof buildChain>;
};

const crumple = new THREE.Quaternion();
const CRUMPLE_AXIS = new THREE.Vector3(1, 0, 0);

export function StickFigure({
  scale = 1,
  pose = 0,
  skinId,
  surface = CLING_NONE,
  aim = null,
  holding,
  highlight = false,
  gait = null,
  upright = false,
}: {
  scale?: number;
  // Getters — remote figures change on network patches (no re-render).
  pose?: number | (() => number);
  skinId: string;
  surface?: number | (() => number);
  aim?: (() => number) | null;
  holding?: ReactNode;
  highlight?: boolean;
  upright?: boolean | (() => boolean);
  gait?: (() => number) | null;
}) {
  const root = useRef<THREE.Group>(null);
  const flat = useRef(new THREE.Quaternion());
  const angles = useRef(makeAngles());
  // Damped pose + walk. Kept apart from `angles` — see copyAngles.
  const posed = useRef(makeAngles());
  const target = useRef(makeAngles());
  const walk = useRef({ phase: 0, amp: 0, last: 0, primed: false });
  const skin = getSkin(skinId);

  const grip = useMemo(() => {
    const g = new THREE.Group();
    g.position.y = FOREARM_LENGTH;
    return g;
  }, []);
  const [rig, setRig] = useState<Rig | null>(null);

  // Suspending would tear down the collider — draw nothing until the model
  // lands. Game.tsx starts the fetch on the join click.
  useEffect(() => {
    let live = true;
    let built: Rig | null = null;
    void preloadCharacter().then(() => {
      if (!live) return;
      const character = makeCharacter();
      if (!character) return;

      const material = highlight
        ? new THREE.MeshBasicMaterial({
            map: skin,
            toneMapped: false,
            depthTest: false,
            depthWrite: false,
          })
        : // Matte — a sheen the wall lacks gives the body away before colour does.
          new THREE.MeshStandardMaterial({ map: skin, roughness: 1, metalness: 0 });
      character.mesh.material = material;
      character.mesh.renderOrder = highlight ? REVEAL_ORDER : 0;
      // A body casts no shadow — that cue no amount of paint answers.
      character.mesh.castShadow = false;
      character.mesh.userData.body = true;

      // Second SkinnedMesh sharing the skeleton, so it follows the body free.
      let overlay: THREE.SkinnedMesh | null = null;
      if (highlight) {
        overlay = new THREE.SkinnedMesh(character.mesh.geometry, revealMaterial);
        overlay.bind(character.mesh.skeleton, character.mesh.bindMatrix);
        overlay.renderOrder = REVEAL_ORDER + 1;
        overlay.frustumCulled = false;
        // A shot must find the body, never the marker.
        overlay.raycast = () => null;
        character.mesh.parent?.add(overlay);
      }

      character.bones.LowerArmR?.add(grip);
      built = { character, material, overlay, chain: buildChain(character) };
      setRig(built);
    });
    return () => {
      live = false;
      setRig(null);
      if (!built) return;
      built.overlay?.parent?.remove(built.overlay);
      built.character.bones.LowerArmR?.remove(grip);
      built.material.dispose();
    };
  }, [skin, highlight, grip]);

  useFrame((state, delta) => {
    if (highlight) pulseReveal(state.clock.elapsedTime);
    if (!rig) return;
    const { chain } = rig;

    const which = safePose(typeof pose === "function" ? pose() : pose);
    const p = POSES[which];
    const on = typeof surface === "function" ? surface() : surface;
    const a = angles.current;
    const want = target.current;

    poseTargets(p, want);

    // Gun arm leaves the pose entirely — π/2 out at rest, rising with pitch.
    if (aim !== null) {
      want.shoulderX[1] = Math.PI / 2 + aim();
      want.shoulderY[1] = 0;
      want.shoulderZ[1] = 0.12;
      want.elbowX[1] = 0;
      want.elbowY[1] = 0;
      want.elbowZ[1] = 0;
    }

    dampAngles(a, want, POSE_DAMP, delta);

    const standing = typeof upright === "function" ? upright() : upright;
    flat.current.slerp(flatFor(p.flat, on, standing), 1 - Math.exp(-POSE_DAMP * delta));

    const g = root.current;
    if (g) {
      g.position.y = a.offsetY;
      g.position.z = a.offsetZ;
      // Crumple is in the body's own frame, so it goes under the flat orientation.
      crumple.setFromAxisAngle(CRUMPLE_AXIS, a.rootX);
      g.quaternion.copy(flat.current).multiply(crumple);
    }

    const w = walk.current;
    const phase = gait ? gait() : 0;
    // Prime so a non-zero odometer at mount is not read as one frame of walking.
    if (!w.primed) {
      w.last = phase;
      w.primed = true;
    }
    const moving = phase - w.last > WALK_EPSILON;
    w.last = phase;
    w.phase = phase;
    const walkable = which === 0 && on === CLING_NONE;
    w.amp = THREE.MathUtils.damp(w.amp, walkable && moving ? 1 : 0, WALK_DAMP, delta);

    if (w.amp <= WALK_EPSILON) {
      applyPose(chain, a);
      return;
    }
    copyAngles(a, posed.current);
    addWalk(posed.current, w.phase, w.amp, aim !== null);
    applyPose(chain, posed.current);
  });

  if (!rig) return null;

  return (
    <group ref={root} scale={scale}>
      <primitive object={rig.character.root} />
      {holding && createPortal(<group rotation={[Math.PI / 2, 0, 0]}>{holding}</group>, grip)}
    </group>
  );
}
