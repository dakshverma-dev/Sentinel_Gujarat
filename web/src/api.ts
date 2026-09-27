// Shared types + API client for the Sentinel Gujarat console.
export type CameraRow = { id: string; name: string; department: string; protocol: string; lat: number; lon: number; status: string; is_demo: boolean; path_name: string | null; media_url: string | null; overlay_url: string | null; codec: string | null; fps: number | null; width: number | null; height: number | null; last_seen: string | null; health: number; health_reasons: string[] }
export type Detection = { id: string; camera_id: string; camera_name: string; track_id: string; event_type: string; plate: string | null; confidence: number; vehicle_class: string | null; colour: string | null; top3: { plate: string; vote_share: number }[]; read_status: string; snapshot_ref: string | null; first_seen: string; source: string; lat?: number; lon?: number }
export type Alert = { id: string; camera_id: string; camera_name: string; plate: string; event_type: string; category: string; authority: string; priority: string; action: string; score: number; match_type: string; gate: string; implied_kmh: number | null; explanation: string; status: string; source: string; created_at: string; lat: number; lon: number; review_note: string | null; evidence_sufficient: number; misread_or_clone_risk: number; triage_reasons: string[]; triage_source: string }
export type Watch = { id: string; kind: string; identifier: string; category: string; authority: string; expires_at: string; approved_by: string | null; second_approver: string | null }
export type Overview = { cameras: number; live_cameras: number; detections: number; alerts: number; needs_review: number; latest_event: string | null }
export type View = 'overview' | 'cameras' | 'search' | 'watchlist' | 'reports' | 'audit'
export type ReportSource = 'all' | 'recorded' | 'demo' | 'live'
export type Session = { token: string; user: { name: string; role: string } }

export const API = import.meta.env.VITE_API_URL || ''

export const DEMO_REPLAYS: Record<string, { video: string; poster: string; width: number; height: number; fps: number; scene: string }> = {
  'Ashram Road Junction': { video: '/demo/camera-1.mp4', poster: '/demo/camera-1.jpg', width: 640, height: 360, fps: 30, scene: 'Elevated gantry replay, daytime motorway' },
  'Paldi Crossroads': { video: '/demo/camera-2.mp4', poster: '/demo/camera-2.jpg', width: 640, height: 360, fps: 30, scene: 'Ground-level replay, night, wet street' },
  'Sarkhej Junction': { video: '/demo/camera-3.mp4', poster: '/demo/camera-3.jpg', width: 426, height: 240, fps: 30, scene: 'Ground-level replay, daytime intersection' },
}

export const fallbackOverview: Overview = { cameras: 0, live_cameras: 0, detections: 0, alerts: 0, needs_review: 0, latest_event: null }

export const time = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
export const shortTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export async function request<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}`, ...options?.headers } })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `Request failed (${response.status})`)
  }
  return response.json()
}
