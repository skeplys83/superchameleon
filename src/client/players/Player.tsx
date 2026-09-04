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

/**
 * Ground speed, in units per second, per role.
 *
 * **A chameleon is slower than a hunter, and that is the only asymmetry in the
 * movement.** They are two thirds the hunter's height (`BODY_SCALE`), so at a
 * shared speed they covered nearly twice as many body-lengths a second — a
 * small figure moving at a big figure's pace, which read as skating and made
 * every hiding place reachable in the time it took to look at two. The walk
 * cycle and the footsteps both come off distance travelled rather than off this
 * number, so lowering it slows the legs and the sound to match on its own.
 *
 * Not scaled all the way down to the height ratio (which would be ~3.3): a
 * chameleon caught in the open still has to be able to break for cover.
 */
const SPEED: Record<Role, number> = { hunter: 6, chameleon: 4.2 };
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
/**
 * What is left of `SPEED` and `TURN_SPEED` while the palette is up.
 *
 * Painting is aiming: the brush is a ring a few centimetres across on a body
 * that fills part of the screen, and at full speed the smallest tap of a
 * movement or turn key throws the surface you were working on out from under
 * the cursor. Slowed, the same keys become the nudge they need to be —
 * shuffling round the body to reach its other side, rather than travelling.
 *
 * It is not a lock. A chameleon in paint mode is standing in the open with
 * their cursor free, and taking their feet away entirely would be a worse trade
 * than making them slow.
 */
const PAINT_SLOWDOWN = 0.3;
/**
 * What is left of `SPEED` and `TURN_SPEED` for a hunter once the hunt is on.
 *
 * A hunter moving too fast is the whole point: at speed the eye slides past a
 * still figure painted to match the wall behind it. Slowing them turns the
 * search into a careful sweep, which is what the resolution and grain
 * handicaps already lean on. Applied to walking and turning together off the
 * same factor as `PAINT_SLOWDOWN`, for the same reason. The footstep sound
 * follows on its own — steps are triggered by distance travelled.
 */
const HUNT_SLOWDOWN = 0.6;
/** How fast a walking body swings round to face where it is going. Damping
 *  rather than a snap: a body that turns in one frame reads as the camera
 *  cutting, and a chameleon rounding a corner should lean into it. */
const FACE_DAMP = 7;
/**
 * How long a movement key has to be held before a posed chameleon gets up.
 *
 * Standing up out of a pose used to happen on the first frame a key went down,
 * which made every pose one twitch of W away from being abandoned — a chameleon
 * nudging themselves into place against a wall popped upright and started
 * marching. Half a second is long enough that it reads as a decision and short
 * enough that it never feels like the controls are lagging.
 *
 * **It is only the way *out* of a pose.** A body already standing — every
 * hunter, and a chameleon holding POSES[0] — walks on the frame the key goes
 * down. The delay is on unfolding, which is the part that takes a moment in
 * life too; there is nothing to delay on the way back, because there is no way
 * back — walking keeps the standing pose it stood up into.
 */
const RISE_DELAY = 0.5;
/**
 * How close the follow camera has to be pushed before the local figure is
 * hidden. Comfortably outside a chameleon, whose standing half-height is 0.66,
 * so it only ever engages once the room has squeezed the lens in against the
 * body — see `CRAMPED_DISTANCE` in `camera.ts`.
 *
 * Local only: everybody else still sees the body, and nothing about it reaches
 * the wire. It is a rendering decision about one player's own view.
 */
const FIGURE_HIDE_DISTANCE = 1.0;
const TAU = Math.PI * 2;

/** The shortest way round from `from` to `to`, in radians. Yaw is unbounded —
 *  Q and E have been adding to it all round — so the naive difference can be
 *  several turns and would spin the body the long way. */
