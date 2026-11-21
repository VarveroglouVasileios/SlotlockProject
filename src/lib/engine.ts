/**
 * In-browser model of the Slotlock rules, used by the demo page (GitHub Pages cannot run the Node server).
 * It follows the same rules as server/src/app.ts: the unique "lock" per room and 30-minute slot is what refuses a double booking.
 */
import { alternatives, canon, makeRef, slotsOf, validName, validateWindow, type Alternative } from './slots'

export interface Req { roomId: string; start: string; end: string; name: string; key?: string }
export interface Booking { ref: string; roomId: string; start: string; end: string; name: string; status: 'confirmed' | 'cancelled' }
export type Resp =
  | { status: 201; body: Booking; replayed?: boolean }
  | { status: 400 | 404 | 422; body: { error: string; message: string; field?: string } }
  | { status: 409; body: { error: 'slot_taken'; message: string; alternatives: Alternative[] } }

export const ROOMS = [{ id: 'room-3', name: 'Δωμάτιο 3' }, { id: 'room-4', name: 'Δωμάτιο 4' }, { id: 'room-5', name: 'Δωμάτιο 5' }]

export class Engine {
  private locks = new Map<string, string>() // "room|slot" -> booking ref
  private bookings = new Map<string, Booking>()
  private keys = new Map<string, { fingerprint: string; ref: string }>()
  constructor(private random: () => number = Math.random) {}

  private lockKey = (room: string, slot: string): string => `${room}|${slot}`
  private busy = (room: string): Set<string> => new Set([...this.locks.keys()].filter((k) => k.startsWith(room + '|')).map((k) => k.split('|')[1]))

  /** One request. Everything inside runs without interruption, like a single database transaction. */
  book(req: Req, now: number): Resp {
    const w = validateWindow({ start: req.start, end: req.end }, now)
    if (!w.ok) return { status: 400, body: { error: 'invalid_window', field: w.field, message: w.message } }
    if (!validName(req.name)) return { status: 400, body: { error: 'invalid_name', field: 'name', message: 'Γράψτε το όνομά σας (2–60 χαρακτήρες).' } }
    const room = ROOMS.find((r) => r.id === req.roomId)
    if (!room) return { status: 404, body: { error: 'room_not_found', message: 'Δεν υπάρχει αυτό το δωμάτιο.' } }
    const fingerprint = JSON.stringify([req.roomId, canon(w.startMs), canon(w.endMs), req.name])
    if (req.key) {
      const prior = this.keys.get(req.key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) return { status: 422, body: { error: 'idempotency_mismatch', message: 'Αυτό το Idempotency-Key έχει ήδη χρησιμοποιηθεί με διαφορετικά στοιχεία.' } }
        return { status: 201, body: this.bookings.get(prior.ref)!, replayed: true }
      }
    }
    const slots = slotsOf(w.startMs, w.endMs)
    if (slots.some((s) => this.locks.has(this.lockKey(req.roomId, s)))) {
      return {
        status: 409,
        body: { error: 'slot_taken', message: `Το ${room.name.toLowerCase()} είναι κλεισμένο στο διάστημα που ζητήσατε.`, alternatives: alternatives({ roomId: req.roomId, startMs: w.startMs, endMs: w.endMs, rooms: ROOMS.map((r) => r.id), busy: (r) => this.busy(r) }) },
      }
    }
    const ref = makeRef(this.random)
    const b: Booking = { ref, roomId: req.roomId, start: canon(w.startMs), end: canon(w.endMs), name: req.name.trim(), status: 'confirmed' }
    for (const s of slots) this.locks.set(this.lockKey(req.roomId, s), ref)
    this.bookings.set(ref, b)
    if (req.key) this.keys.set(req.key, { fingerprint, ref })
    return { status: 201, body: b }
  }

  cancel(ref: string): Booking | null {
    const b = this.bookings.get(ref)
    if (!b) return null
    for (const [k, v] of this.locks) if (v === ref) this.locks.delete(k)
    b.status = 'cancelled'
    return b
  }

  count(): number {
    return [...this.bookings.values()].filter((b) => b.status === 'confirmed').length
  }
}

export interface RaceResult { label: string; at: number; resp: Resp }

/**
 * Two requests for the same slot arrive `gapMs` apart. They are handled in order of arrival,
 * and the second one finds the slot already locked. Returns both outcomes with their arrival times.
 */
export function race(engine: Engine, a: Req, b: Req, gapMs: number, now: number): RaceResult[] {
  const events: { label: string; at: number; req: Req }[] = [{ label: 'A', at: 0, req: a }, { label: 'B', at: Math.max(0, gapMs), req: b }]
  return events.sort((x, y) => x.at - y.at).map((e) => ({ label: e.label, at: e.at, resp: engine.book(e.req, now) }))
}

export const fmtSeconds = (ms: number): string => `${(ms / 1000).toFixed(3).replace('.', ',')}s`
