import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { onLeftRoom, onMark, type NetMark } from "@/client/net";

export type Mark = NetMark;

// The patch is still what a mark IS positioned by (tracer's far end).
// Toggle visible to bring the decal back.
const SHOW_PATCH = false;

const TRACER_RADIUS = 0.012;
const TRACER_OPACITY = 0.85;

// TWIST: hue wraps per circumference. PITCH: hue repeats per METRE (world
// length, not a fraction of the shot — else stripes stretch on a long shot).
const TRACER_TWIST = 1.2;
const TRACER_PITCH = 0.4;

// Spin and hue-travel each fall exponentially from fast → slow with time
// constant TRACER_SPINDOWN. Per-beam phase (rate depends on age).
const TRACER_SPIN_FAST = 4.5;
const TRACER_SPIN_SLOW = 0.04;
const TRACER_SPEED_FAST = 6.5;
const TRACER_SPEED_SLOW = 0.08;
const TRACER_SPINDOWN = 0.45;

const MARK_LIFETIME = 3000;

const TRACER_FADE = MARK_LIFETIME / 1000;

// Holds full opacity until half spent, then goes.
const TRACER_TAIL = 0.45;

const UP = new THREE.Vector3(0, 1, 0);

function tracerParams(): THREE.ShaderMaterialParameters {
  return {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Fresh per beam — ShaderMaterial takes uniforms by reference.
    uniforms: {
      uPhase: { value: 0 },
      uTravel: { value: 0 },
      uFade: { value: 1 },
      uLength: { value: 1 },
      uTwist: { value: TRACER_TWIST },
      uPitch: { value: TRACER_PITCH },
      uOpacity: { value: TRACER_OPACITY },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPhase;
      uniform float uTravel;
      uniform float uFade;
      uniform float uLength;
      uniform float uTwist;
      uniform float uPitch;
      uniform float uOpacity;
      varying vec2 vUv;

      vec3 hue(float h) {
        vec3 k = abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
        return clamp(k, 0.0, 1.0);
      }

      void main() {
        float along  = vUv.y * uLength * uPitch - uTravel;
        float around = (vUv.x - uPhase) * uTwist;
        gl_FragColor = vec4(hue(fract(along + around)), uOpacity * uFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}

function Tracer({ from, to }: { from: NetMark["origin"]; to: NetMark["position"] }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const span = new THREE.Vector3().subVectors(b, a);
    return {
      position: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, span.clone().normalize()),
      length: span.length(),
    };
  }, [from, to]);

  // Memoised so a re-render of Marks does not rebuild the material.
  const args = useMemo(() => [tracerParams()] as [THREE.ShaderMaterialParameters], []);
  const material = useRef<THREE.ShaderMaterial>(null);
  const born = useRef<number | null>(null);
  // Integrated because the rate falls with the beam's age.
  const phase = useRef(0);
  const travel = useRef(0);

  useFrame((state, delta) => {
    const m = material.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    born.current ??= now;
    m.uniforms.uLength.value = length;
    const age = now - born.current;
    const left = Math.max(0, 1 - age / TRACER_FADE);
    m.uniforms.uFade.value = Math.min(1, left / TRACER_TAIL);
    const k = Math.exp(-age / TRACER_SPINDOWN);
    phase.current += (TRACER_SPIN_SLOW + (TRACER_SPIN_FAST - TRACER_SPIN_SLOW) * k) * delta;
    travel.current +=
      (TRACER_SPEED_SLOW + (TRACER_SPEED_FAST - TRACER_SPEED_SLOW) * k) * delta;
    m.uniforms.uPhase.value = phase.current;
    m.uniforms.uTravel.value = travel.current;
  });

  if (length < 0.05) return null;

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[TRACER_RADIUS, TRACER_RADIUS, length, 20, 1, true]} />
      <shaderMaterial ref={material} args={args} />
    </mesh>
  );
}

export function Marks() {
  const [marks, setMarks] = useState<Mark[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    const off = onMark((m) => {
      setMarks((prev) => [...prev, m]);
      pending.push(
        setTimeout(
          () => setMarks((prev) => prev.filter((x) => x.id !== m.id)),
          MARK_LIFETIME,
        ),
      );
    });
    return () => {
      off();
      pending.forEach(clearTimeout);
    };
  }, []);

  useEffect(
    () =>
      onLeftRoom(() => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setMarks([]);
      }),
    [],
  );

  return (
    <>
      {marks.map((m) => (
        <group key={m.id}>
          <mesh position={m.position} rotation={m.rotation} visible={SHOW_PATCH}>
            <planeGeometry args={[0.6, 0.6]} />
            <meshStandardMaterial
              color="#facc15"
              emissive="#facc15"
              emissiveIntensity={0.4}
              roughness={0.6}
              side={THREE.DoubleSide}
            />
          </mesh>
          {m.origin && <Tracer from={m.origin} to={m.position} />}
        </group>
      ))}
    </>
  );
}
