import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { onRoster, remotes } from "@/client/net";
import { CLING_NONE } from "@/shared/protocol";
import { strideFor } from "@/client/sound/footsteps";
import { BODY, BODY_SCALE } from "./body";

/** How far the name badge floats above the top of the head, at full size. */
const BADGE_GAP = 0.55;
/** Vertical speed past which a remote body is falling rather than walking, in
 *  units per second. Nobody's `grounded` is on the wire — this is the same kind
 *  of guess `SoundStage` makes to keep a climber's footsteps quiet — and a ramp
 *  taken at full speed stays well under it. */
const AIRBORNE_DROP = 4;
import { StickFigure } from "@/client/figure/StickFigure";
import { Shotgun } from "@/client/combat/Shotgun";

/** Every remote figure's root, so a hunter's shot can raycast the people in the room. */
export const remoteFigures = new Map<string, THREE.Group>();

const targetPos = new THREE.Vector3();
const targetEuler = new THREE.Euler(0, 0, 0, "YXZ");
const targetQuat = new THREE.Quaternion();

function RemotePlayer({
  id,
  reveal,
  hunting,
}: {
  id: string;
  reveal: boolean;
  hunting: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const remote = remotes.get(id);
  const role = remote?.role ?? "chameleon";
  const [, hy] = BODY[role];
  const settled = useRef(false);
  /** This body's own odometer, in radians of walk cycle. `players/gait.ts` is
   *  the local player's and nothing like it crosses the wire, so a remote's is
   *  measured off the positions we are already interpolating between. */
  const gait = useRef(0);
  const lastPos = useRef(new THREE.Vector3());
  const stride = strideFor(role);

  useEffect(() => {
    const g = group.current;
    if (g) remoteFigures.set(id, g);
    return () => {
      remoteFigures.delete(id);
    };
  }, [id]);

  useFrame((_, delta) => {
    const g = group.current;
    const r = remotes.get(id);
    if (!g || !r) return;

    targetPos.set(r.target.x, r.target.y, r.target.z);
    // Snap on the first frame so a joining player doesn't fly in from origin.
    const wasSettled = settled.current;
    if (wasSettled) {
      g.position.lerp(targetPos, 1 - Math.pow(0.0000001, delta));
    } else {
      g.position.copy(targetPos);
      settled.current = true;
    }

    // The walk cycle, from the distance the body has actually covered on screen.
    // Horizontal only, and never while climbing or dropping — legs that keep
    // striding through a fall are worse than legs that do not move at all. The
    // snap frame is skipped or a joining player arrives mid-sprint.
    if (wasSettled) {
      const dx = g.position.x - lastPos.current.x;
      const dy = g.position.y - lastPos.current.y;
      const dz = g.position.z - lastPos.current.z;
      const walking = r.target.cling === CLING_NONE && Math.abs(dy) < AIRBORNE_DROP * delta;
      // One footfall is π, exactly as the local player's phase is measured.
      if (walking) gait.current += (Math.hypot(dx, dz) / stride) * Math.PI;
    }
    lastPos.current.copy(g.position);

    // Only yaw here: a pose's roll is animated inside StickFigure.
    targetEuler.set(0, r.target.yaw, 0);
    targetQuat.setFromEuler(targetEuler);
    visual.current?.quaternion.slerp(targetQuat, 1 - Math.pow(0.0000001, delta));
  });

  if (!remote) return null;

  return (
    <group ref={group} userData={{ remoteId: id }}>
      <group ref={visual}>
        {/* A hunter holds the gun out along their aim, so chameleons can read both
            where they are looking and how far up or down. */}
        <StickFigure
          scale={hy}
          // A getter, like `pose`: a network patch mutates `target` in place
          // and deliberately does not re-render this tree.
          surface={() => remote.target.cling}
          gait={() => gait.current}
          upright={() => remotes.get(id)?.target.upright ?? false}
          pose={() => remotes.get(id)?.target.pose ?? 0}
          skinId={id}
          aim={
            remote.role === "hunter"
              ? () => remotes.get(id)?.target.pitch ?? 0
              : null
          }
          holding={remote.role === "hunter" ? <Shotgun scale={1.05} /> : null}
          /* Anyone still a chameleon when the round is over survived it — the
             caught ones are hunters by now — so during the reveal they light up
             through the walls and the spot that beat you stops being a mystery. */
          highlight={reveal && remote.role === "chameleon"}
        />
      </group>
      {/* The gap is scaled with the body too, or a shrinking figure keeps its
          badge the same distance overhead and it drifts away from the head. */}
      {!(hunting && remote.role === "chameleon") && (
        <Html position={[0, hy + BADGE_GAP * BODY_SCALE[role], 0]} center distanceFactor={14}>
          <div className="whitespace-nowrap rounded bg-black/60 px-2 py-0.5 font-mono text-[13px] text-white">
            {remote.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function RemotePlayers({
  reveal = false,
  hunting = false,
}: {
  reveal?: boolean;
  /** The hunt is on, so hidden players must not be labelled. */
  hunting?: boolean;
}) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => onRoster(setIds), []);

  return (
    <>
      {ids.map((id) => (
        <RemotePlayer key={id} id={id} reveal={reveal} hunting={hunting} />
      ))}
    </>
  );
}
