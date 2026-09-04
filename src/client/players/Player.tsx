import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import {
  RapierRigidBody,
  RigidBody,
  CuboidCollider,
  CylinderCollider,
  useRapier,
  type RapierCollider,
} from "@react-three/rapier";
import * as THREE from "three";
import type { Control } from "./controls";
import { controlMap, poseControl } from "./controls";
import { followThirdPerson, resetFollow } from "./camera";
import {
  CLIMB_SPEED,
  RECLING_GRACE,
  RELEASE_PUSH,
  STICK_SPEED,
  clingKind,
  findCling,
  seatOn,
  holdsCling,
  wallTangents,
  wrapCling,
} from "./cling";
import { BODY, GRAVITY } from "./body";
import { characterController } from "./controller";
import { newMotion } from "./look";
import { headroom, keepInside, pushInside } from "./inside";
import { addWalked, walkedDistance } from "./gait";
import { reportPose, takePoseRequest } from "./poseRequest";
import { usePointerControls } from "./usePointerControls";
import { useEyedropperReadback } from "./useEyedropperReadback";
import { useStateBroadcast } from "./useStateBroadcast";
import { CLING_NONE, type Role } from "@/shared/protocol";
import { POSES, poseCentre, poseExtents, safePose } from "@/client/figure/poses";
import { DEV, reportPlayer } from "@/client/app/dev";
import { ROOM_SURFACE } from "@/client/world/Room";
import { surfaceRevision } from "@/client/world/surface";
import { StickFigure } from "@/client/figure/StickFigure";
import { SELF } from "@/client/paint/skin";
import { type Brush } from "@/client/paint/brush";
import { playSound } from "@/client/sound/engine";
import { Stepper, jitteredStepRate, strideFor } from "@/client/sound/footsteps";

const SPEED: Record<Role, number> = { hunter: 6, chameleon: 4.2 };
const JUMP_SPEED = 10;
const GROUND_STICK = 1;

const COYOTE_TIME = 0.15;
const JUMP_BUFFER = 0.16;
const FALL_GRAVITY = 1.25;
const CUT_GRAVITY = 2.2;
/** Below this, an upward frame that went nowhere is a ceiling, not a slope. */
const HEAD_BUMP = 0.4;
const TURN_SPEED = 2.6;
const PAINT_SLOWDOWN = 0.3;
const HUNT_SLOWDOWN = 0.6;
const FACE_DAMP = 7;
const RISE_DELAY = 0.5;
const FIGURE_HIDE_DISTANCE = 1.0;
const TAU = Math.PI * 2;

function shortestTurn(from: number, to: number) {
  return (((to - from + Math.PI) % TAU) + TAU) % TAU - Math.PI;
}

const RING_BORDER = 0.003;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const bodyPos = new THREE.Vector3();
const lookDir = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const quat = new THREE.Quaternion();
const alongSurface = new THREE.Vector3();
const wallUp = new THREE.Vector3();
const wallRight = new THREE.Vector3();
const desired = new THREE.Vector3();
const boxCentre = new THREE.Vector3();
const safe = new THREE.Vector3();

const SPAWN: [number, number, number] = [0, 2, 0];
const FLOOR_ESCAPE_Y = -3;
const NO_KEYS = Object.freeze(
  Object.fromEntries(controlMap.map((entry) => [entry.name, false])),
) as Readonly<Record<Control, boolean>>;

