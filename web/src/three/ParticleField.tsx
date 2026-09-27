import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// A quiet field of drifting points behind the whole console. Cheap (one
// draw call, no postprocessing) and never intercepts pointer events.
function Field({ count = 900, accent = '#ff7a45', accent2 = '#2be0c2' }: { count?: number; accent?: string; accent2?: string }) {
  const pointsRef = useRef<THREE.Points>(null)
  const mouse = useRef({ x: 0, y: 0 })
  const { viewport } = useThree()

  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const c1 = new THREE.Color(accent)
    const c2 = new THREE.Color(accent2)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18 - 4
      const mixed = c1.clone().lerp(c2, Math.random())
      col[i * 3] = mixed.r; col[i * 3 + 1] = mixed.g; col[i * 3 + 2] = mixed.b
    }
    return [pos, col]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  useFrame((state) => {
    if (!pointsRef.current) return
    const t = state.clock.getElapsedTime()
    pointsRef.current.rotation.y = t * 0.012
    pointsRef.current.rotation.x = Math.sin(t * 0.05) * 0.05
    mouse.current.x += (state.pointer.x * 0.6 - mouse.current.x) * 0.02
    mouse.current.y += (state.pointer.y * 0.4 - mouse.current.y) * 0.02
    pointsRef.current.position.x = mouse.current.x
    pointsRef.current.position.y = mouse.current.y
  })

  return (
    <points ref={pointsRef} scale={Math.max(viewport.width, 18) / 18}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.052} vertexColors transparent opacity={0.55} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

export default function ParticleField({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 9], fov: 55 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
        dpr={[1, 1.5]}
      >
        <Field />
      </Canvas>
    </div>
  )
}
