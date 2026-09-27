import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraRow } from '../api'

export type Scene3DTheme = { clay: string; teal: string; grid: string }
export const SCENE_PALETTES: Record<'dark' | 'ops' | 'light', Scene3DTheme> = {
  dark: { clay: '#ff7a45', teal: '#2be0c2', grid: '#1c2430' },
  ops: { clay: '#ffb454', teal: '#4dffb0', grid: '#123322' },
  light: { clay: '#d9622d', teal: '#128f7c', grid: '#d8d2c6' },
}

function project(cameras: CameraRow[]) {
  if (!cameras.length) return new Map<string, [number, number]>()
  const lats = cameras.map((c) => c.lat)
  const lons = cameras.map((c) => c.lon)
  const latC = (Math.min(...lats) + Math.max(...lats)) / 2
  const lonC = (Math.min(...lons) + Math.max(...lons)) / 2
  const spread = Math.max(0.02, Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
  const scale = 4.6 / spread
  const map = new Map<string, [number, number]>()
  cameras.forEach((c) => map.set(c.id, [(c.lon - lonC) * scale, -(c.lat - latC) * scale]))
  return map
}

function GridFloor({ palette }: { palette: Scene3DTheme }) {
  const lines = useMemo(() => {
    const arr: [number, number, number][][] = []
    const n = 12; const size = 13
    for (let i = -n; i <= n; i++) {
      arr.push([[-size, 0, (i / n) * size], [size, 0, (i / n) * size]])
      arr.push([[(i / n) * size, 0, -size], [(i / n) * size, 0, size]])
    }
    return arr
  }, [])
  return (
    <group position={[0, -1.4, 0]}>
      {lines.map((pts, i) => <Line key={i} points={pts} color={palette.grid} lineWidth={1} transparent opacity={0.5} />)}
    </group>
  )
}

function RadarSweep({ palette }: { palette: Scene3DTheme }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((state) => { if (ref.current) ref.current.rotation.y = -state.clock.getElapsedTime() * 0.5 })
  return (
    <mesh ref={ref} position={[0, -1.39, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.1, 6.4, 48, 1, 0, Math.PI / 5]} />
      <meshBasicMaterial color={palette.teal} transparent opacity={0.09} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function Hub({ palette }: { palette: Scene3DTheme }) {
  const ring = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (!ring.current) return
    const t = state.clock.getElapsedTime()
    const s = 1 + (t % 2) / 2
    ring.current.scale.setScalar(s)
    const mat = ring.current.material as THREE.MeshBasicMaterial
    mat.opacity = Math.max(0, 0.5 - (t % 2) / 2 * 0.5)
  })
  return (
    <group>
      <mesh>
        <octahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial color={palette.clay} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.56, 40]} />
        <meshBasicMaterial color={palette.clay} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.58, 40]} />
        <meshBasicMaterial color={palette.clay} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function CameraNode({ camera, position, active, onSelect, palette }: { camera: CameraRow; position: [number, number]; active: boolean; onSelect: (id: string) => void; palette: Scene3DTheme }) {
  const [hovered, setHovered] = useState(false)
  const group = useRef<THREE.Group>(null)
  const isLive = camera.status === 'active' || camera.status === 'processed'
  const color = isLive ? palette.teal : palette.clay

  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.getElapsedTime()
    const bob = Math.sin(t * 1.4 + position[0] * 3) * 0.06
    group.current.position.y = bob
    const s = (active ? 1.35 : 1) * (hovered ? 1.2 : 1)
    group.current.scale.setScalar(s)
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(camera.id) }

  return (
    <group position={[position[0], 0, position[1]]}>
      <Line points={[[0, -1.35, 0], [0, 0, 0]]} color={color} transparent opacity={0.28} lineWidth={1} />
      <group ref={group} onClick={handleClick} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
        <mesh>
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.28, 20, 20]} />
          <meshBasicMaterial color={color} transparent opacity={active ? 0.28 : 0.14} />
        </mesh>
        {active && (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.4, 0.46, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
      <Html center distanceFactor={9} position={[0, 0.55, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          font: '600 9.5px "IBM Plex Mono", monospace', letterSpacing: '.03em', whiteSpace: 'nowrap',
          color: hovered || active ? '#fff' : '#8b95a8', background: hovered || active ? 'rgba(5,7,10,0.8)' : 'transparent',
          padding: hovered || active ? '4px 8px' : 0, borderRadius: 7, border: hovered || active ? '1px solid rgba(255,255,255,0.14)' : 'none',
          transition: 'all .15s', textTransform: 'uppercase',
        }}>{camera.name}</div>
      </Html>
    </group>
  )
}

function Scene({ cameras, selected, onSelect, palette }: { cameras: CameraRow[]; selected?: string | null; onSelect: (id: string) => void; palette: Scene3DTheme }) {
  const positions = useMemo(() => project(cameras), [cameras])
  const group = useRef<THREE.Group>(null)
  useFrame((state) => { if (group.current) group.current.rotation.y = Math.sin(state.clock.getElapsedTime() * 0.08) * 0.22 })
  const meshLines = useMemo(() => {
    const pts: [number, number][] = cameras.map((c) => positions.get(c.id) || [0, 0])
    const lines: [number, number, number][][] = []
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      lines.push([[pts[i][0], -1.34, pts[i][1]], [pts[j][0], -1.34, pts[j][1]]])
    }
    return lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, positions])

  return (
    <group ref={group} rotation={[0.32, 0, 0]} position={[0, 0.5, 0]}>
      <GridFloor palette={palette} />
      <RadarSweep palette={palette} />
      {meshLines.map((pts, i) => <Line key={i} points={pts} color={palette.teal} transparent opacity={0.08} lineWidth={1} />)}
      <Hub palette={palette} />
      {cameras.map((camera) => {
        const pos = positions.get(camera.id)
        if (!pos) return null
        return <CameraNode key={camera.id} camera={camera} position={pos} active={selected === camera.id} onSelect={onSelect} palette={palette} />
      })}
    </group>
  )
}

export default function CameraNetwork3D({ cameras, selected, onSelect, theme = 'dark' }: { cameras: CameraRow[]; selected?: string | null; onSelect: (id: string) => void; theme?: 'dark' | 'ops' | 'light' }) {
  const palette = SCENE_PALETTES[theme]
  return (
    <Canvas className="net3d-canvas" camera={{ position: [0, 3.4, 8.6], fov: 42 }} gl={{ antialias: true, alpha: true }} dpr={[1, 1.75]}>
      <Scene cameras={cameras} selected={selected} onSelect={onSelect} palette={palette} />
    </Canvas>
  )
}
