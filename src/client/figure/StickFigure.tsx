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

/** How fast a limb settles into a new pose. Higher is snappier — and snappier
 *  is not better here: a body that changes pose in two frames reads as a sprite
 *  swap rather than as somebody lying down. */
const POSE_DAMP = 8;

/** Elbow to wrist, in the bone's own units — where the shotgun sits, since the
 *  rig ends at the forearm. Measured off the model: the vertices weighted to
 *  `LowerArmR` run 0 to 0.578 along that bone's own axis. */
const FOREARM_LENGTH = 0.58;

const REVEAL_ORDER = 20;
const REVEAL_COLOR = new THREE.Color("#ff2a36");
/** Beats per second. Slow enough to read as breathing rather than an alarm. */
const REVEAL_HZ = 1.15;

/** One red material for every highlighted body in the scene, shared on purpose. */
const revealMaterial = new THREE.MeshBasicMaterial({
  color: REVEAL_COLOR,
  toneMapped: false,
  depthTest: false,
  transparent: true,
  // Transparent *and* depth-ignoring: without this the parts of one body would
  // punch holes in each other through a depth buffer they are not consulting.
  depthWrite: false,
});

/** Drive the shared pulse. Idempotent, so every highlighted figure may call it. */
function pulseReveal(elapsed: number) {
  revealMaterial.opacity = (Math.sin(elapsed * Math.PI * 2 * REVEAL_HZ) + 1) / 2;
}

/** Everything one figure owns: its own skeleton, its own material, and the
 *  chain the pose is written onto. */
type Rig = {
  character: Character;
  material: THREE.Material;
  overlay: THREE.SkinnedMesh | null;
  chain: ReturnType<typeof buildChain>;
};

