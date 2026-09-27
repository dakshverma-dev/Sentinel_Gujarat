import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Fingerprint, X } from 'lucide-react'
import { request } from './api'

const scrim = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
const sheet = { initial: { opacity: 0, y: 24, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 14, scale: 0.98 }, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const } }

export function CameraModal({ token, onClose, onSaved }: { token: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'url' | 'file'>('url')
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('Ahmedabad pilot')
  const [source, setSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [lat, setLat] = useState('23.0225')
  const [lon, setLon] = useState('72.5714')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { if (mode === 'url') await request('/api/cameras', token, { method: 'POST', body: JSON.stringify({ name, department, source_url: source, lat: Number(lat), lon: Number(lon) }) }); else { if (!file) throw new Error('Choose a video file'); const body = new FormData(); Object.entries({ name, department, lat, lon }).forEach(([key, value]) => body.append(key, value)); body.append('file', file); await request('/api/cameras/upload', token, { method: 'POST', body }) } onSaved() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <motion.div className="modal-scrim" onClick={onClose} {...scrim}><motion.div className="modal" onClick={e => e.stopPropagation()} {...sheet}><button className="modal-close" onClick={onClose}><X size={21} /></button><span className="eyebrow">CAMERA PASSPORT</span><h2>Add a camera</h2><p>Register a feed and probe its stream properties automatically.</p><div className="segmented"><button className={mode === 'url' ? 'selected' : ''} onClick={() => setMode('url')}>Stream URL</button><button className={mode === 'file' ? 'selected' : ''} onClick={() => setMode('file')}>Upload footage</button></div><form onSubmit={submit}><div className="form-grid"><label>Camera name<input placeholder="e.g. Ashram Road East" value={name} onChange={e => setName(e.target.value)} required /></label><label>Department<input value={department} onChange={e => setDepartment(e.target.value)} required /></label></div>{mode === 'url' ? <label>RTSP / RTMP / HLS URL<input placeholder="rtsp://camera.example/live" value={source} onChange={e => setSource(e.target.value)} required /></label> : <label>Recorded footage<input type="file" accept="video/*,.mkv" onChange={e => setFile(e.target.files?.[0] || null)} required /></label>}<div className="form-grid"><label>Latitude<input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} required /></label><label>Longitude<input type="number" step="any" value={lon} onChange={e => setLon(e.target.value)} required /></label></div>{error && <div className="form-error">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy ? 'Registering…' : 'Register camera'} <ArrowRight size={17} /></button></form></motion.div></motion.div>
}

export function WatchlistModal({ token, onClose, onSaved }: { token: string; onClose: () => void; onSaved: () => void }) {
  const [identifier, setIdentifier] = useState('')
  const [category, setCategory] = useState('stolen')
  const [authority, setAuthority] = useState('Pilot test entry')
  const [expires, setExpires] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await request('/api/watchlist', token, { method: 'POST', body: JSON.stringify({ kind: 'plate', identifier, category, authority, expires_at: `${expires}T23:59:59+05:30` }) }); onSaved() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <motion.div className="modal-scrim" onClick={onClose} {...scrim}><motion.div className="modal" onClick={e => e.stopPropagation()} {...sheet}><button className="modal-close" onClick={onClose}><X size={21} /></button><span className="eyebrow">WATCHLIST ENTRY</span><h2>Add a plate</h2><p>Only entries with a documented authority and valid expiry are correlated.</p><form onSubmit={submit}><label>Registration number<input placeholder="GJ01AB1234" value={identifier} onChange={e => setIdentifier(e.target.value.toUpperCase())} required /></label><div className="form-grid"><label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="stolen">Stolen</option><option value="wanted">Wanted</option><option value="suspect">Suspect</option><option value="missing">Missing</option></select></label><label>Expiry date<input type="date" value={expires} onChange={e => setExpires(e.target.value)} required /></label></div><label>Legal / case authority<input value={authority} onChange={e => setAuthority(e.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy ? 'Adding…' : 'Add to watchlist'} <ArrowRight size={17} /></button></form></motion.div></motion.div>
}

export function FaceModal({ token, onClose, onSaved }: { token: string; onClose: () => void; onSaved: () => void }) {
  const [identifier, setIdentifier] = useState('')
  const [authority, setAuthority] = useState('Consenting pilot participant')
  const [expires, setExpires] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!file) { setError('Choose one clear image'); return } setBusy(true); setError(''); try { const body = new FormData(); body.append('identifier', identifier); body.append('category', 'missing'); body.append('authority', authority); body.append('expires_at', `${expires}T23:59:59+05:30`); body.append('image', file); await request('/api/watchlist/face', token, { method: 'POST', body }); onSaved() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <motion.div className="modal-scrim" onClick={onClose} {...scrim}><motion.div className="modal" onClick={e => e.stopPropagation()} {...sheet}><button className="modal-close" onClick={onClose}><X size={21} /></button><span className="eyebrow">GOVERNED FACE WATCHLIST</span><h2>Enroll consenting person</h2><p>A second signed-in approver must approve this entry before the detector can match it.</p><form onSubmit={submit}><label>Case label / person identifier<input value={identifier} onChange={e => setIdentifier(e.target.value)} required /></label><label>Authority and consent basis<input value={authority} onChange={e => setAuthority(e.target.value)} required /></label><label>Expiry date<input type="date" value={expires} onChange={e => setExpires(e.target.value)} required /></label><label>One clear face image<input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-btn full" disabled={busy}><Fingerprint size={16} /> {busy ? 'Enrolling…' : 'Request enrollment'}</button></form></motion.div></motion.div>
}
