import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { onLeftRoom, onMark, type NetMark } from "@/client/net";

/** A shot patch, as the scene holds it. */
export type Mark = NetMark;

/**
 * **The yellow patch is hidden, not deleted.** It is where the pellets landed
 * and it is still what the whole mark is positioned and oriented by — the
 * tracer's far end is this plane's centre — so removing it would mean rewriting
 * what a mark *is* to get rid of a decal. `visible` costs nothing at draw time
 * and turning it back on is one word.
 */
const SHOW_PATCH = false;

/** Thick enough to read as a beam rather than a scratch. It was a 4 mm hairline
 *  when it was a black line and nobody was meant to look at it. */
const TRACER_RADIUS = 0.03;

const TRACER_OPACITY = 0.85;

/**
 * The spiral. `TWIST` is how many times the hue wraps round the tube's
 * circumference and `PITCH` is how many times it repeats per **metre** along
 * it — a length in the world, not a fraction of the shot, or the stripes would
 * stretch on a long shot and bunch on a short one and no two beams would look
 * like the same thing. Together they are the barber-pole's lean.
 */
const TRACER_TWIST = 2;
const TRACER_PITCH = 1.2;

/** Turns per second the spiral rotates about its own axis, and hue cycles per
 *  second it runs along the beam. Both positive travel muzzle → wall; negative
 *  reads as the shot being pulled back in. */
const TRACER_SPIN = 0.6;
const TRACER_SPEED = 1.2;

const MARK_LIFETIME = 3000;

/** The beam's whole life, in seconds — the same window the mark itself lives
 *  for, so the fade lands exactly as the mark is dropped rather than leaving a
 *  beam to blink out at full brightness. */
const TRACER_FADE = MARK_LIFETIME / 1000;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The path a shot took: a rainbow spiral that turns about its own axis and
 * fades out over the mark's life.
 *
 * A `ShaderMaterial` rather than a scrolling texture. The hue is a function of
 * where a fragment is on the tube — `uv.y` along it, `uv.x` around it — so the
 * helix costs no geometry, there is no image to author and none to filter, and
 * the two rotations are one addition each. **`uv.y` is scaled by the shot's
 * real length**, so the stripes are a fixed size in the world instead of a
 * fixed count per shot.
 *
 * **A material per beam**, because two of the uniforms are the beam's own: how
 * long it is, and how far through its life it is. They still read the scene
 * clock, so they turn in step regardless.
 */
function tracerParams(): THREE.ShaderMaterialParameters {
  return {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Built fresh per beam rather than shared: `THREE.ShaderMaterial` takes the
    // uniforms object by reference, so one literal would give every tracer the
    // same `uLength` and the same fade.
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uLength: { value: 1 },
      uTwist: { value: TRACER_TWIST },
      uPitch: { value: TRACER_PITCH },
      uSpin: { value: TRACER_SPIN },
      uSpeed: { value: TRACER_SPEED },
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
      uniform float uTime;
      uniform float uFade;
      uniform float uLength;
      uniform float uTwist;
      uniform float uPitch;
      uniform float uSpin;
      uniform float uSpeed;
      uniform float uOpacity;
      varying vec2 vUv;

      // Hue to RGB, the six-line version. Saturation and value are pinned at 1:
      // this is a beam, and a desaturated rainbow is a smear.
      vec3 hue(float h) {
        vec3 k = abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
        return clamp(k, 0.0, 1.0);
      }

      void main() {
        // Along the tube in metres, and around it in turns. The spin goes on
        // the angular term and the travel on the axial one, so the spiral can
        // rotate and run at once without the two cancelling.
        float along  = vUv.y * uLength * uPitch - uTime * uSpeed;
        float around = (vUv.x - uTime * uSpin) * uTwist;
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

  // Memoised, so a re-render of `Marks` — which happens on every shot anybody
  // fires — does not hand R3F new constructor args and rebuild the material
  // under a beam that is halfway through fading.
  const args = useMemo(() => [tracerParams()] as [THREE.ShaderMaterialParameters], []);
  const material = useRef<THREE.ShaderMaterial>(null);
  /** Wall clock at the first frame this beam drew, so the fade is its own age
   *  rather than the scene's. Null until then: `elapsedTime` is only meaningful
   *  from inside the loop. */
  const born = useRef<number | null>(null);

  useFrame((state) => {
    const m = material.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    born.current ??= now;
    // The turn reads the scene clock, so every beam on screen spins in step
    // instead of each one starting its rainbow from red.
    m.uniforms.uTime.value = now;
    m.uniforms.uLength.value = length;
    // Squared, so most of the beam's visible life is its first second and the
    // rest is a ghost — a linear fade sits at half brightness for a second and
    // a half, which reads as a rope left hanging rather than as a shot.
    const left = Math.max(0, 1 - (now - born.current) / TRACER_FADE);
    m.uniforms.uFade.value = left * left;
  });

  // A shot fired point-blank has nowhere to draw.
  if (length < 0.05) return null;

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[TRACER_RADIUS, TRACER_RADIUS, length, 20, 1, true]} />
      <shaderMaterial ref={material} args={args} />
    </mesh>
  );
}

/** Where a hunter's shot landed, and the line it travelled to get there. */
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

  /** Marks belong to the room that produced them, so leaving it drops them. */
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