/** Scratch for composing the crumple tip under the flat orientation. */
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
  /** A getter for remote figures: their pose changes on network patches, which
   *  deliberately do not re-render the tree. */
  pose?: number | (() => number);
  /** Which body's paint to wear — SELF for the local player, session id otherwise. */
  skinId: string;
  /** What the body is stuck to (`CLING_*`), which decides which way up a pose
   *  that lies flat is drawn. A getter for the same reason `pose` is one. */
  surface?: number | (() => number);
  /** Aim pitch in radians. */
  aim?: (() => number) | null;
  /** Rendered in the right hand, barrel already aligned down the arm. */
  holding?: ReactNode;
  /** Paint this body one flat colour and draw it through walls. */
  highlight?: boolean;
  /** The X toggle: a pose that could lie flat stays on its feet instead. A
   *  getter for the same reason `pose` is one. */
  upright?: boolean | (() => boolean);
  /** How far through the walk cycle this body is, in radians — one footfall is
   *  π of it. A getter for the same reason `pose` is one, and the caller owns
   *  the conversion from metres because the stride belongs to the body's
   *  height. Left off, the figure never walks. */
  gait?: (() => number) | null;
}) {
  const root = useRef<THREE.Group>(null);
  /** How the body is lying right now, eased toward `FLAT_FOR`. */
  const flat = useRef(new THREE.Quaternion());
  const angles = useRef(makeAngles());
  /** The angles actually written to the bones: the damped pose plus the walk.
   *  Kept apart from `angles` — see `copyAngles`. */
  const posed = useRef(makeAngles());
  /** What the pose is asking for this frame, before the damper eases into it. */
  const target = useRef(makeAngles());
  /** The cycle's own state: where it is, how much of it is showing, and the
   *  phase it saw last frame, which is the only way to tell moving from still. */
  const walk = useRef({ phase: 0, amp: 0, last: 0, primed: false });
  const skin = getSkin(skinId);

  /** Where the shotgun hangs. A child of the forearm bone, so it needs no frame
   *  callback of its own. The rig has no hand bone, so the grip is pushed down
   *  the forearm's own axis (+Y runs from elbow to wrist) by its length. */
  const grip = useMemo(() => {
    const g = new THREE.Group();
    g.position.y = FOREARM_LENGTH;
    return g;
  }, []);
  const [rig, setRig] = useState<Rig | null>(null);

  // The body is built once the model has landed, and this component renders
  // nothing until then — deliberately, because suspending here would tear down
  // the collider the figure is mounted inside. `Game.tsx` starts the fetch on
  // the join click; awaiting the same idempotent promise is what makes a figure
  // that mounts first still get a body.
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
        : // **Matte, and it has to stay that way.** The body takes light the way
          // the surface it is hiding against does, or the shading gives it away
          // before the colour ever does — a body at 0.55 caught a soft sheen
          // along every limb that the wall behind it did not. A map asks for the
          // same treatment with `matte` in `maps.ts`, which flattens everything
          // it loads to exactly these numbers; this is the same setting for the
          // one thing in the scene that is not part of a map. Matched, the only
          // thing left to tell a chameleon from a wall is the colour it painted
          // itself — which is the whole game.
          new THREE.MeshStandardMaterial({ map: skin, roughness: 1, metalness: 0 });
      character.mesh.material = material;
      character.mesh.renderOrder = highlight ? REVEAL_ORDER : 0;
      character.mesh.castShadow = !highlight;
      // What the paint raycast looks for. There are no per-part meshes any
      // more: the hit's UV says which part it landed on — see `parts.ts`.
      character.mesh.userData.body = true;

      // The reveal marker: a second skinned mesh on the *same* skeleton, so it
      // follows the body for free rather than being posed twice.
      let overlay: THREE.SkinnedMesh | null = null;
      if (highlight) {
        overlay = new THREE.SkinnedMesh(character.mesh.geometry, revealMaterial);
        overlay.bind(character.mesh.skeleton, character.mesh.bindMatrix);
        overlay.renderOrder = REVEAL_ORDER + 1;
        overlay.frustumCulled = false;
        // A shot must find the body, never its marker.
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

    // What the pose asks for, before any easing. `poseTargets` lives in
    // `rig.ts` so that the harness which measures a posed body against the real
    // mesh poses it exactly the way this does — see `test/posedBounds.test.ts`.
    poseTargets(p, want);

    // The gun arm leaves the pose entirely while aiming: straight out in front
    // at rest (x = π/2), rising and falling with pitch. Written onto the
    // *target*, so it is eased into like everything else.
    if (aim !== null) {
      want.shoulderX[1] = Math.PI / 2 + aim();
      want.shoulderY[1] = 0;
      want.shoulderZ[1] = 0.12;
      want.elbowX[1] = 0;
      want.elbowY[1] = 0;
      want.elbowZ[1] = 0;
    }

    dampAngles(a, want, POSE_DAMP, delta);

    // Flat on the floor, flat the other way up against a ceiling, upright to
    // climb a wall. Damped exactly as the joints are — `MathUtils.damp` is a
    // lerp with this same factor — so a chameleon that grabs a wall stands up
    // over a few frames instead of snapping vertical.
    const standing = typeof upright === "function" ? upright() : upright;
    flat.current.slerp(flatFor(p.flat, on, standing), 1 - Math.exp(-POSE_DAMP * delta));

    const g = root.current;
    if (g) {
      g.position.y = a.offsetY;
      g.position.z = a.offsetZ;
      // The crumple is a tip in the body's *own* frame, so it goes underneath
      // the flat orientation rather than beside it.
      crumple.setFromAxisAngle(CRUMPLE_AXIS, a.rootX);
      g.quaternion.copy(flat.current).multiply(crumple);
    }

    // **The walk rides on the standing pose and nothing else.** A body lying
    // flat or holding a wall has no ground under it to push against, and every
    // other pose is a shape somebody chose to hold still in.
    const w = walk.current;
    const phase = gait ? gait() : 0;
    // Primed on the first frame, or a figure that mounts with a non-zero
    // odometer behind it reads the whole of it as one frame of walking.
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
