import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const CLAY = '#ff7a45'
const TEAL = '#2be0c2'
const NODE_COUNT = 9

function useIcosphereEdges(radius: number, detail: number) {
  return useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(radius, detail)
    return new THREE.EdgesGeometry(geo, 1)
  }, [radius, detail])
}

function CoreOrb() {
  const group = useRef<THREE.Group>(null)
  const outer = useIcosphereEdges(2.35, 1)
  const inner = useIcosphereEdges(1.55, 0)

  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.getElapsedTime()
    group.current.rotation.y = t * 0.09
    group.current.rotation.x = Math.sin(t * 0.15) * 0.18
  })

  return (
    <group ref={group}>
      <lineSegments geometry={outer}>
        <lineBasicMaterial color={CLAY} transparent opacity={0.35} />
      </lineSegments>
      <lineSegments geometry={inner} rotation={[0.4, 0.6, 0]}>
        <lineBasicMaterial color={TEAL} transparent opacity={0.28} />
      </lineSegments>
      <mesh>
        <sphereGeometry args={[1.05, 32, 32]} />
        <meshBasicMaterial color={CLAY} transparent opacity={0.07} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.4, 24, 24]} />
        <meshBasicMaterial color={TEAL} transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

function OrbitingNodes() {
  const nodes = useMemo(() => new Array(NODE_COUNT).fill(0).map((_, i) => ({
    radius: 3.1 + (i % 3) * 0.55,
    speed: 0.12 + (i % 4) * 0.045,
    phase: (i / NODE_COUNT) * Math.PI * 2,
    tilt: ((i * 37) % 180) * (Math.PI / 180),
    color: i % 2 === 0 ? CLAY : TEAL,
  })), [])
  const refs = useRef<(THREE.Group | null)[]>([])
  const lineRefs = useRef<(THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null)[]>([])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    nodes.forEach((n, i) => {
      const angle = t * n.speed + n.phase
      const x = Math.cos(angle) * n.radius
      const z = Math.sin(angle) * n.radius
      const y = Math.sin(angle * 1.7 + n.tilt) * 0.9
      const g = refs.current[i]
      if (g) {
        g.position.set(x, y, z)
        const pulse = 0.75 + Math.sin(t * 2.4 + n.phase * 3) * 0.25
        g.scale.setScalar(pulse)
      }
      const line = lineRefs.current[i]
      if (line) {
        const positions = (line.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute
        positions.setXYZ(1, x, y, z)
        positions.needsUpdate = true
      }
    })
  })

  return (
    <group>
      {nodes.map((n, i) => (
        <line key={`l-${i}`} ref={(el) => { lineRefs.current[i] = el as unknown as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null }}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, n.radius, 0, 0]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={n.color} transparent opacity={0.22} />
        </line>
      ))}
      {nodes.map((n, i) => (
        <group key={`n-${i}`} ref={(el) => { refs.current[i] = el }}>
          <mesh>
            <sphereGeometry args={[0.075, 16, 16]} />
            <meshBasicMaterial color={n.color} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshBasicMaterial color={n.color} transparent opacity={0.18} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function DriftDust() {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const arr = new Float32Array(260 * 3)
    for (let i = 0; i < 260; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 14
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10
      arr[i * 3 + 2] = (Math.random() - 0.5) * 10
    }
    return arr
  }, [])
  useFrame((state) => { if (ref.current) ref.current.rotation.y = state.clock.getElapsedTime() * 0.015 })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.028} color="#ffffff" transparent opacity={0.35} sizeAttenuation depthWrite={false} />
    </points>
  )
}

export default function NetworkOrb({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas camera={{ position: [0, 0.6, 8.5], fov: 48 }} gl={{ antialias: true, alpha: true }} dpr={[1, 1.75]}>
        <DriftDust />
        <CoreOrb />
        <OrbitingNodes />
      </Canvas>
    </div>
  )
}
