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

/** Thick enough to read as a beam rather than a scratch, thin enough not to sit
 *  across the crosshair. It was a 4 mm hairline when it was a black line nobody
 *  was meant to look at, and briefly 3 cm, which read as a rope. */
const TRACER_RADIUS = 0.012;

const TRACER_OPACITY = 0.85;

/**
 * The spiral. `TWIST` is how many times the hue wraps round the tube's
 * circumference and `PITCH` is how many times it repeats per **metre** along
 * it — a length in the world, not a fraction of the shot, or the stripes would
 * stretch on a long shot and bunch on a short one and no two beams would look
 * like the same thing. Together they are the barber-pole's lean.
 */
const TRACER_TWIST = 1.2;
const TRACER_PITCH = 0.4;

/**
 * The spin, and how it dies.
 *
 * Turns per second about the tube's own axis, and hue cycles per second along
 * it — both positive travel muzzle → wall. Each falls **exponentially** from
 * its fast value towards its slow one with a time constant of
 * `TRACER_SPINDOWN`, so the beam leaves the barrel turning hard, is most of the
 * way stopped within half a second, and is all but still for the rest of its
 * life. A linear or squared ramp spends too much of the life at a middling
 * speed, which reads as a thing being turned rather than a thing running out.
 *
 * The cost is that beams no longer turn in step — they cannot, since each one's
 * rate now depends on its own age — so the phase is integrated per beam rather
 * than read off the scene clock.
 */
const TRACER_SPIN_FAST = 4.5;
const TRACER_SPIN_SLOW = 0.04;
const TRACER_SPEED_FAST = 6.5;
const TRACER_SPEED_SLOW = 0.08;
/** Seconds for the spin to fall to 1/e of the way from fast to slow. */
const TRACER_SPINDOWN = 0.45;

const MARK_LIFETIME = 3000;

/** The beam's whole life, in seconds — the same window the mark itself lives
 *  for, so the fade lands exactly as the mark is dropped rather than leaving a
 *  beam to blink out at full brightness. */
const TRACER_FADE = MARK_LIFETIME / 1000;

/** The fraction of that life the fade actually takes. The beam holds full
 *  opacity until it is about half spent and then goes — it should look like it
 *  is there and then gone, not like it is dimming from the moment it lands. */
const TRACER_TAIL = 0.45;

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
 * **A material per beam**, because most of the uniforms are the beam's own: how
 * long it is, how far through its life it is, and how far it has spun — the
 * spin rate falls with the fade, so the phase has to be integrated per beam
 * rather than read off a clock they could share.
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
      // Turns of spin and hue cycles of travel accumulated so far — a phase,
      // not a clock, because the rate changes over the beam's life.
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

  // Memoised, so a re-render of `Marks` — which happens on every shot anybody
  // fires — does not hand R3F new constructor args and rebuild the material
  // under a beam that is halfway through fading.
  const args = useMemo(() => [tracerParams()] as [THREE.ShaderMaterialParameters], []);
  const material = useRef<THREE.ShaderMaterial>(null);
  /** Wall clock at the first frame this beam drew, so the fade is its own age
   *  rather than the scene's. Null until then: `elapsedTime` is only meaningful
   *  from inside the loop. */
  const born = useRef<number | null>(null);
  /** Turns spun, and hue cycles travelled, since this beam was drawn. Integrated
   *  rather than read off the clock, because the rate falls as the beam fades. */
  const phase = useRef(0);
  const travel = useRef(0);

  useFrame((state, delta) => {
    const m = material.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    born.current ??= now;
    m.uniforms.uLength.value = length;
    // Full brightness until it is about half spent, then out. The beam is meant to
    // hang there having stopped; it was squared, which put it at half
    // brightness the moment it stopped moving and read as a fault.
    const age = now - born.current;
    const left = Math.max(0, 1 - age / TRACER_FADE);
    m.uniforms.uFade.value = Math.min(1, left / TRACER_TAIL);
    // Exponential, on its own clock rather than the fade's — the spin is spent
    // long before the beam goes, which is the point.
    const k = Math.exp(-age / TRACER_SPINDOWN);
    phase.current += (TRACER_SPIN_SLOW + (TRACER_SPIN_FAST - TRACER_SPIN_SLOW) * k) * delta;
    travel.current +=
      (TRACER_SPEED_SLOW + (TRACER_SPEED_FAST - TRACER_SPEED_SLOW) * k) * delta;
    m.uniforms.uPhase.value = phase.current;
    m.uniforms.uTravel.value = travel.current;
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
