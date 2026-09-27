import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { Activity, ArrowRight, Camera, Moon, Radar, ShieldX, Siren, Sun } from 'lucide-react'
import { API, DEMO_REPLAYS, shortTime, time, type Alert, type CameraRow, type Detection } from './api'

/* ============================== small hooks ============================== */

export function useCountUp(value: number, duration = 900) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return display
}

/* ============================== theme toggle ============================== */

export function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'ops' | 'light'; onToggle: () => void }) {
  const icons = { dark: <Moon size={18} />, ops: <Radar size={18} />, light: <Sun size={18} /> }
  const titles = { dark: 'Command console', ops: 'Phosphor HUD', light: 'Editorial light' }
  return (
    <button className="icon-btn theme-toggle" onClick={onToggle} aria-label="Cycle theme" title={`Theme: ${titles[theme]} (click to cycle)`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 60, opacity: 0 }} transition={{ duration: 0.22 }} style={{ display: 'grid' }}>
          {icons[theme]}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/* ============================== map (search / route) ============================== */

function FitRoute({ points }: { points: LatLngExpression[] }) {
  const map = useMap()
  useEffect(() => { if (points.length > 1) map.fitBounds(points as [number, number][], { padding: [70, 70], maxZoom: 13 }) }, [map, points])
  return null
}

export function GujaratMap({ cameras, route = [], selected, onSelect, expanded = false }: { cameras: CameraRow[]; route?: Detection[]; selected?: string | null; onSelect?: (id: string) => void; expanded?: boolean }) {
  const positions = React.useMemo(() => route.filter(x => x.lat != null && x.lon != null).map(x => [x.lat!, x.lon!] as LatLngExpression), [route])
  return <div className={`map-wrap ${expanded ? 'map-expanded' : ''}`}>
    <MapContainer center={[23.0225, 72.5714]} zoom={11} scrollWheelZoom={false} zoomControl={false} className="map-canvas">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {positions.length > 1 && <Polyline positions={positions} pathOptions={{ color: '#ff7a45', weight: 4, opacity: 0.9, dashArray: '10 9' }} />}
      {cameras.map((camera, index) => <CircleMarker key={camera.id} center={[camera.lat, camera.lon]} radius={selected === camera.id ? 12 : 9} pathOptions={{ color: '#fff', weight: 3, fillColor: camera.status === 'active' || camera.status === 'processed' ? '#2be0c2' : '#ff7a45', fillOpacity: 1 }} eventHandlers={{ click: () => onSelect?.(camera.id) }}>
        <Tooltip direction="top" offset={[0, -12]}><strong>{camera.name}</strong><br />{camera.is_demo ? 'Demo location' : camera.status}</Tooltip>
        {route.some(x => x.camera_id === camera.id) && <Tooltip permanent direction="bottom" offset={[0, 13]} className="route-label">{route.findIndex(x => x.camera_id === camera.id) + 1 || index + 1}</Tooltip>}
      </CircleMarker>)}
      <FitRoute points={positions} />
    </MapContainer>
    <div className="map-stamp"><Camera size={13} /> AHMEDABAD / GUJARAT <span>23.02° N · 72.57° E</span></div>
    <div className="map-legend"><span><i className="legend-dot live" /> Active</span><span><i className="legend-dot" /> Demo / idle</span><span><i className="legend-line" /> Route</span></div>
  </div>
}

/* ============================== camera picture / wall ============================== */

export function CameraPicture({ camera, token, compact = false }: { camera: CameraRow; token: string; compact?: boolean }) {
  const replay = camera.is_demo ? DEMO_REPLAYS[camera.name] : undefined
  const source = replay?.video || (camera.media_url ? `${API}${camera.media_url}?token=${encodeURIComponent(token)}` : null)
  const live = !camera.is_demo && camera.path_name && camera.status === 'active'
  const caption = replay ? 'PUBLIC SAMPLE REPLAY' : camera.protocol === 'file' ? 'RECORDED FOOTAGE' : live ? 'LIVE FEED' : 'NO SOURCE'
  return <div className={compact ? 'camera-tile-media' : 'video-frame'}>
    {source ? <video src={source} poster={replay?.poster} autoPlay muted loop playsInline controls={!compact} preload="metadata" /> : live ? <iframe title={camera.name} src={`http://${location.hostname}:8889/${camera.path_name}?controls=${compact ? 'false' : 'true'}&muted=true`} allow="autoplay; fullscreen" /> : <div className="video-empty"><Camera size={compact ? 25 : 39} /><strong>No picture available</strong><span>{camera.is_demo ? 'Sample replay is missing from this build.' : 'Check source, gateway connectivity and codec support.'}</span></div>}
    <div className="video-corner">{caption}</div>
  </div>
}

export function CameraWall({ cameras, token, onOpen }: { cameras: CameraRow[]; token: string; onOpen: (camera: CameraRow) => void }) {
  return <section className="camera-wall" aria-label="Camera wall">
    <div className="camera-wall-head"><div><span className="eyebrow" style={{ marginBottom: 3 }}>VISIBLE SOURCES</span><h2>Camera wall</h2><p>Sample replays are illustrative; event records are separately labelled.</p></div><span>{cameras.length} REGISTERED</span></div>
    <div className="camera-wall-grid">
      {cameras.map((camera, i) => (
        <motion.article className="camera-tile" key={camera.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }} whileHover={{ y: -4 }}>
          <CameraPicture camera={camera} token={token} compact />
          <button className="camera-tile-open" onClick={() => onOpen(camera)}><span><strong>{camera.name}</strong><small>{camera.is_demo ? 'Illustrative replay' : camera.department}</small></span><ArrowRight size={16} /></button>
        </motion.article>
      ))}
    </div>
  </section>
}

