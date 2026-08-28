import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Shotgun } from "./Shotgun";
import { takeKick } from "./recoil";
import { clearMuzzle, publishMuzzle } from "./muzzle";
import { strideFor } from "@/client/sound/footsteps";
import { walkedDistance } from "@/client/players/gait";
import { BODY_SCALE } from "@/client/players/body";

/** The hunter's own arms and shotgun, held out in front of the camera. */

const GUN = new THREE.Vector3(0.16, -0.2, -0.52);
const GRIP = new THREE.Vector3(0.17, -0.25, -0.42);
const PUMP = new THREE.Vector3(0.16, -0.27, -0.78);
const SHOULDER_R = new THREE.Vector3(0.34, -0.6, 0.14);
const SHOULDER_L = new THREE.Vector3(-0.32, -0.62, 0.1);
const ARM_RADIUS = 0.075;

/**
 * The end of the barrel, in the gun group's own axes.
 *
 * `Shotgun` draws its barrel 0.9 long centred at z −0.45, so the tip is at
 * z −0.9, and the viewmodel's copy is drawn at `scale={1.1}`. An empty marker
 * rather than a number added at the call site: it hangs inside the rig, so it
 * picks up the recoil, the bob, the body scale and the camera for free, and it
 * moves on its own if the gun is ever re-modelled.
 */
const MUZZLE = new THREE.Vector3(0, 0, -0.9 * 1.1);

/**
 * The gun's two idle motions. Both are deliberately tiny: this sits a few
 * centimetres from the eye, where a movement that would read as subtle on a
 * character in the world reads as the whole screen lurching.
 */
/**
 * Recoil is a spring, not a keyframe. The gun is thrown **back along the barrel
 * and the muzzle pitches up** — a shotgun into the shoulder shoves, and the
 * barrel climbs.
 *
 * **The pitch cannot move the shot, and this is why it is safe.** `shoot.ts`
 * casts from the *camera* through the centre of the screen and never reads this
 * group, so the barrel swinging off the crosshair is something you see rather
 * than something you fire. It is kept small anyway: past a few degrees the gun
 * stops looking like it is pointing where the crosshair says it is, which is a
 * lie about the aim even when the aim is honest.
 *
 * A spring is also what makes it smooth. Setting the offset outright and
 * decaying it snaps to full throw in a single frame, which reads as a glitch at
 * 60 Hz; an impulse into velocity takes ~67 ms to reach the peak, which is a
 * kick. Critically damped (`c = 2√k`), so it comes home without bouncing.
 */
const RECOIL_STIFFNESS = 140;
const RECOIL_DAMPING = 2 * Math.sqrt(RECOIL_STIFFNESS);
/** Velocity added by one shot. Peaks around 0.2 m and is home inside 0.65s —
 *  comfortably under `FIRE_INTERVAL_MS`, so kicks cannot stack. */
const RECOIL_IMPULSE = 7;
/**
 * Muzzle climb: radians of upward pitch per metre of throw, so ~5° at the peak.
 *
 * Driven off the same spring as the shove, so the climb and the return cannot
 * drift out of step — a second spring would be two sets of numbers to keep in
 * agreement for what is one impulse. The pivot is the rig's origin, which sits
 * at the eye, so the gun swings up and a touch further out as it tips; the
 * muzzle therefore travels further than the breech, which is the shape of a
 * real kick. Raise it for a wilder climb.
 */
const RECOIL_PITCH = 0.4;
/**
 * The spring is integrated in fixed sub-steps, not over the frame's own delta.
 *
 * Explicit Euler at the frame rate makes the kick depend on the frame rate: one
 * 1/30 step applies a whole frame of damping before the impulse has moved
 * anything, so the same shot peaked at 0.19 m on a 144 Hz screen and 0.05 m on
 * a 30 Hz one. Sub-stepping holds it within 3% from 144 down to 20 fps. The cap
 * bounds the catch-up after a backgrounded tab, where the frame delta arrives
 * in seconds.
 */
const RECOIL_STEP = 1 / 240;
const RECOIL_MAX_CATCHUP = 1 / 15;

/** Sideways and vertical throw of the walk, in metres. */
const BOB_X = 0.009;
const BOB_Y = 0.007;
/** How quickly the bob fades in and out as walking starts and stops. Lower is
 *  slower; this is about a seventh of a second. */
const BOB_FADE = 0.001;

/**
 * How far this body walks between footfalls — the *same* number the footstep
 * sounds count off, so the gun dips on the step rather than near it.
 */
const HUNTER_STRIDE = strideFor("hunter");

/** A capsule stretched between two points, used for a whole visible arm. */
function Arm({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const { position, quaternion, length } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    return {
      position: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5),
      quaternion: q,
      length: Math.max(0.05, len - ARM_RADIUS),
    };
  }, [from, to]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <capsuleGeometry args={[ARM_RADIUS, length, 8, 16]} />
      <meshStandardMaterial color="#ffffff" roughness={0.55} />
    </mesh>
  );
}

