import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { onRoster, remotes } from "@/client/net";
import { CLING_NONE } from "@/shared/protocol";
import { strideFor } from "@/client/sound/footsteps";
import { BODY, BODY_SCALE } from "./body";

const BADGE_GAP = 0.55;
// Nobody's `grounded` is on the wire — a fast ramp stays under this.
const AIRBORNE_DROP = 4;
import { StickFigure } from "@/client/figure/StickFigure";
import { Shotgun } from "@/client/combat/Shotgun";

// Every remote's root, so shots can raycast people.
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
  // Measured off interpolated positions — nothing like gait.ts crosses the wire.
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
    // Snap on the first frame so a joining player does not fly in from origin.
    const wasSettled = settled.current;
    if (wasSettled) {
      g.position.lerp(targetPos, 1 - Math.pow(0.0000001, delta));
    } else {
      g.position.copy(targetPos);
      settled.current = true;
    }

    // Horizontal only, and never climbing or falling — legs striding through a
    // fall are worse than legs that do not move at all.
    if (wasSettled) {
      const dx = g.position.x - lastPos.current.x;
      const dy = g.position.y - lastPos.current.y;
      const dz = g.position.z - lastPos.current.z;
      const walking = r.target.cling === CLING_NONE && Math.abs(dy) < AIRBORNE_DROP * delta;
      if (walking) gait.current += (Math.hypot(dx, dz) / stride) * Math.PI;
    }
    lastPos.current.copy(g.position);

    targetEuler.set(0, r.target.yaw, 0);
    targetQuat.setFromEuler(targetEuler);
    visual.current?.quaternion.slerp(targetQuat, 1 - Math.pow(0.0000001, delta));
  });

  if (!remote) return null;

  return (
    <group ref={group} userData={{ remoteId: id }}>
      <group ref={visual}>
        <StickFigure
          scale={hy}
          // Getters — network patches mutate `target` and do not re-render.
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
          // Anyone still a chameleon at reveal survived — light them up.
          highlight={reveal && remote.role === "chameleon"}
        />
      </group>
      {/* Badge gap scaled with the body — else it drifts on smaller figures. */}
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
