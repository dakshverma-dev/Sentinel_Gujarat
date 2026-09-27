import React, { Suspense, lazy, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CircleHelp } from 'lucide-react'
import { request, type Session } from './api'
import Logo from './Logo'

const NetworkOrb = lazy(() => import('./three/NetworkOrb'))

export default function Login({ onLogin }: { onLogin: (token: string, user: Session['user']) => void }) {
  const [username, setUsername] = useState('operator')
  const [password, setPassword] = useState('sentinel-demo')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ token: string; user: Session['user'] }>('/api/auth/login', '', { method: 'POST', body: JSON.stringify({ username, password }) })
      onLogin(result.token, result.user)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <Suspense fallback={null}><NetworkOrb className="login-scene" /></Suspense>
        <div className="login-art-inner">
          <motion.div className="brand-lockup" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="brand-mark"><Logo size={25} /></div><span>SENTINEL<br /><strong>GUJARAT</strong></span>
          </motion.div>
          <motion.div className="login-headline" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
            Every alert<br /><em>earns its confidence.</em>
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.3 }}>
            One operational picture for cameras, detections and decisions across Gujarat.
          </motion.p>
          <motion.div className="login-coordinate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.4 }}>
            23°01′ N &nbsp; 72°34′ E <span>COMMAND CONSOLE / PILOT</span>
          </motion.div>
        </div>
      </div>
      <div className="login-form-panel">
        <motion.div className="login-form-wrap" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
          <div className="login-kicker"><span className="pulse-dot" /> SECURE ACCESS</div>
          <h1>Welcome back.</h1>
          <p>Sign in to the operations console.</p>
          <form onSubmit={submit}>
            <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></label>
            <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
            {error && <motion.div className="form-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{error}</motion.div>}
            <motion.button className="primary-btn full" disabled={busy} whileTap={{ scale: 0.98 }}>{busy ? 'Signing in…' : 'Open console'} <ArrowRight size={18} /></motion.button>
          </form>
          <div className="login-demo"><CircleHelp size={16} /><span>Local demo: <strong>operator</strong> / <strong>sentinel-demo</strong></span></div>
        </motion.div>
        <div className="login-bottom">SENTINEL GUJARAT &nbsp;·&nbsp; LOCAL PILOT BUILD</div>
      </div>
    </div>
  )
}
