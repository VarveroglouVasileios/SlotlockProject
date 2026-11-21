import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Sequelize } from 'sequelize'
import { createApp } from './app.js'
import { Booking, SlotLock, connect } from './db.js'

const now = Date.parse('2026-11-21T09:00:00Z')
const dir = mkdtempSync(join(tmpdir(), 'slotlock-'))
let sequelize: Sequelize
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  sequelize = await connect(undefined, join(dir, 'test.sqlite'))
  app = createApp(sequelize, { now: () => now })
})
beforeEach(async () => {
  await SlotLock.destroy({ where: {} })
  await Booking.destroy({ where: {} })
})
afterAll(async () => {
  await sequelize.close()
  rmSync(dir, { recursive: true, force: true })
})

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ roomId: 'room-3', start: '2026-12-01T09:00:00Z', end: '2026-12-01T11:00:00Z', name: 'Πελάτης Α', ...over })

describe('POST /bookings', () => {
  it('creates a booking and returns it', async () => {
    const r = await request(app).post('/bookings').send(body())
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ roomId: 'room-3', status: 'confirmed', name: 'Πελάτης Α' })
    expect(r.body.ref).toMatch(/^SL-/)
    const got = await request(app).get(`/bookings/${r.body.ref}`)
    expect(got.status).toBe(200)
  })

  it('answers 409 with a clear message and alternatives when the slot is taken', async () => {
    await request(app).post('/bookings').send(body())
    const r = await request(app).post('/bookings').send(body({ name: 'Πελάτης Β' }))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('slot_taken')
    expect(r.body.message).toMatch(/κλεισμένο/)
    expect(r.body.alternatives[0]).toEqual({ from: '2026-12-01T11:00:00Z', to: '2026-12-01T13:00:00Z' })
    expect(r.body.alternatives.some((a: { room?: string }) => a.room === 'room-4')).toBe(true)
  })

  it('refuses a partial overlap but allows back-to-back bookings', async () => {
    await request(app).post('/bookings').send(body())
    expect((await request(app).post('/bookings').send(body({ start: '2026-12-01T10:30:00Z', end: '2026-12-01T12:00:00Z' }))).status).toBe(409)
    expect((await request(app).post('/bookings').send(body({ start: '2026-12-01T08:00:00Z', end: '2026-12-01T09:30:00Z' }))).status).toBe(409)
    expect((await request(app).post('/bookings').send(body({ start: '2026-12-01T11:00:00Z', end: '2026-12-01T12:00:00Z' }))).status).toBe(201)
    expect((await request(app).post('/bookings').send(body({ start: '2026-12-01T08:00:00Z', end: '2026-12-01T09:00:00Z' }))).status).toBe(201)
  })

  it('lets a different room take the same time', async () => {
    await request(app).post('/bookings').send(body())
    expect((await request(app).post('/bookings').send(body({ roomId: 'room-4' }))).status).toBe(201)
  })

  it('validates input with 400 and unknown rooms with 404', async () => {
    expect((await request(app).post('/bookings').send(body({ start: 'soon' }))).status).toBe(400)
    expect((await request(app).post('/bookings').send(body({ name: 'x' }))).body.field).toBe('name')
    expect((await request(app).post('/bookings').send(body({ start: '2026-11-01T09:00:00Z', end: '2026-11-01T10:00:00Z' }))).status).toBe(400)
    expect((await request(app).post('/bookings').send(body({ roomId: 'room-99' }))).status).toBe(404)
    const broken = await request(app).post('/bookings').set('Content-Type', 'application/json').send('{"roomId":')
    expect(broken.status).toBe(400)
    expect(broken.body.error).toBe('invalid_json')
  })

  it('never double-books when 25 requests arrive at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => request(app).post('/bookings').send(body({ name: `Πελάτης ${i}` }))))
    const codes = results.map((r) => r.status)
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.filter((c) => c === 409)).toHaveLength(24)
    expect(await Booking.count({ where: { status: 'confirmed' } })).toBe(1)
    expect(await SlotLock.count()).toBe(4) // 09:00–11:00 = four slots, held once
  })

  it('keeps overlapping concurrent requests exclusive, whatever their shape', async () => {
    const shapes = [['09:00', '10:00'], ['09:30', '10:30'], ['10:00', '11:00'], ['09:00', '11:00'], ['10:30', '11:30'], ['08:00', '09:30']]
    const results = await Promise.all(shapes.flatMap(([s, e]) => Array.from({ length: 4 }, () => request(app).post('/bookings').send(body({ start: `2026-12-01T${s}:00Z`, end: `2026-12-01T${e}:00Z` })))))
    const ok = results.filter((r) => r.status === 201).map((r) => r.body)
    expect(ok.length).toBeGreaterThan(0)
    for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) expect(ok[i].start < ok[j].end && ok[j].start < ok[i].end).toBe(false)
    for (const r of results) expect([201, 409]).toContain(r.status)
  })
})

describe('Idempotency-Key', () => {
  it('replays the same answer for a retried request instead of booking twice', async () => {
    const a = await request(app).post('/bookings').set('Idempotency-Key', 'k-1').send(body())
    const b = await request(app).post('/bookings').set('Idempotency-Key', 'k-1').send(body())
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(b.body.ref).toBe(a.body.ref)
    expect(b.headers['idempotent-replayed']).toBe('true')
    expect(await Booking.count()).toBe(1)
  })
  it('rejects the same key with different content', async () => {
    await request(app).post('/bookings').set('Idempotency-Key', 'k-2').send(body())
    const r = await request(app).post('/bookings').set('Idempotency-Key', 'k-2').send(body({ start: '2026-12-01T13:00:00Z', end: '2026-12-01T14:00:00Z' }))
    expect(r.status).toBe(422)
  })
  it('returns one booking when the same key is sent concurrently', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => request(app).post('/bookings').set('Idempotency-Key', 'k-3').send(body())))
    expect(new Set(rs.map((r) => r.body.ref)).size).toBe(1)
    expect(rs.every((r) => r.status === 201)).toBe(true)
    expect(await Booking.count()).toBe(1)
  })
})

describe('cancel and availability', () => {
  it('frees the slots when a booking is cancelled, and is safe to repeat', async () => {
    const a = await request(app).post('/bookings').send(body())
    const c = await request(app).patch(`/bookings/${a.body.ref}/cancel`)
    expect(c.body.status).toBe('cancelled')
    expect((await request(app).patch(`/bookings/${a.body.ref}/cancel`)).status).toBe(200)
    expect((await request(app).post('/bookings').send(body({ name: 'Πελάτης Β' }))).status).toBe(201)
    expect((await request(app).patch('/bookings/SL-NOPE/cancel')).status).toBe(404)
  })
  it('lists free and busy slots for a day', async () => {
    await request(app).post('/bookings').send(body())
    const r = await request(app).get('/rooms/room-3/availability?date=2026-12-01')
    expect(r.status).toBe(200)
    expect(r.body.slots).toHaveLength(24)
    expect(r.body.slots.filter((s: { free: boolean }) => !s.free).map((s: { start: string }) => s.start)).toEqual(['2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z'])
    expect((await request(app).get('/rooms/room-3/availability?date=nope')).status).toBe(400)
    expect((await request(app).get('/rooms/zzz/availability?date=2026-12-01')).status).toBe(404)
  })
})
