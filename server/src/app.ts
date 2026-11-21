import { createHash } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { Op, UniqueConstraintError, type Sequelize } from 'sequelize'
import { Booking, Room, SlotLock } from './db.js'
import { OPEN_HOUR, CLOSE_HOUR, SLOT_MIN, alternatives, canon, makeRef, slotsOf, validName, validateWindow } from './slots.js'

export interface AppOptions { now?: () => number; random?: () => number }

const view = (b: Booking): Record<string, unknown> => ({ ref: b.ref, roomId: b.roomId, start: b.start, end: b.end, name: b.name, status: b.status })

export function createApp(sequelize: Sequelize, opts: AppOptions = {}): express.Express {
  const now = opts.now ?? (() => Date.now())
  // SQLite allows one writer at a time and Sequelize opens a connection per transaction, so in dev and tests the writes are queued.
  // Correctness does not depend on this: the primary key on slot_locks is what refuses a double booking, in SQLite and in PostgreSQL.
  let queue: Promise<unknown> = Promise.resolve()
  const sqlite = sequelize.getDialect() === 'sqlite'
  const write = <T>(fn: () => Promise<T>): Promise<T> => {
    if (!sqlite) return fn()
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '10kb' }))
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  const busyFor = async (roomId: string, from: number, to: number): Promise<Set<string>> => {
    const rows = await SlotLock.findAll({ where: { roomId, slotStart: { [Op.gte]: canon(from), [Op.lt]: canon(to) } } })
    return new Set(rows.map((r) => r.slotStart))
  }

  app.get('/rooms/:id/availability', async (req, res) => {
    const room = await Room.findByPk(req.params.id)
    if (!room) return void res.status(404).json({ error: 'room_not_found', message: 'Δεν υπάρχει αυτό το δωμάτιο.' })
    const date = String(req.query.date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return void res.status(400).json({ error: 'invalid_date', message: 'Γράψτε ημερομηνία όπως 2026-12-01.' })
    const open = Date.parse(`${date}T${String(OPEN_HOUR).padStart(2, '0')}:00:00Z`)
    const close = Date.parse(`${date}T${String(CLOSE_HOUR).padStart(2, '0')}:00:00Z`)
    const busy = await busyFor(room.id, open, close)
    const slots = slotsOf(open, close).map((s) => ({ start: s, free: !busy.has(s) }))
    res.json({ room: room.id, date, slotMinutes: SLOT_MIN, slots })
  })

  app.post('/bookings', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const roomId = typeof body.roomId === 'string' ? body.roomId : ''
    const w = validateWindow({ start: String(body.start ?? ''), end: String(body.end ?? '') }, now())
    if (!w.ok) return void res.status(400).json({ error: 'invalid_window', field: w.field, message: w.message })
    if (!validName(body.name)) return void res.status(400).json({ error: 'invalid_name', field: 'name', message: 'Γράψτε το όνομά σας (2–60 χαρακτήρες).' })
    const room = await Room.findByPk(roomId)
    if (!room) return void res.status(404).json({ error: 'room_not_found', message: 'Δεν υπάρχει αυτό το δωμάτιο.' })

    const key = req.header('Idempotency-Key')?.slice(0, 80) || null
    const fingerprint = createHash('sha256').update(JSON.stringify([roomId, canon(w.startMs), canon(w.endMs), body.name])).digest('hex')
    if (key) {
      const prior = await Booking.findOne({ where: { idempotencyKey: key } })
      if (prior) {
        if (prior.fingerprint !== fingerprint) return void res.status(422).json({ error: 'idempotency_mismatch', message: 'Αυτό το Idempotency-Key έχει ήδη χρησιμοποιηθεί με διαφορετικά στοιχεία.' })
        return void res.status(prior.status === 'confirmed' ? 201 : 200).set('Idempotent-Replayed', 'true').json(view(prior))
      }
    }

    const slots = slotsOf(w.startMs, w.endMs)
    const ref = makeRef(opts.random)
    try {
      await write(() => sequelize.transaction(async (t) => {
        await Booking.create({ ref, roomId, start: canon(w.startMs), end: canon(w.endMs), name: String(body.name).trim(), status: 'confirmed', idempotencyKey: key, fingerprint }, { transaction: t })
        await SlotLock.bulkCreate(slots.map((slotStart) => ({ roomId, slotStart, bookingRef: ref })), { transaction: t })
      }))
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        // Either the slot was taken, or the same Idempotency-Key raced with itself: replay the winner.
        if (key) {
          const prior = await Booking.findOne({ where: { idempotencyKey: key } })
          if (prior && prior.fingerprint === fingerprint) return void res.status(201).set('Idempotent-Replayed', 'true').json(view(prior))
        }
        const rooms = (await Room.findAll()).map((r) => r.id)
        const day = new Date(w.startMs)
        const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), OPEN_HOUR)
        const dayEnd = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), CLOSE_HOUR)
        const cache = new Map<string, Set<string>>()
        for (const r of rooms) cache.set(r, await busyFor(r, dayStart, dayEnd))
        return void res.status(409).json({
          error: 'slot_taken',
          message: `Το ${room.name.toLowerCase()} είναι κλεισμένο στο διάστημα που ζητήσατε.`,
          alternatives: alternatives({ roomId, startMs: w.startMs, endMs: w.endMs, rooms, busy: (r) => cache.get(r) ?? new Set() }),
        })
      }
      throw err
    }
    res.status(201).json({ ref, roomId, start: canon(w.startMs), end: canon(w.endMs), name: String(body.name).trim(), status: 'confirmed' })
  })

  app.get('/bookings/:ref', async (req, res) => {
    const b = await Booking.findByPk(req.params.ref)
    if (!b) return void res.status(404).json({ error: 'booking_not_found', message: 'Δεν βρέθηκε αυτή η κράτηση.' })
    res.json(view(b))
  })

  app.patch('/bookings/:ref/cancel', async (req, res) => {
    const b = await Booking.findByPk(req.params.ref)
    if (!b) return void res.status(404).json({ error: 'booking_not_found', message: 'Δεν βρέθηκε αυτή η κράτηση.' })
    if (b.status === 'cancelled') return void res.json(view(b)) // cancelling twice is harmless
    await write(() => sequelize.transaction(async (t) => {
      await SlotLock.destroy({ where: { bookingRef: b.ref }, transaction: t })
      b.status = 'cancelled'
      await b.save({ transaction: t })
    }))
    res.json(view(b))
  })

  app.use((_req, res) => void res.status(404).json({ error: 'not_found', message: 'Άγνωστη διαδρομή.' }))
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next
    if (err instanceof SyntaxError) return void res.status(400).json({ error: 'invalid_json', message: 'Το σώμα του αιτήματος δεν είναι έγκυρο JSON.' })
    console.error(err)
    res.status(500).json({ error: 'server_error', message: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.' })
  })
  return app
}