function shortestTurn(from: number, to: number) {
  return (((to - from + Math.PI) % TAU) + TAU) % TAU - Math.PI;
}

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
  hunting = false,
  brush,
  onBrush,
  picking = false,
  onPicked,
}: {
  role: Role;
  /** Where this map puts a body. Must be a stable array — see `SPAWN`. */
  spawn?: [number, number, number];
  /** A hunter who opened the palette: they step out to third person to paint. */
  painting: boolean;
  paused: boolean;
  /** Rooted to the spot, but still able to look around. */
  frozen?: boolean;
  /** The hunt is on. Slows a hunter down — see `HUNT_SLOWDOWN`. */
  hunting?: boolean;
  brush: Brush;
  /** Right-dragging the body resizes the brush, so this owns the change. */
  onBrush: (b: Brush) => void;
  /** The eyedropper is armed: the next left click takes a colour off the screen. */
  picking?: boolean;
  onPicked?: (hex: string) => void;
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
    upright: false,
  });

  const solids = useRef<THREE.Object3D[]>([]);
  /** The subset of `solids` that is floor, wall or ceiling. The follow camera
   *  stops on these and passes through everything else. */
  const shell = useRef<THREE.Object3D[]>([]);
  /** Which version of the world `solids` was collected from. -1 forces a first
   *  pass on the very first frame. */
  const solidsRevision = useRef(-1);
  /** The pose the player has *chosen*. What the body is actually holding is
   *  `activePose`, which stands them up to walk. */
  const [pose, setPose] = useState(0);
  /** Walking on the ground, unclung. React state rather than a frame-loop local
   *  for the same reason `surfaceKind` is: it can change the pose, and the
   *  collider is keyed on the pose's box. */
  const [walking, setWalking] = useState(false);
  /** **X: keep a pose that could lie flat on its feet instead.** Off is lying,
   *  which is the game's default and what every pose was fitted for. React
   *  state, and for the same reason `surfaceKind` is: it turns the pose's box,
   *  and the collider is keyed on that box. */
  const [upright, setUpright] = useState(false);
  /** What the body is stuck to. React state rather than a frame-loop local
   *  because the collider is keyed on the pose's box, and a pose that lies flat
   *  gets a different box standing up — so a cling has to re-render. */
  const [surfaceKind, setSurfaceKind] = useState<number>(CLING_NONE);

  /** Your own footsteps. Remote figures get one of these each in SoundStage;
   *  yours lives here because this is the only place that knows you are on the
   *  ground — nobody else's `grounded` is on the wire. */
  const stepper = useRef(new Stepper(strideFor(role)));

  /**
   * **A chameleon walks upright, and walking spends the pose rather than
   * borrowing it.** A body lying flat has no legs to walk on, so moving off
   * unfolds them — and once they are up they stay up: stopping leaves the
   * chameleon standing, and getting back into a pose is a thing you ask for.
   * It used to snap back to whatever was last pressed the instant the keys
   * were released, which meant a chameleon could never walk away from a hiding
   * place without dropping into it again at the far end, and every adjustment
   * of a hiding spot ended in the pose the player was trying to leave.
   * `nowWalking` is what commits it, below. A hunter never leaves POSES[0]
   * anyway.
   *
   * It is the same change pressing a number key makes, through the same code:
   * the box, the collider, the feet-stay-put shift and `net.pose` all follow
   * from this one value.
   */
  const activePose = role === "chameleon" && walking ? 0 : pose;

  /** How far through the walk cycle the legs are, in radians. **One footfall is
   *  half a cycle**, and it is measured in strides off the same odometer the
   *  footstep sound is timed on — so the legs land with the steps you can hear
   *  by construction, and stop dead in mid-air rather than being carried along
   *  by a fall. See `gait.ts` and `sound/footsteps.ts`. */
  const stride = strideFor(role);
  const gaitPhase = () => (walkedDistance() / stride) * Math.PI;

  // Published for the pose wheel, which opens with the pose you are holding
  // already lit. See `poseRequest.ts`.
  useEffect(() => reportPose(pose), [pose]);

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
    const poseHalf = poseExtents(activePose, [hx, hy, hz], surfaceKind, upright);
    const half = poseHalf[1];
    const centre = poseCentre(activePose, hy, surfaceKind, upright);
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

    // **How much room there is to stand up in.** A pose is not always something
    // you can leave: lying under a bed or curled into a cupboard, the box is a
    // fraction of the standing one, and unfolding would put the rest of the body
    // through whatever is overhead. Measured from the feet, because a pose
    // change keeps the *underside* of the box put.
    //
    // Not measured while clinging: the box has turned to hold a wall and "up"
    // is no longer the direction the body would grow in.
    // `m.cling` is last frame's, which is all there is this early in the loop —
    // and a frame's lag on "am I on a wall" is not something a pose change feels.
    const clear = m.cling ? Infinity : headroom(bodyPos, bodyPos.y + foot, solids.current);
    /** Whether pose `i` would fit where the body is. */
    const fits = (i: number) =>
      poseExtents(i, [hx, hy, hz], surfaceKind, upright)[1] * 2 <= clear;

    // Poses are a chameleon's whole game. A hunter hunts upright and never leaves
    // POSES[0], so the number keys simply are not theirs.
    // Drained whoever we are, so a request made a moment before the draw made
    // us a hunter cannot sit here and fire at the start of the next round.
    const wheeled = takePoseRequest();
    if (role === "chameleon") {
      for (let i = 0; i < POSES.length; i++) {
        if (keys[poseControl(i)] && pose !== i && fits(i)) {
          setPose(i);
          break;
        }
      }
      // The wheel is the other way in, and it arrives from the HUD rather than
      // from a key drei is watching. Second, so a number key pressed in the
      // same frame is not overridden by a stale wheel.
      if (wheeled !== null && wheeled !== pose && fits(safePose(wheeled))) {
        setPose(safePose(wheeled));
      }
      // On the press, not on the hold — the same edge `jumpHeld` catches, or a
      // key held for a tenth of a second flips the body five times.
      if (keys.flatToggle && !m.flatHeld) setUpright((u) => !u);
    }
    m.flatHeld = keys.flatToggle;

    // Movement follows where you are looking, not where the figure faces.
    const y = view.yaw;

    // Both of these are slowed while the palette is up — see `PAINT_SLOWDOWN`.
    // One factor rather than two, so walking and turning stay in proportion:
    // a body that crept but spun would be worse to paint on than either.
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

    // Walking is *asking* to walk, not travelling: a body pressed into a wall
    // has stopped moving and has plainly not stopped walking, and a pose that
    // flickered back on every doorframe would rebuild the collider each time.
    // Coyote time stands in for `grounded` so a step down a stair or off a kerb
    // is not read as leaving the ground either.
    //
    // **And walking is standing up.** `activePose` unfolds a chameleon to
    // POSES[0] to walk, so somewhere with no room to stand is somewhere with no
    // room to walk — without this, a movement key under a bed unfolds the body
    // straight through it, and the walk cycle plays while it happens.
    const wantsWalk =
      !clinging && (m.grounded || m.coyote > 0) && move.lengthSq() > 0 && fits(0);

    // **Getting up takes a moment; sitting back down does not.** The ask is
    // timed rather than obeyed, so a pose survives a nudge of the movement
    // keys — see `RISE_DELAY`. `pose === 0` is already on its feet and has
    // nothing to unfold, which is every hunter and a chameleon who chose to
    // stand. The timer is zeroed by the ask stopping, not by walking, so
    // letting go for a frame costs the whole half second again; and `fits(0)`
    // is re-tested every frame of it, so walking under a bed mid-rise simply
    // never completes it.
    m.unfolding = wantsWalk ? m.unfolding + delta : 0;
    const nowWalking = wantsWalk && (pose === 0 || m.unfolding >= RISE_DELAY);
    if (nowWalking !== walking) setWalking(nowWalking);
    // **Standing up is a decision, so it sticks.** `activePose` already has the
    // body upright for the walk; this is what makes the choice outlast the key,
    // by writing the standing pose back into the one the player owns. Doing it
    // here rather than off `walking` keeps it on the same frame as the unfold —
    // and it costs no extra collider rebuild, because the box has already
    // changed to POSES[0]'s on the frame `nowWalking` first went true.
    if (nowWalking && pose !== 0) setPose(0);

    // **A walking chameleon faces where it is going, not where it is looking.**
    // Movement has always followed the camera rather than the figure, so a body
    // left pointing wherever Q and E last put it walks sideways and backwards
    // for most of a round. Facing the *camera* was the first cut of this and
    // was wrong by exactly the strafe keys: A walked you left while the figure
    // marched forward. `move` is already the world direction being asked for,
    // so the heading is read straight off it — and because it is camera-
    // relative, turning the camera mid-walk turns the body after it.
    //
    // Only while walking: standing still is when the figure is being *placed*,
    // and Q and E are what place it. A hunter faces their camera every frame,
    // above, and has no strafe to be wrong about.
    if (role === "chameleon" && nowWalking) {
      // A yaw of `b` points along (-sin b, 0, -cos b), which is what the visual
      // group and the camera's own forward are both built from.
      const heading = Math.atan2(-move.x, -move.z);
      m.bodyYaw += shortestTurn(m.bodyYaw, heading) * (1 - Math.exp(-FACE_DAMP * delta));
    }

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
    net.pose = activePose;
    // Sent so other clients can keep a climber's footsteps quiet — their
    // stepper only sees a position, and sliding along a wall looks like
    // walking — and so they know which way up to draw a pose that lies flat.
    net.cling = surface;
    // Cosmetic, but not local: the pose it changes is what a chameleon is
    // hiding as, so everybody has to draw the same body.
    net.upright = upright;

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
        pose: activePose,
        half: poseExtents(activePose, [hx, hy, hz], surfaceKind, upright),
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
      const seat = followThirdPerson(
        state.camera,
        bodyPos,
        lookDir,
        view.zoom,
        shell.current,
        delta,
      );
      // **A figure the lens is inside is not a figure, it is a wall of skin.**
      // Looking up puts the camera under the body and a low ceiling gives it
      // nowhere else to be, so the last few centimetres are bought by hiding
      // what it is inside of. Never while painting: that is the one mode whose
      // whole purpose is looking at your own body, and it holds the camera at
      // `PAINT_ZOOM` anyway, well outside this.
      if (visual.current) visual.current.visible = painting || seat > FIGURE_HIDE_DISTANCE;
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
            key={poseExtents(activePose, [hx, hy, hz], surfaceKind, upright).join()}
            ref={collider}
            args={poseExtents(activePose, [hx, hy, hz], surfaceKind, upright)}
            // Only until the first frame loop turns it into the body's yaw.
            position={[...poseCentre(activePose, hy, surfaceKind, upright)]}
          />
        )}
        <group ref={visual}>
          {/* In first person the camera sits inside the head, so the hunter's
              own figure is hidden and the viewmodel stands in for it. */}
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
