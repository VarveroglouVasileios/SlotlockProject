import { describe, expect, it } from 'vitest'
import { Engine, fmtSeconds, race, type Req } from './engine'

const now = Date.parse('2026-11-21T09:00:00Z')
const req = (over: Partial<Req> = {}): Req => ({ roomId: 'room-3', start: '2026-12-01T09:00:00Z', end: '2026-12-01T11:00:00Z', name: 'Πελάτης', ...over })

describe('engine', () => {
  it('accepts the first request and refuses the second for the same window', () => {
    const e = new Engine()
    expect(e.book(req(), now).status).toBe(201)
    const r = e.book(req({ name: 'Άλλος' }), now)
    expect(r.status).toBe(409)
    if (r.status === 409) {
      expect(r.body.message).toMatch(/κλεισμένο/)
      expect(r.body.alternatives[0]).toEqual({ from: '2026-12-01T11:00:00Z', to: '2026-12-01T13:00:00Z' })
    }
    expect(e.count()).toBe(1)
  })
  it('blocks any overlap but allows back-to-back stays and other rooms', () => {
    const e = new Engine()
    e.book(req(), now)
    expect(e.book(req({ start: '2026-12-01T10:30:00Z', end: '2026-12-01T12:00:00Z' }), now).status).toBe(409)
    expect(e.book(req({ start: '2026-12-01T11:00:00Z', end: '2026-12-01T12:00:00Z' }), now).status).toBe(201)
    expect(e.book(req({ roomId: 'room-4' }), now).status).toBe(201)
  })
  it('replays the same booking for the same idempotency key and rejects a changed payload', () => {
    const e = new Engine()
    const a = e.book(req({ key: 'k' }), now)
    const b = e.book(req({ key: 'k' }), now)
    expect(a.status === 201 && b.status === 201 && a.body.ref === b.body.ref && b.replayed).toBe(true)
    expect(e.count()).toBe(1)
    expect(e.book(req({ key: 'k', end: '2026-12-01T12:00:00Z' }), now).status).toBe(422)
  })
  it('frees the window when a booking is cancelled', () => {
    const e = new Engine()
    const a = e.book(req(), now)
    if (a.status !== 201) throw new Error('x')
    e.cancel(a.body.ref)
    expect(e.book(req({ name: 'Νέος' }), now).status).toBe(201)
    expect(e.cancel('nope')).toBeNull()
  })
  it('validates input', () => {
    const e = new Engine()
    expect(e.book(req({ start: 'x' }), now).status).toBe(400)
    expect(e.book(req({ name: '' }), now).status).toBe(400)
    expect(e.book(req({ roomId: 'zzz' }), now).status).toBe(404)
  })
})

describe('race', () => {
  it('the earlier arrival wins, whichever request it is', () => {
    const e = new Engine()
    const r = race(e, req({ name: 'Πελάτης Α' }), req({ name: 'Πελάτης Β' }), 4, now)
    expect(r.map((x) => [x.label, x.resp.status])).toEqual([['A', 201], ['B', 409]])
    const e2 = new Engine()
    const r2 = race(e2, req({ name: 'Πελάτης Α' }), req({ name: 'Πελάτης Β' }), 0, now)
    expect(r2.filter((x) => x.resp.status === 201)).toHaveLength(1)
  })
  it('formats times like the example', () => {
    expect(fmtSeconds(4)).toBe('0,004s')
    expect(fmtSeconds(0)).toBe('0,000s')
  })
})
