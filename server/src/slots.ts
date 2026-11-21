/** Pure booking rules: slot arithmetic, validation and alternatives. No database here. */

export const SLOT_MIN = 30
export const OPEN_HOUR = 8
export const CLOSE_HOUR = 20
export const MAX_HOURS = 8
const SLOT_MS = SLOT_MIN * 60_000

export interface Window { start: string; end: string }

const parse = (iso: string): number | null => {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(\.000)?Z$/.test(iso)) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}
/** Canonical form with seconds: 2026-12-01T09:00:00Z */
export const canon = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export type Problem = { ok: false; field: string; message: string } | { ok: true; startMs: number; endMs: number }

/** Validates a requested window: UTC, aligned to 30 minutes, inside opening hours on one day, at most 8 hours. */
export function validateWindow(w: Window, now: number): Problem {
  const s = parse(w.start), e = parse(w.end)
  if (s === null) return { ok: false, field: 'start', message: 'Η έναρξη πρέπει να είναι ώρα UTC όπως 2026-12-01T09:00:00Z.' }
  if (e === null) return { ok: false, field: 'end', message: 'Η λήξη πρέπει να είναι ώρα UTC όπως 2026-12-01T11:00:00Z.' }
  if (s % SLOT_MS !== 0 || e % SLOT_MS !== 0) return { ok: false, field: 'start', message: 'Οι ώρες πρέπει να είναι πολλαπλάσια των 30 λεπτών.' }
  if (e <= s) return { ok: false, field: 'end', message: 'Η λήξη πρέπει να είναι μετά την έναρξη.' }
  if ((e - s) / 3_600_000 > MAX_HOURS) return { ok: false, field: 'end', message: `Μέγιστη διάρκεια ${MAX_HOURS} ώρες.` }
  if (s <= now) return { ok: false, field: 'start', message: 'Η έναρξη πρέπει να είναι στο μέλλον.' }
  const ds = new Date(s)
  const sameDay = ds.toISOString().slice(0, 10) === new Date(e - 1).toISOString().slice(0, 10)
  const openMs = Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth(), ds.getUTCDate(), OPEN_HOUR)
  const closeMs = Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth(), ds.getUTCDate(), CLOSE_HOUR)
  if (!sameDay || s < openMs || e > closeMs) return { ok: false, field: 'start', message: `Κρατήσεις γίνονται ${OPEN_HOUR}:00–${CLOSE_HOUR}:00 UTC, μέσα στην ίδια μέρα.` }
  return { ok: true, startMs: s, endMs: e }
}

/** Slot start times covered by a window. */
export function slotsOf(startMs: number, endMs: number): string[] {
  const out: string[] = []
  for (let t = startMs; t < endMs; t += SLOT_MS) out.push(canon(t))
  return out
}

export interface Alternative { from: string; to: string; room?: string }

/**
 * Suggestions after a conflict: the next free windows of the same length later that day in the same room,
 * and the same window in other rooms when they are free.
 */
export function alternatives(opts: { roomId: string; startMs: number; endMs: number; busy: (roomId: string) => Set<string>; rooms: string[]; limit?: number }): Alternative[] {
  const { roomId, startMs, endMs, busy, rooms } = opts
  const limit = opts.limit ?? 3
  const len = endMs - startMs
  const day = new Date(startMs)
  const closeMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), CLOSE_HOUR)
  const free = (room: string, a: number, b: number): boolean => {
    const set = busy(room)
    return slotsOf(a, b).every((s) => !set.has(s))
  }
  const out: Alternative[] = []
  // At most two later windows in the same room, so there is always space left to offer other rooms.
  const sameRoomMax = Math.max(1, limit - 1)
  for (let a = startMs + SLOT_MS; a + len <= closeMs && out.length < sameRoomMax; a += SLOT_MS) {
    if (free(roomId, a, a + len)) {
      out.push({ from: canon(a), to: canon(a + len) })
      a += len - SLOT_MS
    }
  }
  for (const r of rooms) if (r !== roomId && out.length < limit && free(r, startMs, endMs)) out.push({ from: canon(startMs), to: canon(endMs), room: r })
  return out
}

/** Booking reference like SL-7K3F9Q (no look-alike characters). */
export function makeRef(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)]
  return `SL-${s}`
}

export const validName = (s: unknown): s is string => typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 60
export const OPEN_SLOTS = ((CLOSE_HOUR - OPEN_HOUR) * 60) / SLOT_MIN
