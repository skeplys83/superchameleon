import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Shotgun } from "./Shotgun";
import { takeKick } from "./recoil";
import { clearMuzzle, publishMuzzle } from "./muzzle";
import { strideFor } from "@/client/sound/footsteps";
import { walkedDistance } from "@/client/players/gait";
import { BODY_SCALE } from "@/client/players/body";

const GUN = new THREE.Vector3(0.16, -0.2, -0.52);
const GRIP = new THREE.Vector3(0.17, -0.25, -0.42);
const PUMP = new THREE.Vector3(0.16, -0.27, -0.78);
const SHOULDER_R = new THREE.Vector3(0.34, -0.6, 0.14);
const SHOULDER_L = new THREE.Vector3(-0.32, -0.62, 0.1);
const ARM_RADIUS = 0.075;

// Barrel tip in gun-group axes. Shotgun draws 0.9 long centred at z −0.45, at
// scale 1.1 here.
const MUZZLE = new THREE.Vector3(0, 0, -0.9 * 1.1);

// Aim point down the crosshair so the whole barrel lies on the shot line —
// starting the tracer at the tip is not enough if the gun points elsewhere.
const CONVERGE = 14;

const AIM = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 0, -CONVERGE).sub(GUN).normalize(),
);

const RECOIL_STIFFNESS = 140;
// Critically damped.
const RECOIL_DAMPING = 2 * Math.sqrt(RECOIL_STIFFNESS);
const RECOIL_IMPULSE = 7;
// Radians per metre of throw — ~5° at the peak.
const RECOIL_PITCH = 0.4;
// Fixed sub-steps — integrating over the frame's own delta made the kick
// depend on the frame rate.
const RECOIL_STEP = 1 / 240;
const RECOIL_MAX_CATCHUP = 1 / 15;

const BOB_X = 0.009;
const BOB_Y = 0.007;
const BOB_FADE = 0.001;

const HUNTER_STRIDE = strideFor("hunter");

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
  const rig = useRef<THREE.Group>(null);
  const recoil = useRef(0);
  const recoilVel = useRef(0);
  const stride = useRef(0);
  const walkedAt = useRef(walkedDistance());
  const swing = useRef(0);
  const muzzle = useRef<THREE.Object3D>(null);
  const muzzleWorld = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => clearMuzzle, []);

  // Priority 1: after the camera is placed. Mount order is unreliable — Player
  // is keyed on the room and this is not, so a match crossing would read last
  // frame's camera.
  useFrame(({ camera }, delta) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const r = rig.current;
    if (!r) return;

    // gait advances only when grounded and not clinging — so the gun holds
    // still in the air.
    const walked = walkedDistance();
    const advanced = walked - walkedAt.current;
    walkedAt.current = walked;
    // Half a turn per stride; the vertical below runs at twice this.
    stride.current += (advanced / HUNTER_STRIDE) * Math.PI;

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

    r.position.set(
      Math.sin(stride.current) * BOB_X * swing.current,
      Math.sin(stride.current * 2) * BOB_Y * swing.current,
      recoil.current,
    );
    r.rotation.x = recoil.current * RECOIL_PITCH;

    const tip = muzzle.current;
    if (tip) publishMuzzle(tip.getWorldPosition(muzzleWorld));
  }, 1);

  return (
    <group ref={group}>
      {/* Scaled by BODY_SCALE.hunter — this hangs off the camera, not the body. */}
      <group scale={BODY_SCALE.hunter}>
        <group ref={rig}>
          <group position={GUN} quaternion={AIM}>
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
