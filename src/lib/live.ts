/** Calls to the hosted Slotlock API (Node + PostgreSQL). Only used when the site was built with VITE_API_URL. */
import type { Req } from './engine'

export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')
export const liveAvailable = API_URL !== ''

export interface LiveResult { label: string; sentAt: number; ms: number; status: number; body: Record<string, unknown>; replayed: boolean }

/** Wakes the free-tier server if it is asleep. Resolves true when /health answers. */
export async function wake(timeoutMs = 75_000): Promise<boolean> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(`${API_URL}/health`, { signal: ctl.signal })
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function post(label: string, req: Req, t0: number, delayMs: number): Promise<LiveResult> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  const sentAt = performance.now() - t0
  const started = performance.now()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (req.key) headers['Idempotency-Key'] = req.key
  try {
    const r = await fetch(`${API_URL}/bookings`, { method: 'POST', headers, body: JSON.stringify({ roomId: req.roomId, start: req.start, end: req.end, name: req.name }) })
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
    return { label, sentAt, ms: performance.now() - started, status: r.status, body, replayed: r.headers.get('Idempotent-Replayed') === 'true' }
  } catch {
    return { label, sentAt, ms: performance.now() - started, status: 0, body: { error: 'network', message: 'Δεν ήταν δυνατή η σύνδεση με τον server.' }, replayed: false }
  }
}

/** Sends both requests to the real server, the second one `gapMs` after the first, and returns what the server answered. */
export async function liveRace(a: Req, b: Req, gapMs: number): Promise<LiveResult[]> {
  const t0 = performance.now()
  return Promise.all([post('A', a, t0, 0), post('B', b, t0, Math.max(0, gapMs))])
}

export async function cancelLive(ref: string): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/bookings/${encodeURIComponent(ref)}/cancel`, { method: 'PATCH' })
    return r.ok
  } catch {
    return false
  }
}
