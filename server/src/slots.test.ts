import { describe, expect, it } from 'vitest'
import { alternatives, canon, makeRef, slotsOf, validateWindow } from './slots.js'

const now = Date.parse('2026-11-21T09:00:00Z')
const at = (h: number, m = 0): number => Date.parse(`2026-12-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)

describe('validateWindow', () => {
  it('accepts an aligned window inside opening hours', () => {
    expect(validateWindow({ start: '2026-12-01T09:00:00Z', end: '2026-12-01T11:00:00Z' }, now)).toEqual({ ok: true, startMs: at(9), endMs: at(11) })
  })
  it('rejects bad formats, misalignment, reversed and past windows', () => {
    const bad = (start: string, end: string): string => { const r = validateWindow({ start, end }, now); return r.ok ? 'ok' : r.field }
    expect(bad('tomorrow', '2026-12-01T11:00:00Z')).toBe('start')
    expect(bad('2026-12-01T09:00:00Z', 'x')).toBe('end')
    expect(bad('2026-12-01T09:10:00Z', '2026-12-01T11:00:00Z')).toBe('start')
    expect(bad('2026-12-01T11:00:00Z', '2026-12-01T09:00:00Z')).toBe('end')
    expect(bad('2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z')).toBe('start')
    expect(bad('2026-02-30T09:00:00Z', '2026-02-30T10:00:00Z')).toBe('start')
  })
  it('enforces opening hours, one day and the maximum length', () => {
    expect(validateWindow({ start: '2026-12-01T07:30:00Z', end: '2026-12-01T09:00:00Z' }, now).ok).toBe(false)
    expect(validateWindow({ start: '2026-12-01T19:00:00Z', end: '2026-12-01T20:30:00Z' }, now).ok).toBe(false)
    expect(validateWindow({ start: '2026-12-01T19:00:00Z', end: '2026-12-02T09:00:00Z' }, now).ok).toBe(false)
    expect(validateWindow({ start: '2026-12-01T08:00:00Z', end: '2026-12-01T17:00:00Z' }, now).ok).toBe(false) // 9 h
    expect(validateWindow({ start: '2026-12-01T08:00:00Z', end: '2026-12-01T16:00:00Z' }, now).ok).toBe(true) // exactly 8 h
  })
})

describe('slots and alternatives', () => {
  it('splits a window into 30-minute slots', () => {
    expect(slotsOf(at(9), at(11))).toEqual(['2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z'])
    expect(canon(at(9))).toBe('2026-12-01T09:00:00Z')
  })
  it('suggests the next free window in the same room and the same time in free rooms', () => {
    const busy = new Map<string, Set<string>>([['room-3', new Set(slotsOf(at(9), at(11)))], ['room-4', new Set(slotsOf(at(9), at(10)))], ['room-5', new Set()]])
    const alts = alternatives({ roomId: 'room-3', startMs: at(9), endMs: at(11), rooms: ['room-3', 'room-4', 'room-5'], busy: (r) => busy.get(r) ?? new Set() })
    expect(alts[0]).toEqual({ from: '2026-12-01T11:00:00Z', to: '2026-12-01T13:00:00Z' })
    expect(alts.some((a) => a.room === 'room-5')).toBe(true)
    expect(alts.some((a) => a.room === 'room-4')).toBe(false) // room 4 is busy 9–10
  })
  it('suggests nothing when the rest of the day is full', () => {
    const all = new Set(slotsOf(at(8), at(20)))
    expect(alternatives({ roomId: 'a', startMs: at(9), endMs: at(11), rooms: ['a'], busy: () => all })).toEqual([])
  })
  it('makes references without look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(makeRef()).toMatch(/^SL-[A-HJ-NP-Z2-9]{6}$/)
  })
})