export function Viewmodel() {
  const group = useRef<THREE.Group>(null);
  /** Everything the camera carries. Held apart from `group` so the outer one
   *  can copy the camera exactly and this one can be nudged about. */
  const rig = useRef<THREE.Group>(null);
  /** How far back the recoil spring is holding the gun, and how fast it is
   *  moving. Metres and metres per second. The muzzle climb is a multiple of the
   *  same number rather than a state of its own — see `RECOIL_PITCH`. */
  const recoil = useRef(0);
  const recoilVel = useRef(0);
  /** Distance walked, in radians of stride. */
  const stride = useRef(0);
  /** The last reading of the walked-distance counter, so this can take the
   *  difference. */
  const walkedAt = useRef(walkedDistance());
  /** The bob's amplitude, eased so it fades in and out instead of snapping on
   *  the first and last step. */
  const swing = useRef(0);
  /** The barrel tip, so the tracer can be drawn from the gun rather than from
   *  the eye. See `muzzle.ts`. */
  const muzzle = useRef<THREE.Object3D>(null);
  const muzzleWorld = useMemo(() => new THREE.Vector3(), []);

  // A chameleon has no viewmodel and a hunter in paint mode has put theirs
  // away; either way the last barrel this published is not on screen any more.
  useEffect(() => clearMuzzle, []);

  // Priority 1: after every movement callback, which is where the camera is
  // placed. Mount order cannot be relied on — `Player` is keyed on the room and
  // this is not, so a lobby → match crossing re-registers the player *after*
  // this and the gun starts reading last frame's camera. That reads as the
  // shotgun swimming around while you walk, in matches but not in the lobby.
  useFrame(({ camera }, delta) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const r = rig.current;
    if (!r) return;

    // **Only while walking.** `gait` advances under the same condition that
    // plays a footstep — grounded and not clinging — so it stands still in the
    // air and the gun stands still with it. Reading the camera's own movement
    // instead, as this first did, bobbed the gun through every fall and jump.
    const walked = walkedDistance();
    const advanced = walked - walkedAt.current;
    walkedAt.current = walked;
    // Half a turn per stride: the vertical below runs at twice this, so it dips
    // exactly once per footfall.
    stride.current += (advanced / HUNTER_STRIDE) * Math.PI;

    // Eased rather than switched, or the gun stops mid-swing on the frame the
    // last step lands and starts from wherever it was left.
    const target = advanced > 1e-5 ? 1 : 0;
    swing.current += (target - swing.current) * (1 - Math.pow(BOB_FADE, delta));

    if (takeKick()) recoilVel.current += RECOIL_IMPULSE;
    let remaining = Math.min(delta, RECOIL_MAX_CATCHUP);
    while (remaining > 0) {
      const h = Math.min(remaining, RECOIL_STEP);
      recoilVel.current +=
        (-RECOIL_STIFFNESS * recoil.current -
          RECOIL_DAMPING * recoilVel.current) *
        h;
      recoil.current += recoilVel.current * h;
      remaining -= h;
    }

    // Figure-of-eight: the horizontal swings once a stride, the vertical twice,
    // which is what a walk does and what a plain sine does not. `+z` is back
    // towards the eye, so the recoil is straight into the shoulder.
    r.position.set(
      Math.sin(stride.current) * BOB_X * swing.current,
      Math.sin(stride.current * 2) * BOB_Y * swing.current,
      recoil.current,
    );
    // +x pitches the muzzle up: it carries the forward axis towards +y. Nothing
    // else writes this rotation, so it can be set outright rather than composed.
    r.rotation.x = recoil.current * RECOIL_PITCH;

    // After the rig is placed, so the published point carries this frame's
    // recoil and bob rather than the last one's.
    const tip = muzzle.current;
    if (tip) publishMuzzle(tip.getWorldPosition(muzzleWorld));
  }, 1);

  return (
    <group ref={group}>
      {/* This hangs off the *camera*, not off the body, so it is the one thing
          `BODY` does not scale on its own. Left alone it would grow relative to
          a shrinking world — the whole point of `BODY_SCALE` is that the room
          reads as bigger than the person in it, and a full-size shotgun in
          front of a smaller hunter says the opposite.

          Outside the rig, so the bob and the recoil are scaled with it rather
          than staying in world metres. */}
      <group scale={BODY_SCALE.hunter}>
        {/* The arms are inside the rig with the gun: they hold it, so they carry
            the recoil and the walk with it. Moving the gun alone stretches them. */}
        <group ref={rig}>
          {/* Angled slightly inward so the barrel converges on the crosshair. */}
          <group position={GUN} rotation={[0.03, -0.06, 0]}>
            <Shotgun scale={1.1} />
            <object3D ref={muzzle} position={MUZZLE} />
          </group>
          <Arm from={SHOULDER_R} to={GRIP} />
          <Arm from={SHOULDER_L} to={PUMP} />
        </group>
      </group>
    </group>
  );
}
