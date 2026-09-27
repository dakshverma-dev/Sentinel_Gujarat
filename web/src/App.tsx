import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, Camera, Check, ChevronDown, Clock3,
  Crosshair, FileText, Fingerprint, LayoutDashboard, LockKeyhole, Menu, Plus, Radio,
  Search, ShieldAlert, ShieldCheck, ShieldX, Siren, X,
} from 'lucide-react'
import {
  API, fallbackOverview, request, time,
  type Alert, type CameraRow, type Detection, type Overview, type ReportSource, type Session, type View, type Watch,
} from './api'
import {
  AlertCard, AnalyticsPreview, CameraPicture, CameraWall, DetectionTable, Empty, GujaratMap,
  NotificationPanel, Passport, SkeletonStats, Stat, ThemeToggle,
} from './components'
import { CameraModal, FaceModal, WatchlistModal } from './modals'
import { useLang } from './i18n'
import Login from './Login'
import Logo from './Logo'
import './theme.css'
import './style.css'

const ParticleField = lazy(() => import('./three/ParticleField'))
const CameraNetwork3D = lazy(() => import('./three/CameraNetwork3D'))
const AlertBadge3D = lazy(() => import('./three/AlertBadge3D'))

const pageMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] as const },
}

type Theme = 'dark' | 'ops' | 'light'
const THEME_ORDER: Theme[] = ['dark', 'ops', 'light']

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('sentinel_theme') as Theme) || 'dark')
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('sentinel_theme', theme) }, [theme])
  return [theme, () => setTheme(t => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length])]
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id) }, [])
  return now
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [session, setSession] = useState<Session | null>(() => { try { return JSON.parse(localStorage.getItem('sentinel_session') || 'null') } catch { return null } })
  const [view, setView] = useState<View>('overview')
  const [overview, setOverview] = useState<Overview>(fallbackOverview)
  const [reportSummary, setReportSummary] = useState({ tracks: 0, plates_read: 0, confirmed: 0, read_rate: 0 })
  const [reportSource, setReportSource] = useState<ReportSource>('all')
  const [cameras, setCameras] = useState<CameraRow[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [detections, setDetections] = useState<Detection[]>([])
  const [watchlist, setWatchlist] = useState<Watch[]>([])
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [netView, setNetView] = useState<'3d' | 'map'>('3d')
  const [mapMounted, setMapMounted] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [evidence, setEvidence] = useState<{ chain_valid: boolean; latest_hash: string | null; model_version: string | null } | null>(null)
  const [modal, setModal] = useState<'camera' | 'watchlist' | 'face' | null>(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [searchedPlate, setSearchedPlate] = useState('')
  const [route, setRoute] = useState<Detection[]>([])
  const [audit, setAudit] = useState<{ valid: boolean; records: number; latest_hash: string | null; failed_at: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [lang, toggleLang, t] = useLang()
  const seenAlertIds = useRef<Set<string> | null>(null)
  const token = session?.token || ''
  const now = useClock()
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 4500) }

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [nextOverview, nextCameras, nextAlerts, nextDetections, nextWatchlist, nextReportSummary] = await Promise.all([
        request<Overview>('/api/overview', token), request<CameraRow[]>('/api/cameras', token), request<Alert[]>('/api/alerts', token), request<Detection[]>('/api/detections?limit=500', token), request<Watch[]>('/api/watchlist', token), request<typeof reportSummary>(`/api/reports/summary${reportSource === 'all' ? '' : `?source=${reportSource}`}`, token),
      ])
      setOverview(nextOverview); setCameras(nextCameras); setDetections(nextDetections); setWatchlist(nextWatchlist); setReportSummary(nextReportSummary); setError('')
      const ids = new Set(nextAlerts.map(a => a.id))
      if (seenAlertIds.current) {
        const fresh = nextAlerts.filter(a => !seenAlertIds.current!.has(a.id))
        if (fresh.length === 1) notify(`Live alert: ${fresh[0].plate || fresh[0].event_type} · ${fresh[0].camera_name}`)
        else if (fresh.length > 1) notify(`${fresh.length} new alerts arrived`)
      }
      seenAlertIds.current = ids
      setAlerts(nextAlerts)
      if (!selectedCamera && nextCameras.length) setSelectedCamera(nextCameras[0].id)
      setLoaded(true)
    } catch (e) { setError((e as Error).message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedCamera, reportSource])
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 10000); return () => window.clearInterval(id) }, [load])
  useEffect(() => {
    if (!token) return
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${API}/api/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    ws.onmessage = () => { void load() }
    return () => ws.close()
  }, [token, load])
  useEffect(() => { if (view === 'audit' && token) request<typeof audit>('/api/audit/verify', token).then(setAudit).catch(e => setError(e.message)) }, [view, token])
  useEffect(() => { if (!selectedAlert) { setEvidence(null); return } request<typeof evidence>(`/api/alerts/${selectedAlert.id}/evidence`, token).then(setEvidence).catch(e => setError(e.message)) }, [selectedAlert, token])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (modal) setModal(null)
      else if (selectedAlert) setSelectedAlert(null)
      else if (notifOpen) setNotifOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, selectedAlert, notifOpen])

  async function runDemo() { setBusy(true); try { const r = await request<{ detections: number; alerts: number }>('/api/demo/run', token, { method: 'POST' }); notify(`Synthetic scenario added: ${r.detections} tracks, ${r.alerts} alerts`); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  async function searchPlate(event?: React.FormEvent) { event?.preventDefault(); if (!searchText.trim()) return; try { const result = await request<{ plate: string; sightings: Detection[] }>(`/api/search?plate=${encodeURIComponent(searchText)}`, token); setSearchedPlate(result.plate); setRoute(result.sightings); setView('search') } catch (e) { setError((e as Error).message) } }
  async function download(format: 'csv' | 'pdf') { try { const filter = reportSource === 'all' ? '' : `?source=${reportSource}`; const response = await fetch(`${API}/api/reports/${format}${filter}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Export failed'); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sentinel-vehicle-report-${reportSource}.${format}`; anchor.click(); URL.revokeObjectURL(url); notify(`${format.toUpperCase()} report downloaded`) } catch (e) { setError((e as Error).message) } }
  async function downloadEvidence(alertId: string) { try { const response = await fetch(`${API}/api/alerts/${alertId}/evidence.pdf`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Evidence export failed'); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sentinel-evidence-${alertId.slice(0, 8)}.pdf`; anchor.click(); URL.revokeObjectURL(url); notify('Evidence PDF downloaded') } catch (e) { setError((e as Error).message) } }
  async function review(alert: Alert, status: string) { const note = window.prompt(`Reason for ${status}:`); if (!note || note.trim().length < 5) return; try { await request(`/api/alerts/${alert.id}`, token, { method: 'PATCH', body: JSON.stringify({ status, note }) }); setSelectedAlert(null); notify(`Alert ${status}`); await load() } catch (e) { setError((e as Error).message) } }
  async function approveFace(entry: Watch) { try { await request(`/api/watchlist/${entry.id}/approve`, token, { method: 'POST', body: JSON.stringify({ approver: session?.user.name }) }); notify('Face entry approved'); await load() } catch (e) { setError((e as Error).message) } }
  function signOut() { localStorage.removeItem('sentinel_session'); setSession(null) }

  if (!session) return <Login onLogin={(nextToken, user) => { const next = { token: nextToken, user }; localStorage.setItem('sentinel_session', JSON.stringify(next)); setSession(next) }} />

  const nav: { id: View; title: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'overview', title: t('nav_overview'), icon: <LayoutDashboard size={18} /> },
    { id: 'cameras', title: t('nav_cameras'), icon: <Camera size={18} />, count: cameras.length },
    { id: 'search', title: t('nav_search'), icon: <Search size={18} /> },
    { id: 'watchlist', title: t('nav_watchlist'), icon: <Crosshair size={18} />, count: watchlist.length },
    { id: 'reports', title: t('nav_reports'), icon: <FileText size={18} /> },
    { id: 'audit', title: t('nav_audit'), icon: <ShieldCheck size={18} /> },
  ]
  const activeCamera = cameras.find(x => x.id === selectedCamera) || cameras[0]

  return <>
    <Suspense fallback={null}><ParticleField className="bg-canvas" /></Suspense>
    <div className="bg-grid-overlay" />
    <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark"><Logo size={22} /></div><div>SENTINEL<br /><strong>GUJARAT</strong></div></div>
      <div className="sidebar-section-label">{t('breadcrumb_ops')}</div>
      <nav>
        {nav.map(item => (
          <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => { setView(item.id); setMenuOpen(false) }}>
            {view === item.id && <motion.span className="nav-pill" layoutId="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            {item.icon}<span>{item.title}</span>{item.count != null && <small>{item.count}</small>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-card"><div className="sidebar-card-icon"><Radio size={19} /></div><strong>Pilot network</strong><p>{t('brand_tagline')}</p><span><i className="wave-bars"><i /><i /><i /><i /></i> {t('system_ready')}</span></div>
        <button className="sidebar-user" onClick={signOut}><span className="avatar">{session.user.name[0].toUpperCase()}</span><span><strong>{session.user.name}</strong><small>{session.user.role} · {t('sign_out')}</small></span><ChevronDown size={15} /></button>
      </div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-btn" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
        <div className="breadcrumb">{t('breadcrumb_ops')} <span>/</span> <strong>{nav.find(x => x.id === view)?.title.toUpperCase()}</strong></div>
        <div className="topbar-right">
          <div className="system-status"><i className="pulse-dot" /> <span>CONSOLE ONLINE</span></div>
          <div className="topbar-time"><Clock3 size={15} /> {now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST</div>
          <button className="icon-btn lang-toggle" onClick={toggleLang} title="Switch language / ભાષા બદલો">{lang === 'en' ? 'ગુજ' : 'EN'}</button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="notif-wrap">
            <button className="icon-btn bell-btn" onClick={() => setNotifOpen(o => !o)} aria-label="Notifications" aria-expanded={notifOpen}><Bell size={19} />{overview.needs_review > 0 && <i />}</button>
            <AnimatePresence>{notifOpen && <NotificationPanel alerts={alerts} onClose={() => setNotifOpen(false)} onOpenAlert={alert => { setSelectedAlert(alert); setNotifOpen(false) }} onViewAll={() => { setView('overview'); setNotifOpen(false) }} />}</AnimatePresence>
          </div>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-banner"><ShieldX size={17} /> {error}<button onClick={() => setError('')}><X size={16} /></button></div>}

        <AnimatePresence mode="wait">
          <motion.div key={view} {...pageMotion}>

            {view === 'overview' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('overview_eyebrow')}</span><h1>{t('overview_title')}</h1><p>{t('overview_sub')}</p></div><div className="heading-actions"><button className="secondary-btn" onClick={runDemo} disabled={busy}><Activity size={17} /> {busy ? 'Running…' : t('run_scenario')}</button><button className="primary-btn" onClick={() => setModal('camera')}><Plus size={18} /> {t('add_camera')}</button></div></div>
              {!loaded ? <SkeletonStats /> : <div className="stats-grid">
                <Stat icon={<Camera size={18} />} label={t('stat_cameras')} value={overview.cameras} detail={`${overview.live_cameras} active feeds`} delay={0} />
                <Stat icon={<Crosshair size={18} />} label={t('stat_tracks')} value={overview.detections} detail="all observations" delay={0.05} />
                <Stat icon={<Siren size={18} />} label={t('stat_alerts')} value={overview.alerts} detail="correlated matches" delay={0.1} />
                <Stat icon={<ShieldCheck size={18} />} label={t('stat_review')} value={overview.needs_review} detail="operator decision pending" accent delay={0.15} />
              </div>}
              <CameraWall cameras={cameras} token={token} onOpen={camera => { setSelectedCamera(camera.id); setView('cameras') }} />
              <div className="overview-grid">
                <section className="panel map-panel">
                  <div className="panel-title-row"><div><span className="eyebrow">{netView === '3d' ? '3D NETWORK VIEW' : 'GEOGRAPHIC VIEW'}</span><h2>{t('net3d_title')}</h2></div>
                    <div className="net-view-switch">
                      <button className={netView === '3d' ? 'active' : ''} onClick={() => setNetView('3d')}>{t('net_3d_mesh')}</button>
                      <button className={netView === 'map' ? 'active' : ''} onClick={() => { setMapMounted(true); setNetView('map') }}>{t('net_gujarat_map')}</button>
                    </div>
                  </div>
                  <div className="net3d-wrap" style={{ display: netView === '3d' ? 'block' : 'none' }}>
                    <Suspense fallback={null}><CameraNetwork3D cameras={cameras} selected={selectedCamera} onSelect={setSelectedCamera} theme={theme} /></Suspense>
                    <div className="net3d-stamp"><Crosshair size={13} /> AHMEDABAD / GUJARAT <span>23.02° N · 72.57° E</span></div>
                    <div className="net3d-hint">DRAG-FREE · CLICK A NODE</div>
                    <div className="net3d-legend"><span><i className="legend-dot live" /> Active</span><span><i className="legend-dot" /> Demo / idle</span><span><i className="legend-line" /> Mesh link</span></div>
                  </div>
                  {mapMounted && <div style={{ display: netView === 'map' ? 'block' : 'none' }}>
                    <GujaratMap cameras={cameras} selected={selectedCamera} onSelect={setSelectedCamera} />
                  </div>}
                  <div className="map-footer"><span><i className="signal-bars" /> {activeCamera?.name || 'No camera selected'}</span><button onClick={() => setView('cameras')}>View cameras <ArrowRight size={16} /></button></div>
                </section>
                <section className="panel alerts-panel">
                  <div className="panel-title-row"><div><span className="eyebrow">{t('decision_queue_eyebrow')}</span><h2>{t('recent_alerts')}</h2></div><span className="count-chip">{alerts.length}</span></div>
                  <div className="alert-scroll">{alerts.length ? alerts.slice(0, 5).map(alert => <AlertCard key={alert.id} alert={alert} onClick={() => setSelectedAlert(alert)} />) : <Empty icon={<Bell size={25} />} title="No alerts yet" text="Run the synthetic scenario or connect a feed and add a watchlist plate." />}</div>
                </section>
              </div>
              <div className="lower-grid">
                <section className="panel"><div className="panel-title-row"><div><span className="eyebrow">RECENT OBSERVATIONS</span><h2>Detection log</h2></div><button className="text-link" onClick={() => setView('reports')}>Export report <ArrowRight size={16} /></button></div><DetectionTable rows={detections.slice(0, 6)} /></section>
                <section className="panel camera-summary"><div className="panel-title-row"><div><span className="eyebrow">CAMERA HEALTH</span><h2>Feed status</h2></div></div>{cameras.slice(0, 4).map(camera => <button className="camera-status-row" key={camera.id} onClick={() => { setSelectedCamera(camera.id); setView('cameras') }}><span className={`camera-status-icon ${camera.status === 'active' ? 'live' : ''}`}><Camera size={17} /></span><span><strong>{camera.name}</strong><small>{camera.department}</small></span><span className={`status-pill ${camera.is_demo ? 'demo' : camera.status === 'active' ? 'live' : ''}`}>{camera.is_demo ? 'DEMO' : camera.status.toUpperCase()}</span></button>)}</section>
              </div>
            </>}

            {view === 'cameras' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('cameras_eyebrow')}</span><h1>{t('cameras_title')}</h1><p>{t('cameras_sub')}</p></div><button className="primary-btn" onClick={() => setModal('camera')}><Plus size={18} /> {t('add_camera')}</button></div>
              <div className="camera-layout">
                <div className="camera-list">{cameras.map(camera => <button key={camera.id} className={`camera-list-item ${activeCamera?.id === camera.id ? 'selected' : ''}`} onClick={() => setSelectedCamera(camera.id)}><span className="camera-list-icon"><Camera size={19} /></span><span><strong>{camera.name}</strong><small>{camera.department}</small></span><span className={`status-dot ${camera.status === 'active' ? 'live' : ''}`} /></button>)}</div>
                <section className="panel camera-detail">
                  {activeCamera ? <>
                    <div className="camera-detail-head"><div><span className="eyebrow">CAMERA PASSPORT / {activeCamera.id.slice(0, 8).toUpperCase()}</span><h2>{activeCamera.name}</h2><p>{activeCamera.department}</p></div><span className={`status-pill ${activeCamera.is_demo ? 'demo' : activeCamera.status === 'active' ? 'live' : ''}`}>{activeCamera.is_demo ? 'DEMO REPLAY' : activeCamera.status.toUpperCase()}</span></div>
                    <CameraPicture camera={activeCamera} token={token} />
                    <p className="picture-caption">{activeCamera.is_demo ? `Illustrative replay, not Indian footage. Synthetic Ahmedabad events are separate and are not observations from this video.` : activeCamera.protocol === 'file' ? 'Recorded footage · timestamps in detection reports reflect processing time.' : 'Live source · picture availability depends on gateway and codec support.'}</p>
                    <AnalyticsPreview camera={activeCamera} token={token} />
                    <div className="passport-grid">
                      <Passport label={activeCamera.is_demo ? 'PREVIEW TYPE' : 'PROTOCOL'} value={activeCamera.is_demo ? 'Public sample replay' : activeCamera.protocol.toUpperCase()} />
                      <Passport label="CODEC" value={activeCamera.is_demo ? 'H.264 (preview)' : activeCamera.codec || 'Not probed'} />
                      <Passport label="RESOLUTION" value={activeCamera.is_demo ? 'preview' : activeCamera.width ? `${activeCamera.width} × ${activeCamera.height}` : 'Not probed'} />
                      <Passport label="FRAME RATE" value={activeCamera.is_demo ? 'preview' : activeCamera.fps ? `${activeCamera.fps} fps` : 'Not probed'} />
                      <Passport label={activeCamera.is_demo ? 'SIMULATED LOCATION' : 'COORDINATES'} value={`${activeCamera.lat.toFixed(4)}, ${activeCamera.lon.toFixed(4)}`} />
                      <Passport label="LAST EVENT" value={time(activeCamera.last_seen)} />
                      <Passport label="CAMERA HEALTH" value={`${Math.round(activeCamera.health * 100)}%`} title={activeCamera.health_reasons.join('; ') || 'No health penalties'} />
                    </div>
                    {activeCamera.health_reasons.length > 0 && <p className="health-note"><ShieldAlert size={13} /> {activeCamera.health_reasons.join('; ')}. This discounts confidence on any alert from this camera.</p>}
                  </> : <Empty icon={<Camera />} title={t('no_cameras_title')} text="Add a camera or upload a video clip." />}
                </section>
              </div>
            </>}

            {view === 'search' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('search_eyebrow')}</span><h1>{t('search_title')}</h1><p>{t('search_sub')}</p></div></div>
              <form className="search-form" onSubmit={searchPlate}><Search size={22} /><input placeholder={t('search_placeholder')} value={searchText} onChange={e => setSearchText(e.target.value)} /><button className="primary-btn">{t('search_button')} <ArrowRight size={17} /></button></form>
              {searchedPlate ? <div className="search-result-grid">
                <section className="panel"><div className="panel-title-row"><div><span className="eyebrow">ROUTE FOR {searchedPlate}</span><h2>{route.length} sightings</h2></div></div><GujaratMap cameras={cameras} route={route} expanded /><div className="route-note">Route line connects observed camera locations. Travel speed uses an estimated road detour, not routed road distance.</div></section>
                <section className="panel route-timeline"><div className="panel-title-row"><div><span className="eyebrow">CHRONOLOGICAL EVIDENCE</span><h2>Observation trail</h2></div></div>{route.length ? route.map((item, index) => <motion.div className="timeline-item" key={item.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.06 }}><span className="timeline-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.camera_name}</strong><small>{time(item.first_seen)} · {item.vehicle_class || 'vehicle'}</small><span>{Math.round(item.confidence * 100)}% read confidence · {item.source.toUpperCase()}</span></div></motion.div>) : <Empty icon={<Search />} title="No sightings" text="No matching plate is in the detection log." />}</section>
              </div> : <div className="blank-state"><Search size={32} /><h2>{t('start_with_plate')}</h2><p>Search exact registration numbers to see observations and movement on the map.</p></div>}
            </>}

            {view === 'watchlist' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('watchlist_eyebrow')}</span><h1>{t('watchlist_title')}</h1><p>{t('watchlist_sub')}</p></div><div className="heading-actions">{session.user.role === 'admin' && <button className="secondary-btn" onClick={() => setModal('face')}><Fingerprint size={17} /> {t('enroll_face')}</button>}<button className="primary-btn" onClick={() => setModal('watchlist')}><Plus size={18} /> {t('add_plate')}</button></div></div>
              <section className="panel table-panel"><div className="panel-title-row"><div><span className="eyebrow">ACTIVE RECORDS</span><h2>{watchlist.length} entries</h2></div></div><div className="table-scroll"><table><thead><tr><th>IDENTIFIER</th><th>TYPE</th><th>CATEGORY</th><th>AUTHORITY</th><th>EXPIRES</th><th>APPROVAL</th></tr></thead><tbody>{watchlist.map(item => <tr key={item.id}><td><strong className="plate-text">{item.identifier}</strong></td><td>{item.kind}</td><td><span className="category-tag">{item.category}</span></td><td>{item.authority}</td><td>{time(item.expires_at)}</td><td>{item.kind === 'face' ? item.second_approver ? '2 approved' : item.approved_by !== session.user.name && session.user.role !== 'operator' ? <button className="text-link" onClick={() => approveFace(item)}>Approve</button> : 'Pending second' : 'Approved'}</td></tr>)}</tbody></table>{!watchlist.length && <Empty icon={<Crosshair />} title="Watchlist is empty" text="Add a test plate with an authority and expiry to enable correlation." />}</div></section>
              <div className="governance-note"><LockKeyhole size={18} /><div><strong>Watchlist governance</strong><p>Only approved and unexpired face entries can match. Operators must confirm face alerts before any action. Use consenting people for demo footage.</p></div></div>
            </>}

            {view === 'reports' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('reports_eyebrow')}</span><h1>{t('reports_title')}</h1><p>{t('reports_sub')}</p></div><div className="heading-actions"><button className="secondary-btn" onClick={() => download('csv')}><ArrowDownToLine size={17} /> {t('export_csv')}</button><button className="primary-btn" onClick={() => download('pdf')}><FileText size={17} /> {t('export_pdf')}</button></div></div>
              <p className="report-disclosure">Recorded observations and synthetic scenario rows are clearly separated. This read rate is a report count, not measured ANPR accuracy on field footage. Vehicle-only rows are retained when no usable plate read is available.</p>
              <div className="report-source-tabs" role="group" aria-label="Report source">{(['all', 'recorded', 'demo', 'live'] as ReportSource[]).map(source => <button key={source} className={reportSource === source ? 'selected' : ''} onClick={() => setReportSource(source)}>{source === 'all' ? 'All sources' : source === 'demo' ? 'Synthetic demo' : source === 'recorded' ? 'Recorded footage' : 'Live feeds'}</button>)}</div>
              <div className="report-summary"><div><span>TOTAL TRACKS</span><strong>{reportSummary.tracks}</strong></div><div><span>PLATES READ</span><strong>{reportSummary.plates_read}</strong></div><div><span>CONFIRMED READS</span><strong>{reportSummary.confirmed}</strong></div><div><span>READ RATE</span><strong>{reportSummary.read_rate}%</strong></div></div>
              <section className="panel table-panel"><div className="panel-title-row"><div><span className="eyebrow">TIMESTAMPED OBSERVATIONS</span><h2>Report preview</h2></div><span className="panel-meta">LATEST 80 · {reportSource.toUpperCase()}</span></div><DetectionTable rows={detections.filter(x => x.event_type !== 'face' && (reportSource === 'all' || x.source === reportSource)).slice(0, 80)} /></section>
            </>}

            {view === 'audit' && <>
              <div className="page-heading"><div><span className="eyebrow">{t('audit_eyebrow')}</span><h1>{t('audit_title')}</h1><p>{t('audit_sub')}</p></div><button className="secondary-btn" onClick={() => request<typeof audit>('/api/audit/verify', token).then(setAudit).catch(e => setError(e.message))}><ShieldCheck size={17} /> {t('verify_chain')}</button></div>
              <div className={`audit-card ${audit?.valid ? 'valid' : ''}`}><div className="audit-icon">{audit?.valid ? <ShieldCheck size={30} /> : <Fingerprint size={30} />}</div><div><span className="eyebrow">INTEGRITY CHECK</span><h2>{audit ? audit.valid ? 'Chain verified' : `Chain broken at record ${audit.failed_at}` : 'Awaiting verification'}</h2><p>{audit ? `${audit.records} linked audit records checked.` : 'Run verification to inspect the audit chain.'}</p></div></div>
              <section className="panel hash-panel"><span className="eyebrow">LATEST SHA-256 DIGEST</span><code>{audit?.latest_hash || 'No audit entries yet'}</code><p>Any edited record changes its digest and breaks verification. Evidence details are available from each alert card.</p></section>
            </>}

          </motion.div>
        </AnimatePresence>
      </main>
    </div>

    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.97 }}><Check size={18} />{toast}</motion.div>}</AnimatePresence>

    <AnimatePresence>
      {modal === 'camera' && <CameraModal token={token} onClose={() => setModal(null)} onSaved={() => { setModal(null); notify('Camera registered'); void load() }} />}
      {modal === 'watchlist' && <WatchlistModal token={token} onClose={() => setModal(null)} onSaved={() => { setModal(null); notify('Plate added to watchlist'); void load() }} />}
      {modal === 'face' && <FaceModal token={token} onClose={() => setModal(null)} onSaved={() => { setModal(null); notify('Face enrollment awaits a second approver'); void load() }} />}
    </AnimatePresence>

    <AnimatePresence>
      {selectedAlert && <motion.div className="drawer-scrim" onClick={() => setSelectedAlert(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.aside className="alert-drawer" onClick={e => e.stopPropagation()} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}>
          <button className="drawer-close" onClick={() => setSelectedAlert(null)}><X size={21} /></button>
          <span className="eyebrow">ALERT / {selectedAlert.id.slice(0, 8).toUpperCase()}</span>
          <h2>{selectedAlert.plate}</h2>
          <div className="drawer-tags"><span className={`priority-tag ${selectedAlert.priority.toLowerCase()}`}>{selectedAlert.priority}</span><span className="category-tag">{selectedAlert.category}</span>{selectedAlert.source === 'demo' && <span className="demo-tag">DEMO DATA</span>}</div>
          <div className="drawer-badge3d"><Suspense fallback={null}><AlertBadge3D rejected={selectedAlert.gate === 'rejected'} /></Suspense></div>
          <div className="triage-card"><span className="triage-headline">{selectedAlert.priority} · {selectedAlert.action} · {selectedAlert.score.toFixed(2)} conf</span><span className="triage-source">{selectedAlert.triage_source}</span><ul className="triage-reasons">{selectedAlert.triage_reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></div>
          <div className="confidence-breakdown">
            <label>CONFIDENCE BREAKDOWN</label>
            {[
              { key: 'Match confidence', value: selectedAlert.score, tone: selectedAlert.score >= 0.7 ? 'safe' : selectedAlert.score >= 0.4 ? 'warn' : 'danger' },
              { key: 'Evidence sufficiency', value: selectedAlert.evidence_sufficient, tone: selectedAlert.evidence_sufficient >= 0.8 ? 'safe' : selectedAlert.evidence_sufficient >= 0.5 ? 'warn' : 'danger' },
              { key: 'Clean read (inverse risk)', value: 1 - selectedAlert.misread_or_clone_risk, tone: selectedAlert.misread_or_clone_risk < 0.3 ? 'safe' : selectedAlert.misread_or_clone_risk < 0.5 ? 'warn' : 'danger' },
            ].map(row => (
              <div className="confidence-row" key={row.key}>
                <span className="confidence-label">{row.key}</span>
                <div className="confidence-track"><motion.div className={`confidence-fill ${row.tone}`} initial={{ width: 0 }} animate={{ width: `${Math.round(row.value * 100)}%` }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} /></div>
                <span className="confidence-pct">{Math.round(row.value * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="drawer-block"><label>MATCH REASON</label><p>{selectedAlert.explanation}</p></div>
          <div className="drawer-metrics"><div><span>CONFIDENCE</span><strong>{Math.round(selectedAlert.score * 100)}%</strong></div><div><span>PHYSICS GATE</span><strong className={selectedAlert.gate === 'rejected' ? 'danger-text' : 'safe-text'}>{selectedAlert.gate.toUpperCase()}</strong></div><div><span>IMPLIED SPEED</span><strong>{selectedAlert.implied_kmh != null ? `${selectedAlert.implied_kmh} km/h` : '—'}</strong></div><div><span>STATUS</span><strong>{selectedAlert.status.toUpperCase()}</strong></div></div>
          <div className="drawer-metrics"><div><span>EVIDENCE SUFFICIENT</span><strong className={selectedAlert.evidence_sufficient >= 0.8 ? 'safe-text' : 'danger-text'}>{Math.round(selectedAlert.evidence_sufficient * 100)}%</strong></div><div><span>MISREAD / CLONE RISK</span><strong className={selectedAlert.misread_or_clone_risk >= 0.5 ? 'danger-text' : 'safe-text'}>{Math.round(selectedAlert.misread_or_clone_risk * 100)}%</strong></div></div>
          <div className="drawer-block"><label>LOCATION & AUTHORITY</label><p>{selectedAlert.camera_name}<br />{selectedAlert.authority}<br />{time(selectedAlert.created_at)} IST</p></div>
          <div className="drawer-block"><label>RECOMMENDED ACTION</label><p>{selectedAlert.action}</p></div>
          <div className="drawer-block"><label>EVIDENCE INTEGRITY</label><p>{evidence ? evidence.chain_valid ? 'Audit chain verified' : 'Audit chain integrity failed' : 'Checking audit chain…'}<br />Model: {evidence?.model_version || 'not recorded'}</p>{evidence?.latest_hash && <code className="evidence-hash">{evidence.latest_hash}</code>}</div>
          <button className="evidence-download" onClick={() => downloadEvidence(selectedAlert.id)}><ArrowDownToLine size={16} /> Download evidence PDF</button>
          <div className="drawer-actions"><button className="primary-btn" onClick={() => review(selectedAlert, 'confirmed')}><Check size={17} /> Confirm</button><button className="secondary-btn" onClick={() => review(selectedAlert, 'dismissed')}><X size={17} /> Dismiss</button><button className="secondary-btn" onClick={() => review(selectedAlert, 'escalated')}><Siren size={17} /> Escalate</button></div>
          <div className="drawer-foot"><ShieldCheck size={16} /> Human confirmation required before field action.</div>
        </motion.aside>
      </motion.div>}
    </AnimatePresence>
    </div>
  </>
}
