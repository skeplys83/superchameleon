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
import { keepInside, pushInside } from "./inside";
import { addWalked } from "./gait";
import { usePointerControls } from "./usePointerControls";
import { useEyedropperReadback } from "./useEyedropperReadback";
import { useStateBroadcast } from "./useStateBroadcast";
import { CLING_NONE, type Role } from "@/shared/protocol";
import { POSES, poseCentre, poseExtents } from "@/client/figure/poses";
import { DEV, reportPlayer } from "@/client/app/dev";
import { ROOM_SURFACE } from "@/client/world/Room";
import { surfaceRevision } from "@/client/world/surface";
import { StickFigure } from "@/client/figure/StickFigure";
import { SELF } from "@/client/paint/skin";
import { type Brush } from "@/client/paint/brush";
import { playSound } from "@/client/sound/engine";
import { Stepper, jitteredStepRate, strideFor } from "@/client/sound/footsteps";

const SPEED = 6;
/** A velocity, not an impulse. Read with `GRAVITY`, which is what decides how
 *  long the arc lasts and therefore how far it carries. */
const JUMP_SPEED = 10;
/** Downward speed held while grounded, so the controller keeps finding the floor. */
const GROUND_STICK = 1;

/**
 * The four numbers that make a jump feel like a jump rather than like a physics
 * demo. All of them are forgiveness rather than power: none makes you jump
 * higher than `JUMP_SPEED` allows.
 */
/** Ground credit after walking off an edge. A jump pressed inside this window
 *  still fires — the input was right, the frame was late. */
const COYOTE_TIME = 0.15;
/** How long a press made just before landing stays queued. Hammering jump on
 *  the way down should land and go, not be eaten by a frame. */
const JUMP_BUFFER = 0.16;
/** Extra gravity once the rise is over. A symmetric arc hangs; falling faster
 *  than you rose is what reads as weight. */
const FALL_GRAVITY = 1.25;
/** Gravity while rising with the key already released — the short hop. */
const CUT_GRAVITY = 2.2;
/** Below this, an upward frame that went nowhere is a ceiling rather than a
 *  slope being climbed. A share of what was asked for. */
const HEAD_BUMP = 0.4;
const TURN_SPEED = 2.6; // rad/s for Q/E

/** Thickness of the hover ring in world units — constant, so the outline does
 *  not thin out or fatten as the brush grows. Thin on purpose: the ring's
 *  *radius* scales with the body, so on a smaller chameleon a fat border eats
 *  the preview it is supposed to outline. */
const RING_BORDER = 0.003;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const bodyPos = new THREE.Vector3();
const lookDir = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const quat = new THREE.Quaternion();
/** Scratch for movement across the surface being climbed, and the wall's axes. */
const alongSurface = new THREE.Vector3();
const wallUp = new THREE.Vector3();
const wallRight = new THREE.Vector3();
/** Where the body wants to go this frame, before the controller has its say. */
const desired = new THREE.Vector3();
/** The pose's collider offset, turned into the body's yaw. */
const boxCentre = new THREE.Vector3();
/** Where the body's centre provably was, for the sweep in `inside.ts`. */
const safe = new THREE.Vector3();

/** The fall-back drop-in point, used only if a map somehow has none. */
const SPAWN: [number, number, number] = [0, 2, 0];
/** Nothing under the floor can recover on its own, so anything below this is
 *  put back at spawn. */
const FLOOR_ESCAPE_Y = -3;
/** Every control held down false — what the frame loop reads while paused. */
const NO_KEYS = Object.freeze(
  Object.fromEntries(controlMap.map((entry) => [entry.name, false])),
) as Readonly<Record<Control, boolean>>;

