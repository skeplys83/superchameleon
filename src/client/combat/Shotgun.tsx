/**
 * The shotgun prop, barrel pointing down -Z. Shared by the hunter's own
 * viewmodel and by the figure other players see.
 *
 * **It casts no shadow**, for both of the things it is. As a viewmodel it hangs
 * off the camera, so a shadow from it is thrown by nothing anybody can see; and
 * on a body it is the one piece of a player still casting once `figure/`
 * stopped — a gun-shaped shadow with no owner under it, which gives away more
 * than the body would have.
 */
export function Shotgun({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      {/* barrel */}
      <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.9, 12]} />
        <meshStandardMaterial color="#111111" roughness={0.45} />
      </mesh>
      {/* pump */}
      <mesh position={[0, -0.06, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.3, 12]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.6} />
      </mesh>
      {/* receiver */}
      <mesh position={[0, -0.02, 0.05]}>
        <boxGeometry args={[0.09, 0.11, 0.34]} />
        <meshStandardMaterial color="#111111" roughness={0.5} />
      </mesh>
      {/* stock */}
      <mesh position={[0, -0.09, 0.34]} rotation={[0.18, 0, 0]}>
        <boxGeometry args={[0.08, 0.13, 0.36]} />
        <meshStandardMaterial color="#0d0d0d" roughness={0.6} />
      </mesh>
    </group>
  );
}
