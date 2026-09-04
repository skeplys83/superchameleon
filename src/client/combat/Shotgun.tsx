// Casts no shadow — as a viewmodel it hangs off the camera, and on a body
// its shadow would be a gun-shape with no visible owner.
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