export function Player({
  role,
  spawn = SPAWN,
  painting,
  paused,
  frozen = false,
  brush,
  onBrush,
  picking = false,
  onPicked,
  onHoverBody,
}: {
  role: Role;
  /** Where this map puts a body. Must be a stable array — see `SPAWN`. */
  spawn?: [number, number, number];
  /** A hunter who opened the palette: they step out to third person to paint. */
  painting: boolean;
  paused: boolean;
  /** Rooted to the spot, but still able to look around. */
  frozen?: boolean;
  brush: Brush;
  /** Right-dragging the body resizes the brush, so this owns the change. */
  onBrush: (b: Brush) => void;
  /** The eyedropper is armed: the next left click takes a colour off the screen. */
  picking?: boolean;
  onPicked?: (hex: string) => void;
  /** Fires when the cursor moves on or off your own body. */
  onHoverBody: (hovering: boolean) => void;
}) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);

  const [hx, hy, hz] = BODY[role];

  /** The body's own simulation state: one mutable object rather than six refs,
   *  none of it on the wire. `look` is the same idea and is owned by the
   *  pointer hook, which is what writes most of it — see `look.ts`. */
  const motion = useRef(newMotion(-hy));

  /** Seeded from the spawn so the first packets — sent on a timer that starts
   *  before the first frame — say where we actually are, not `y: 4`. */
  const netState = useRef({
    x: spawn[0],
    y: spawn[1],
    z: spawn[2],
    yaw: 0,
    pitch: 0,
    pose: 0,
    cling: CLING_NONE,
  });

  const solids = useRef<THREE.Object3D[]>([]);
  /** The subset of `solids` that is floor, wall or ceiling. The follow camera
   *  stops on these and passes through everything else. */
  const shell = useRef<THREE.Object3D[]>([]);
  /** Which version of the world `solids` was collected from. -1 forces a first
   *  pass on the very first frame. */
  const solidsRevision = useRef(-1);
  const [pose, setPose] = useState(0);
  /** What the body is stuck to. React state rather than a frame-loop local
   *  because the collider is keyed on the pose's box, and a pose that lies flat
   *  gets a different box standing up — so a cling has to re-render. */
  const [surfaceKind, setSurfaceKind] = useState<number>(CLING_NONE);

  /** Your own footsteps. Remote figures get one of these each in SoundStage;
   *  yours lives here because this is the only place that knows you are on the
   *  ground — nobody else's `grounded` is on the wire. */
  const stepper = useRef(new Stepper(strideFor(role)));

  const [, getKeys] = useKeyboardControls<Control>();
  const { scene } = useThree();
  // The world handle only. Nothing is *called* on it here — the controller is
  // fetched inside the frame loop, because that is the only place rapier is
  // safe to touch. See `controller.ts` and trap 5.
  const { world } = useRapier();

  // In paint mode even a hunter steps out to third person to see their body.
  const firstPerson = role === "hunter" && !painting;

  // This component is keyed on the room, so mounting means a new map. The
  // follow camera's eased distance belongs to the old one and has to be
  // dropped, or the first frame here flies in from wherever it was standing.
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
    onHoverBody,
    visual,
    ring,
    solids,
  });
  useStateBroadcast(netState);
  useEyedropperReadback();

  useFrame((state, delta) => {
    const rb = body.current;
    const col = collider.current;
    // The collider is remounted by `key` when a pose changes its shape, so there
    // is a frame where it is not there yet. Nothing below can run without it.
    if (!rb || !col) return;
    const controller = characterController(world);
    const m = motion.current;
    const view = look.current;

    // Re-collect the room's surfaces when the world changes — a map finishing
    // its load, or a different map taking over. Everything below raycasts
    // against this list, so a stale or empty one is a player who cannot stand
    // on anything. An integer compare on the frames where nothing changed.
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

    /** Do not fall through a world that has not arrived yet. */
    if (solids.current.length === 0) {
      m.vy = 0;
      return;
    }

    const p = rb.translation();
    bodyPos.set(p.x, p.y, p.z);

    /** Each pose carries its own box (see poseExtents), stated in world axes —
     *  so `[1]` is its vertical half-extent whatever the pose is doing, and the
     *  whole triple is what cling has to probe with. */
    const poseHalf = poseExtents(pose, [hx, hy, hz], surfaceKind);
    const half = poseHalf[1];
    const centre = poseCentre(pose, hy, surfaceKind);
    const foot = centre[1] - half;
    if (surfaceKind !== m.surface) {
      // **The box turned because the surface changed, not because the pose
      // did.** The cling logic is already placing the body against the new
      // surface, so nothing here may move it — and the alternative is worse
      // than a no-op. Suppressing only the shift and still recording the offset
      // meant grabbing a wall was fine and *letting go* dropped the body
      // 0.73 units, straight through the floor.
      m.surface = surfaceKind;
      m.footOffset = foot;
      // But the body *does* have to be put back against what it is now holding:
      // the box it was placed for has just been replaced. See `seatOn`.
      if (m.cling) seatOn(bodyPos, m.cling, poseHalf, solids.current);
    } else if (foot !== m.footOffset) {
      // A pose change under an unchanged surface: keep the *feet* put, or a
      // chameleon lying down sinks into the floor or hops off it. Clinging,
      // `STICK_SPEED` pulls the body back onto the surface within a frame or
      // two, so the same correction is not needed along a wall or a ceiling.
      if (!m.cling) bodyPos.y += m.footOffset - foot;
      m.footOffset = foot;
    }

    // Nothing should reach this now that penetration cannot eject anybody, but a
    // player under the floor can never recover on their own and sees nothing but
    // empty background. Kept as the cheapest insurance in the file.
    if (bodyPos.y < FLOOR_ESCAPE_Y) {
      rb.setTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] }, true);
      rb.setNextKinematicTranslation({ x: spawn[0], y: spawn[1], z: spawn[2] });
      m.vy = 0;
      return;
    }

    // `frozen` reads as "no keys" rather than as "paused": the mouse handlers
    // stay live, so a rooted player can still turn and look about.
    const keys: Readonly<Record<Control, boolean>> =
      paused || frozen || !view.focused ? NO_KEYS : getKeys();
    // Losing the tab drops every key, this one included: without it, coming back
    // with space still nominally "held" swallows the first jump.
    if (!view.focused) m.jumpHeld = false;

    // Poses are a chameleon's whole game. A hunter hunts upright and never leaves
    // POSES[0], so the number keys simply are not theirs.
    if (role === "chameleon") {
      for (let i = 0; i < POSES.length; i++) {
        if (keys[poseControl(i)] && pose !== i) {
          setPose(i);
          break;
        }
      }
    }

    // Movement follows where you are looking, not where the figure faces.
    const y = view.yaw;

    if (role === "chameleon") {
      m.bodyYaw += (Number(keys.turnLeft) - Number(keys.turnRight)) * TURN_SPEED * delta;
    } else if (firstPerson) {
      m.bodyYaw = y;
    }
    forward.set(-Math.sin(y), 0, -Math.cos(y));
    right.set(Math.cos(y), 0, -Math.sin(y));

    move
      .set(0, 0, 0)
      .addScaledVector(forward, Number(keys.forward) - Number(keys.backward))
      .addScaledVector(right, Number(keys.right) - Number(keys.left));
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(SPEED);

    if (m.reclingGrace > 0) m.reclingGrace -= delta;
    if (m.coyote > 0) m.coyote -= delta;
    if (m.buffered > 0) m.buffered -= delta;
    const spacePressed = keys.jump && !m.jumpHeld;
    // Queued on the press, spent on the landing. Not while clinging: there the
    // same key means "let go", and buffering it would fire a jump the moment
    // the released chameleon touched the floor.
    if (spacePressed && !m.cling) m.buffered = JUMP_BUFFER;
    let releasing = false;

    if (role === "chameleon") {
      if (m.cling) {
        if (spacePressed) {
          releasing = true;
        } else {
          // Wrap around an edge into whatever we are climbing toward: a wall
          // into the ceiling, an inside corner, a ceiling back onto a wall.
          const wrapped = wrapCling(bodyPos, m.cling, alongSurface, poseHalf, solids.current);
          m.cling = wrapped ?? holdsCling(bodyPos, m.cling, poseHalf, solids.current);
        }
      } else if (m.reclingGrace <= 0) {
        // No grab key: walking squarely into a wall is what takes you onto it.
        m.cling = findCling(bodyPos, move, poseHalf, solids.current);
      }
    } else {
      m.cling = null;
    }

    // Movement across the surface, and the axes it is measured in. Computed
    // before the release check so `alongSurface` is the direction we were
    // heading — which is what the wrap probe above reads on the next frame.
    if (m.cling && wallTangents(m.cling, wallUp, wallRight)) {
      alongSurface
        .copy(wallUp)
        .multiplyScalar(Number(keys.forward) - Number(keys.backward))
        .addScaledVector(wallRight, Number(keys.right) - Number(keys.left));
      if (alongSurface.lengthSq() > 0) alongSurface.normalize().multiplyScalar(CLIMB_SPEED);
    } else if (m.cling) {
      // A ceiling: no up to walk, so this is ordinary camera-relative movement
      // flattened into the surface, which for a flat roof changes nothing.
      alongSurface.copy(move).addScaledVector(m.cling, -move.dot(m.cling));
    } else {
      alongSurface.set(0, 0, 0);
    }

    /** A release is a push clear of the surface for one frame. */
    if (releasing) {
      const normal = m.cling!;
      m.cling = null;
      m.reclingGrace = RECLING_GRACE;
      m.vy = normal.y * RELEASE_PUSH;
      desired.copy(normal).multiplyScalar(RELEASE_PUSH * delta);
    }

    const clinging = m.cling !== null;
    /** What we are stuck to, which decides which way up the figure is drawn and
     *  which way round its collider sits. Sent to everyone else as-is; the
     *  render reads the state copy, which is a frame behind and does not need
     *  to be anything else. */
    const surface = clingKind(m.cling);
    if (surface !== surfaceKind) setSurfaceKind(surface);

    // **Not `grounded` and not the raw press.** Coyote time answers "were you
    // on the ground recently enough", the buffer answers "did you ask recently
    // enough" — a jump you pressed one frame early off a ledge you left one
    // frame ago is the one players insist they made, and they are right.
    const jumping = !clinging && !releasing && m.buffered > 0 && (m.grounded || m.coyote > 0);
    if (jumping) {
      m.buffered = 0;
      m.coyote = 0;
      m.rising = true;
    }
    m.jumpHeld = keys.jump;
    // Let go on the way up and the rise is cut short. Holding it does not add
    // height — it only declines to take any away.
    if (m.rising && (!keys.jump || m.vy <= 0)) m.rising = false;

    // Footsteps are for walking. Sliding up a wall or hanging off the roof is
    // silent — which is most of the point of being up there.
    if (!clinging && m.grounded && stepper.current.update(p.x, p.y, p.z, delta)) {
      // Your own steps are not positional: you are the listener, and a panner at
      // zero distance behaves badly. Quieter than everyone else's, because your
      // own feet are the ones you least need to hear.
      playSound("step", { rate: jitteredStepRate(role), gain: 0.8 });
    } else if (clinging || !m.grounded) {
      stepper.current.reset();
    }

    /** Where the body would like to be by the end of the frame. */
    if (clinging) {
      const normal = m.cling!;
      m.vy = 0;
      desired.copy(alongSurface).addScaledVector(normal, -STICK_SPEED).multiplyScalar(delta);
    } else if (!releasing) {
      if (jumping) m.vy = JUMP_SPEED;
      else if (m.grounded && m.vy <= 0) m.vy = -GROUND_STICK;
      // Three gravities, one arc: light on the way up while the key is held,
      // heavy the moment it is let go, heavy again on the way down.
      else if (m.vy > 0) m.vy -= GRAVITY * (m.rising ? 1 : CUT_GRAVITY) * delta;
      else m.vy -= GRAVITY * FALL_GRAVITY * delta;
      desired.set(move.x * delta, m.vy * delta, move.z * delta);
    }

    // Ask rapier how much of that is actually possible, then go exactly there.
    controller.computeColliderMovement(col, desired);
    const allowed = controller.computedMovement();
    m.grounded = controller.computedGrounded();

    // **No input, no travel.** `setSlideEnabled` projects a blocked move along
    // whatever it hit, and both of the holds this game applies every frame are
    // pushes into a surface: `GROUND_STICK` down into the floor, `STICK_SPEED`
    // into the wall being climbed. On anything but a perfectly square face —
    // a trimesh prop, two boxes meeting at a seam, a collider a degree off — a
    // fraction of that push survives the projection as sideways motion, and a
    // body asking to stand still creeps across the surface it is standing on.
    // So the hold is allowed to hold and nothing else: what is kept is the
    // component along the surface's own normal, and the tangent is dropped.
    // A release keeps everything — that push *is* the movement.
    let moveX = allowed.x;
    let moveY = allowed.y;
    let moveZ = allowed.z;
    if (releasing) {
      // Nothing to clamp: the whole frame is the shove away from the surface.
    } else if (clinging && alongSurface.lengthSq() === 0) {
      const normal = m.cling!;
      const into = moveX * normal.x + moveY * normal.y + moveZ * normal.z;
      moveX = normal.x * into;
      moveY = normal.y * into;
      moveZ = normal.z * into;
    } else if (!clinging && move.lengthSq() === 0) {
      // Standing or falling with no key down: gravity is the only axis left.
      moveX = 0;
      moveZ = 0;
    }

    // Catch `bodyPos` up to where the body is *going*, not where it was when the
    // frame started. The camera below reads it, and a frame of lag against a
    // world that has already moved is seen as the view lagging the body.
    bodyPos.set(bodyPos.x + moveX, bodyPos.y + moveY, bodyPos.z + moveZ);

    // The controller only ever checked the *movement*. Between `p` and here the
    // body may also have been shifted outright — by the foot compensation or by
    // `seatOn` — and its collider may have been rebuilt a different size. This
    // is the one guarantee that survives all of that: the centre never crosses
    // a surface. See `inside.ts`.
    safe.set(p.x, p.y, p.z);
    keepInside(safe, bodyPos, solids.current);
    // And the box around that centre, out of the room's own shell. Second, and
    // never instead: it measures outward from the centre, so it needs the
    // centre already in the room. See `inside.ts`.
    pushInside(bodyPos, poseHalf, centre, m.bodyYaw, m.cling, shell.current);

    rb.setNextKinematicTranslation({ x: bodyPos.x, y: bodyPos.y, z: bodyPos.z });
    // Published for the viewmodel's walk bob, under the same condition that
    // plays a footstep above — so the gun moves with the steps you can hear and
    // holds still in the air. Horizontal only, for the same reason the stepper
    // is: falling is not walking.
    if (!clinging && m.grounded) addWalked(Math.hypot(moveX, moveZ));

    // Stop accumulating downward speed the moment the floor is under us, or a
    // long fall leaves `vy` at -40 and the first step off a kerb is a plummet.
    if (m.grounded && m.vy < 0) m.vy = 0;

    // **A head on a ceiling ends the jump.** Asking to go up and being allowed
    // almost none of it is a bump; without this `vy` stays positive and the
    // player grinds along the underside of the roof until gravity finally eats
    // it, which is the "pressing against the ceiling" you can feel through the
    // camera. Cutting to zero drops them away cleanly.
    if (m.vy > 0 && moveY < desired.y * HEAD_BUMP) {
      m.vy = 0;
      m.rising = false;
    }

    // Ground credit is refilled by *being* on the ground, so walking off an
    // edge starts it running down rather than ending the jump outright.
    m.coyote = m.grounded ? COYOTE_TIME : m.coyote;

    // The body's rotation is frozen, so the figure is turned by rotating the
    // visual group and the collider together. Only yaw: a lying pose's roll is
    // animated inside StickFigure, and its box is already stated lying down.
    euler.set(0, m.bodyYaw, 0);
    quat.setFromEuler(euler);
    visual.current?.quaternion.setFromEuler(euler);
    collider.current?.setRotationWrtParent(quat);
    // Rapier holds the collider's offset and its rotation as siblings rather
    // than composing one through the other, so an offset left alone points at
    // world +Z however the body is facing. Turn it ourselves.
    collider.current?.setTranslationWrtParent(
      boxCentre.set(centre[0], centre[1], centre[2]).applyQuaternion(quat),
    );

    const net = netState.current;
    net.x = p.x;
    net.y = p.y;
    net.z = p.z;
    // Which, for a hunter, is their camera heading — so chameleons can read where
    // the gun hunting them is pointed.
    net.yaw = m.bodyYaw;
    net.pitch = role === "hunter" ? view.pitch : 0;
    net.pose = pose;
    // Sent so other clients can keep a climber's footsteps quiet — their
    // stepper only sees a position, and sliding along a wall looks like
    // walking — and so they know which way up to draw a pose that lies flat.
    net.cling = surface;

    const cp = Math.cos(view.pitch);
    lookDir.set(-Math.sin(y) * cp, Math.sin(view.pitch), -Math.cos(y) * cp);

    // Developer mode only, and compiled out of the build entirely — see
    // `app/dev.ts`. Reported from here because this is the only place that
    // knows any of it: none of `grounded`, `vy` or `cling` is on the wire.
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
        pose,
        half: poseExtents(pose, [hx, hy, hz], surfaceKind),
        surfaces: solids.current.length,
      });
    }

    if (firstPerson) {
      // Always eye height: a hunter cannot pose, so there is no rolled-over
      // body to drop the camera into.
      state.camera.position.set(bodyPos.x, bodyPos.y + hy * 0.72, bodyPos.z);
      euler.set(view.pitch, y, 0);
      state.camera.quaternion.setFromEuler(euler);
    } else {
      followThirdPerson(state.camera, bodyPos, lookDir, view.zoom, shell.current, delta);
    }
  });

  return (
    <>
      {/* Brush preview. It lives outside the body so it is not dragged around
          by the figure's own rotation. */}
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
          /* **A cylinder, and only for the hunter.** A box turns with the body,
             so how close it lets you stand to a wall depends on which way you
             are facing — a corner reaches out by root two, a face by one. That
             matters now that a hunter's collider is sized to *hold them off*
             what they are searching: the standoff has to be the same in every
             direction or the way to get your eye onto a painting is to face it
             squarely. It also removes the diagonal, which is what a rotating
             1.29 m box was pushing through a 1.49 m doorway.

             A chameleon keeps its cuboid: `figure/poses.ts` states every pose
             as a box, and lying flat is not a shape a cylinder describes. */
          <CylinderCollider ref={collider} args={[hy, hx]} position={[0, 0, 0]} />
        ) : (
          <CuboidCollider
            // `args` is read once, at creation, so a pose with a different box
            // needs a new collider — but only when the numbers actually differ,
            // or standing still and pressing 1 then 3 would rebuild it for nothing.
            key={poseExtents(pose, [hx, hy, hz], surfaceKind).join()}
            ref={collider}
            args={poseExtents(pose, [hx, hy, hz], surfaceKind)}
            // Only until the first frame loop turns it into the body's yaw.
            position={[...poseCentre(pose, hy, surfaceKind)]}
          />
        )}
        <group ref={visual}>
          {/* In first person the camera sits inside the head, so the hunter's
              own figure is hidden and the viewmodel stands in for it. */}
          {!firstPerson && (
            <StickFigure scale={hy} pose={pose} surface={surfaceKind} skinId={SELF} />
          )}
        </group>
      </RigidBody>
    </>
  );
}