export function Player({
  role,
  spawn = SPAWN,
  painting,
  paused,
  frozen = false,
  hunting = false,
  brush,
  onBrush,
  picking = false,
  onPicked,
}: {
  role: Role;
  spawn?: [number, number, number];
  painting: boolean;
  paused: boolean;
  frozen?: boolean;
  hunting?: boolean;
  brush: Brush;
  onBrush: (b: Brush) => void;
  picking?: boolean;
  onPicked?: (hex: string) => void;
}) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);

  const [hx, hy, hz] = BODY[role];

  const motion = useRef(newMotion(-hy));

  const netState = useRef({
    x: spawn[0],
    y: spawn[1],
    z: spawn[2],
    yaw: 0,
    pitch: 0,
    pose: 0,
    cling: CLING_NONE,
    upright: false,
  });

  const solids = useRef<THREE.Object3D[]>([]);
  const shell = useRef<THREE.Object3D[]>([]);
  const solidsRevision = useRef(-1);
  const [pose, setPose] = useState(0);
  const [walking, setWalking] = useState(false);
  const [upright, setUpright] = useState(false);
  const [surfaceKind, setSurfaceKind] = useState<number>(CLING_NONE);

  const stepper = useRef(new Stepper(strideFor(role)));

  const activePose = role === "chameleon" && walking ? 0 : pose;

  const stride = strideFor(role);
  const gaitPhase = () => (walkedDistance() / stride) * Math.PI;

  useEffect(() => reportPose(pose), [pose]);

  const [, getKeys] = useKeyboardControls<Control>();
  const { scene } = useThree();
  const { world } = useRapier();

  const firstPerson = role === "hunter" && !painting;

  useEffect(() => resetFollow(), []);

  const look = usePointerControls({
    role,
    brush,
    onBrush,
    painting,
    paused,
    frozen,
    picking,
    onPicked,
    visual,
    ring,
    solids,
  });
  useStateBroadcast(netState);
  useEyedropperReadback();

  useFrame((state, delta) => {
    const rb = body.current;
    const col = collider.current;
    if (!rb || !col) return;
    const controller = characterController(world);
    const m = motion.current;
    const view = look.current;

    if (solidsRevision.current !== surfaceRevision()) {
      solidsRevision.current = surfaceRevision();
      const list: THREE.Object3D[] = [];
      const shellList: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name !== ROOM_SURFACE) return;
        list.push(o);
        if (o.userData.shell) shellList.push(o);
      });
      solids.current = list;
      shell.current = shellList;
    }

    if (solids.current.length === 0) {
      m.vy = 0;
      return;
    }

    const p = rb.translation();
    bodyPos.set(p.x, p.y, p.z);

    const poseHalf = poseExtents(activePose, [hx, hy, hz], surfaceKind, upright);
    const half = poseHalf[1];
    const centre = poseCentre(activePose, hy, surfaceKind, upright);
    const foot = centre[1] - half;
    if (surfaceKind !== m.surface) {
      // Cling placed the body; suppressing only the shift and still recording
      // the offset drops it 0.73 units on release.
      m.surface = surfaceKind;
      m.footOffset = foot;
      if (m.cling) seatOn(bodyPos, m.cling, poseHalf, solids.current);
    } else if (foot !== m.footOffset) {
      // Keep the feet put across a pose change; STICK_SPEED handles it on a wall.
      if (!m.cling) bodyPos.y += m.footOffset - foot;
      m.footOffset = foot;
    }

    if (bodyPos.y < FLOOR_ESCAPE_Y) {
      rb.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true);
      rb.setNextKinematicTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] });
      m.vy = 0;
      return;
    }

    // `frozen` reads as "no keys" — the mouse handlers stay live.
    const keys: Readonly<Record<Control, boolean>> =
      paused || frozen || !view.focused ? NO_KEYS : getKeys();
    if (!view.focused) m.jumpHeld = false;

    // Not measured while clinging: "up" is not the direction the body grows in.
    const clear = m.cling ? Infinity : headroom(bodyPos, bodyPos.y + foot, solids.current);
    const fits = (i: number) =>
      poseExtents(i, [hx, hy, hz], surfaceKind, upright)[1] * 2 <= clear;

    // Drained whoever we are: a stale request from before the draw must not fire.
    const wheeled = takePoseRequest();
    if (role === "chameleon") {
      for (let i = 0; i < POSES.length; i++) {
        if (keys[poseControl(i)] && pose !== i && fits(i)) {
          setPose(i);
          break;
        }
      }
      // Second, so a number key in the same frame is not overridden.
      if (wheeled !== null && wheeled !== pose && fits(safePose(wheeled))) {
        setPose(safePose(wheeled));
      }
      if (keys.flatToggle && !m.flatHeld) setUpright((u) => !u);
    }
    m.flatHeld = keys.flatToggle;

    const y = view.yaw;

    const pace =
      (painting ? PAINT_SLOWDOWN : 1) * (role === "hunter" && hunting ? HUNT_SLOWDOWN : 1);

    if (role === "chameleon") {
      m.bodyYaw += (Number(keys.turnLeft) - Number(keys.turnRight)) * TURN_SPEED * pace * delta;
    } else if (firstPerson) {
      m.bodyYaw = y;
    }
    forward.set(-Math.sin(y), 0, -Math.cos(y));
    right.set(Math.cos(y), 0, -Math.sin(y));

    move
      .set(0, 0, 0)
      .addScaledVector(forward, Number(keys.forward) - Number(keys.backward))
      .addScaledVector(right, Number(keys.right) - Number(keys.left));
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(SPEED[role] * pace);

    if (m.reclingGrace > 0) m.reclingGrace -= delta;
    if (m.coyote > 0) m.coyote -= delta;
    if (m.buffered > 0) m.buffered -= delta;
    const spacePressed = keys.jump && !m.jumpHeld;
    // Not while clinging: there space means "let go".
    if (spacePressed && !m.cling) m.buffered = JUMP_BUFFER;
    let releasing = false;

    if (role === "chameleon") {
      if (m.cling) {
        if (spacePressed) {
          releasing = true;
        } else {
          const wrapped = wrapCling(bodyPos, m.cling, alongSurface, poseHalf, solids.current);
          m.cling = wrapped ?? holdsCling(bodyPos, m.cling, poseHalf, solids.current);
        }
      } else if (m.reclingGrace <= 0) {
        m.cling = findCling(bodyPos, move, poseHalf, solids.current);
      }
    } else {
      m.cling = null;
    }

    if (m.cling && wallTangents(m.cling, wallUp, wallRight)) {
      alongSurface
        .copy(wallUp)
        .multiplyScalar(Number(keys.forward) - Number(keys.backward))
        .addScaledVector(wallRight, Number(keys.right) - Number(keys.left));
      if (alongSurface.lengthSq() > 0) alongSurface.normalize().multiplyScalar(CLIMB_SPEED);
    } else if (m.cling) {
      alongSurface.copy(move).addScaledVector(m.cling, -move.dot(m.cling));
    } else {
      alongSurface.set(0, 0, 0);
    }

    if (releasing) {
      const normal = m.cling!;
      m.cling = null;
      m.reclingGrace = RECLING_GRACE;
      m.vy = normal.y * RELEASE_PUSH;
      desired.copy(normal).multiplyScalar(RELEASE_PUSH * delta);
    }

    const clinging = m.cling !== null;
    const surface = clingKind(m.cling);
    if (surface !== surfaceKind) setSurfaceKind(surface);

    const jumping = !clinging && !releasing && m.buffered > 0 && (m.grounded || m.coyote > 0);
    if (jumping) {
      m.buffered = 0;
      m.coyote = 0;
      m.rising = true;
    }
    m.jumpHeld = keys.jump;
    if (m.rising && (!keys.jump || m.vy <= 0)) m.rising = false;

    if (!clinging && m.grounded && stepper.current.update(p.x, p.y, p.z, delta)) {
      // Own steps: no position, panner at zero distance behaves badly.
      playSound("step", { rate: jitteredStepRate(role), gain: 0.8 });
    } else if (clinging || !m.grounded) {
      stepper.current.reset();
    }

    if (clinging) {
      const normal = m.cling!;
      m.vy = 0;
      desired.copy(alongSurface).addScaledVector(normal, -STICK_SPEED).multiplyScalar(delta);
    } else if (!releasing) {
      if (jumping) m.vy = JUMP_SPEED;
      else if (m.grounded && m.vy <= 0) m.vy = -GROUND_STICK;
      else if (m.vy > 0) m.vy -= GRAVITY * (m.rising ? 1 : CUT_GRAVITY) * delta;
      else m.vy -= GRAVITY * FALL_GRAVITY * delta;
      desired.set(move.x * delta, m.vy * delta, move.z * delta);
    }

    controller.computeColliderMovement(col, desired);
    const allowed = controller.computedMovement();
    m.grounded = controller.computedGrounded();

    // Drop the tangent of a hold: GROUND_STICK and STICK_SPEED are pushes into
    // a surface, and setSlideEnabled projects that push into a sideways creep.
    let moveX = allowed.x;
    let moveY = allowed.y;
    let moveZ = allowed.z;
    if (releasing) {
      // Nothing to clamp.
    } else if (clinging && alongSurface.lengthSq() === 0) {
      const normal = m.cling!;
      const into = moveX * normal.x + moveY * normal.y + moveZ * normal.z;
      moveX = normal.x * into;
      moveY = normal.y * into;
      moveZ = normal.z * into;
    } else if (!clinging && move.lengthSq() === 0) {
      moveX = 0;
      moveZ = 0;
    }

    bodyPos.set(bodyPos.x + moveX, bodyPos.y + moveY, bodyPos.z + moveZ);

    // Foot compensation, seatOn, and collider rebuilds can put the centre on
    // the wrong side of a wall — the controller only checks movement.
    safe.set(p.x, p.y, p.z);
    keepInside(safe, bodyPos, solids.current);
    pushInside(bodyPos, poseHalf, centre, m.bodyYaw, m.cling, shell.current);

    rb.setNextKinematicTranslation({ x: bodyPos.x, y: bodyPos.y, z: bodyPos.z });
    if (!clinging && m.grounded) addWalked(Math.hypot(moveX, moveZ));

    // Walking is *asking* to walk (a body pressed into a wall has not stopped
    // walking), and it needs room to stand — activePose unfolds to POSES[0].
    const wantsWalk =
      !clinging && (m.grounded || m.coyote > 0) && move.lengthSq() > 0 && fits(0);

    m.unfolding = wantsWalk ? m.unfolding + delta : 0;
    const nowWalking = wantsWalk && (pose === 0 || m.unfolding >= RISE_DELAY);
    if (nowWalking !== walking) setWalking(nowWalking);
    // Commit standing so it outlasts the key.
    if (nowWalking && pose !== 0) setPose(0);

    if (role === "chameleon" && nowWalking) {
      const heading = Math.atan2(-move.x, -move.z);
      m.bodyYaw += shortestTurn(m.bodyYaw, heading) * (1 - Math.exp(-FACE_DAMP * delta));
    }

    if (m.grounded && m.vy < 0) m.vy = 0;

    // Head bump: kill vy so we drop away cleanly instead of grinding the roof.
    if (m.vy > 0 && moveY < desired.y * HEAD_BUMP) {
      m.vy = 0;
      m.rising = false;
    }

    m.coyote = m.grounded ? COYOTE_TIME : m.coyote;

    euler.set(0, m.bodyYaw, 0);
    quat.setFromEuler(euler);
    visual.current?.quaternion.setFromEuler(euler);
    collider.current?.setRotationWrtParent(quat);
    // Rapier holds offset and rotation as siblings, not composed.
    collider.current?.setTranslationWrtParent(
      boxCentre.set(centre[0], centre[1], centre[2]).applyQuaternion(quat),
    );

    const net = netState.current;
    net.x = p.x;
    net.y = p.y;
    net.z = p.z;
    // Hunter broadcasts camera yaw so chameleons can read where the gun points.
    net.yaw = m.bodyYaw;
    net.pitch = role === "hunter" ? view.pitch : 0;
    net.pose = activePose;
    net.cling = surface;
    net.upright = upright;

    const cp = Math.cos(view.pitch);
    lookDir.set(-Math.sin(y) * cp, Math.sin(view.pitch), -Math.cos(y) * cp);

    if (DEV) {
      reportPlayer({
        role,
        x: bodyPos.x,
        y: bodyPos.y,
        z: bodyPos.z,
        yaw: y,
        pitch: view.pitch,
        bodyYaw: m.bodyYaw,
        vy: m.vy,
        grounded: m.grounded,
        clinging,
        zoom: view.zoom,
        firstPerson,
        pose: activePose,
        half: poseExtents(activePose, [hx, hy, hz], surfaceKind, upright),
        surfaces: solids.current.length,
      });
    }

    if (firstPerson) {
      state.camera.position.set(bodyPos.x, bodyPos.y + hy * 0.72, bodyPos.z);
      euler.set(view.pitch, y, 0);
      state.camera.quaternion.setFromEuler(euler);
    } else {
      const seat = followThirdPerson(
        state.camera,
        bodyPos,
        lookDir,
        view.zoom,
        shell.current,
        delta,
      );
      // Hide the figure once the lens is inside it.
      if (visual.current) visual.current.visible = painting || seat > FIGURE_HIDE_DISTANCE;
    }
  });

  return (
    <>
      <mesh ref={ring} visible={false} renderOrder={10} frustumCulled={false}>
        <ringGeometry
          args={[Math.max(0.002, brush.size * hy - RING_BORDER), brush.size * hy, 40]}
        />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.9}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <RigidBody
        ref={body}
        colliders={false}
        type="kinematicPosition"
        position={spawn}
        canSleep={false}
      >
        {role === "hunter" ? (
          <CylinderCollider ref={collider} args={[hy, hx]} position={[0, 0, 0]} />
        ) : (
          <CuboidCollider
            key={poseExtents(activePose, [hx, hy, hz], surfaceKind, upright).join()}
            ref={collider}
            args={poseExtents(activePose, [hx, hy, hz], surfaceKind, upright)}
            position={[...poseCentre(activePose, hy, surfaceKind, upright)]}
          />
        )}
        <group ref={visual}>
          {!firstPerson && (
            <StickFigure
              scale={hy}
              pose={activePose}
              surface={surfaceKind}
              skinId={SELF}
              gait={gaitPhase}
              upright={upright}
            />
          )}
        </group>
      </RigidBody>
    </>
  );
}
