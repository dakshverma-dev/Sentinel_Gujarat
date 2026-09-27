import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Small single-canvas badge used once, in the opened alert drawer —
// deliberately not repeated per list item to keep list scrolling cheap.
export default function AlertBadge3D({ rejected = false }: { rejected?: boolean }) {
  const color = rejected ? '#ff4f70' : '#ff7a45'
  return (
    <Canvas camera={{ position: [0, 0, 4.2], fov: 40 }} gl={{ antialias: true, alpha: true }} dpr={[1, 1.75]}>
      <Badge color={color} rejected={rejected} />
    </Canvas>
  )
}

function Badge({ color, rejected }: { color: string; rejected: boolean }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (group.current) { group.current.rotation.y = t * 0.6; group.current.rotation.x = Math.sin(t * 0.4) * 0.25 }
    if (ring.current) {
      const s = 1 + (t % 1.6) / 1.6 * 0.7
      ring.current.scale.setScalar(s)
      const mat = ring.current.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, 0.55 - (t % 1.6) / 1.6 * 0.55)
    }
  })
  return (
    <group>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <group ref={group}>
        {rejected ? (
          <mesh>
            <octahedronGeometry args={[0.85, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.35} metalness={0.2} wireframe />
          </mesh>
        ) : (
          <mesh>
            <icosahedronGeometry args={[0.85, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.3} metalness={0.25} />
          </mesh>
        )}
      </group>
      <ambientLight intensity={0.9} />
      <pointLight position={[3, 3, 4]} intensity={40} color={color} />
    </group>
  )
}