/* ============================== stat / passport / empty ============================== */

export function Stat({ icon, label, value, detail, accent = false, delay = 0 }: { icon: React.ReactNode; label: string; value: number; detail: string; accent?: boolean; delay?: number }) {
  const display = useCountUp(value)
  return (
    <motion.div className={`stat-card ${accent ? 'accent' : ''}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }} whileHover={{ y: -3 }}>
      <div className="stat-top"><span>{label}</span><i>{icon}</i></div>
      <strong>{String(display).padStart(2, '0')}</strong>
      <small>{detail}</small>
    </motion.div>
  )
}

export function Passport({ label, value, title }: { label: string; value: string; title?: string }) { return <div className="passport-item" title={title}><span>{label}</span><strong>{value}</strong></div> }

export function AnalyticsPreview({ camera, token }: { camera: CameraRow; token: string }) {
  const [revision, setRevision] = useState(0)
  useEffect(() => { if (!camera.overlay_url) return; const timer = window.setInterval(() => setRevision(Date.now()), 1800); return () => window.clearInterval(timer) }, [camera.overlay_url])
  if (!camera.overlay_url) return null
  return <div className="analytics-preview"><div><Activity size={17} /><span><strong>Latest analyzed frame</strong><small>Vehicle boxes from the detector · refreshes while processing</small></span></div><img src={`${API}${camera.overlay_url}?token=${encodeURIComponent(token)}&v=${revision}`} alt={`Analyzed frame from ${camera.name}`} /></div>
}

export function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="empty"><div>{icon}</div><strong>{title}</strong><p>{text}</p></div> }

/* ============================== notifications ============================== */

export function NotificationPanel({ alerts, onClose, onOpenAlert, onViewAll }: { alerts: Alert[]; onClose: () => void; onOpenAlert: (alert: Alert) => void; onViewAll: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc) }
  }, [onClose])
  const top = [...alerts].filter(a => a.status !== 'confirmed' && a.status !== 'dismissed').slice(0, 4)
  return (
    <motion.div className="notif-panel" ref={ref} role="menu" initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -4 }} transition={{ duration: 0.16 }}>
      <div className="notif-panel-head"><span>NOTIFICATIONS</span><span className="count-chip">{top.length}</span></div>
      {top.length ? <div className="notif-list">{top.map(alert => <button key={alert.id} className="notif-item" onClick={() => onOpenAlert(alert)}><span className={`priority-tag ${alert.priority.toLowerCase()}`}>{alert.priority}</span><span className="notif-item-body"><strong>{alert.plate}</strong><small>{alert.camera_name} · {shortTime(alert.created_at)}</small></span></button>)}</div> : <div className="notif-empty">No pending alerts.</div>}
      <button className="notif-view-all" onClick={onViewAll}>View all alerts <ArrowRight size={14} /></button>
    </motion.div>
  )
}

/* ============================== alert card (with subtle 3D tilt) ============================== */

export function AlertCard({ alert, onClick }: { alert: Alert; onClick: () => void }) {
  const x = useMotionValue(0); const y = useMotionValue(0)
  const rX = useSpring(useTransform(y, [-40, 40], [6, -6]), { stiffness: 220, damping: 18 })
  const rY = useSpring(useTransform(x, [-90, 90], [-6, 6]), { stiffness: 220, damping: 18 })
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    x.set(e.clientX - rect.left - rect.width / 2)
    y.set(e.clientY - rect.top - rect.height / 2)
  }
  function reset() { x.set(0); y.set(0) }
  return (
    <motion.button className="alert-card" onClick={onClick} onMouseMove={handleMove} onMouseLeave={reset} style={{ rotateX: rX, rotateY: rY, perspective: 700 }} whileTap={{ scale: 0.98 }}>
      <span className={`alert-icon ${alert.gate === 'rejected' ? 'rejected' : ''}`}>{alert.gate === 'rejected' ? <ShieldX size={19} /> : <Siren size={19} />}</span>
      <span className="alert-body">
        <span className="alert-card-top"><strong>{alert.plate}</strong><span>{shortTime(alert.created_at)}</span></span>
        <span className="alert-card-sub">{alert.camera_name} · {alert.category}</span>
        <span className="alert-card-foot"><span className={`priority-tag ${alert.priority.toLowerCase()}`}>{alert.priority}</span><span className={`gate-tag ${alert.gate === 'rejected' ? 'rejected' : ''}`}>{alert.gate === 'rejected' ? 'GATE REJECTED' : `${Math.round(alert.score * 100)}% CONFIDENCE`}</span>{alert.source === 'demo' && <span className="demo-tag">DEMO</span>}</span>
      </span>
      <ArrowRight size={16} className="alert-arrow" />
    </motion.button>
  )
}

/* ============================== detection table ============================== */

export function DetectionTable({ rows }: { rows: Detection[] }) {
  return <div className="table-scroll"><table><thead><tr><th>TIME (IST)</th><th>CAMERA</th><th>PLATE</th><th>VEHICLE</th><th>CONFIDENCE</th><th>READ STATUS</th><th>SOURCE</th></tr></thead>
    <tbody>{rows.map((item, i) => (
      <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.4) }}>
        <td className="mono">{time(item.first_seen)}</td><td>{item.camera_name}</td>
        <td><strong className="plate-text">{item.plate || 'UNREADABLE'}</strong></td>
        <td>{item.vehicle_class || '—'}{item.colour && <span className="colour-tag">{item.colour}</span>}</td>
        <td><div className="confidence-cell"><span>{Math.round(item.confidence * 100)}%</span><i><b style={{ width: `${item.confidence * 100}%` }} /></i></div></td>
        <td><span className={`read-tag ${item.read_status === 'confirmed' ? 'confirmed' : ''}`}>{item.read_status}</span></td>
        <td>{item.source === 'demo' ? <span className="demo-tag">DEMO</span> : item.source}</td>
      </motion.tr>
    ))}</tbody></table>
    {rows.length === 0 && <Empty icon={<Activity />} title="No observations yet" text="Connect footage or run the synthetic scenario to inspect the full pipeline." />}
  </div>
}

/* ============================== skeletons ============================== */

export function SkeletonStats() {
  return <div className="stats-grid">{[0, 1, 2, 3].map(i => <div key={i} className="stat-card"><div className="skeleton" style={{ height: 10, width: '55%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 30, width: '40%', marginBottom: 10 }} /><div className="skeleton" style={{ height: 9, width: '65%' }} /></div>)}</div>
}
