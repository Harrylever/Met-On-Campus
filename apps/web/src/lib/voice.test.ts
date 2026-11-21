import { describe, expect, it } from 'vitest'
import { blockedAmong, joinState, latestEndsAt } from './voice'

describe('joinState', () => {
  it('joinState is upcoming before start, live at start, ended at end and when cancelled', () => {
    const room = { startsAt: '2026-11-21T10:00:00.000Z', endsAt: '2026-11-21T11:00:00.000Z', cancelled: false }
    expect(joinState(room, new Date('2026-11-21T09:59:59.999Z'))).toBe('upcoming')
    expect(joinState(room, new Date('2026-11-21T10:00:00.000Z'))).toBe('live')
    expect(joinState(room, new Date('2026-11-21T10:30:00.000Z'))).toBe('live')
    expect(joinState(room, new Date('2026-11-21T11:00:00.000Z'))).toBe('ended')
    expect(joinState({ ...room, cancelled: true }, new Date('2026-11-21T10:30:00.000Z'))).toBe('ended')
    expect(joinState({ ...room, cancelled: true }, new Date('2026-11-21T09:00:00.000Z'))).toBe('ended')
  })
})

describe('blockedAmong', () => {
  it('blockedAmong returns only ids in the blocked set', () => {
    expect(blockedAmong(['a', 'b', 'c'], new Set(['b', 'z']))).toEqual(['b'])
    expect(blockedAmong(['a', 'b'], new Set())).toEqual([])
    expect(blockedAmong([], new Set(['a']))).toEqual([])
  })
})

describe('latestEndsAt', () => {
  const fallback = '2026-11-21T11:00:00.000Z'
  it('latestEndsAt uses the latest rooms-list row for the call, so an extension moves the end', () => {
    const rooms = [{ id: 'a', endsAt: '2026-11-21T12:00:00.000Z' }, { id: 'b', endsAt: new Date('2026-11-21T11:30:00.000Z') }]
    expect(latestEndsAt(rooms, 'b', fallback)).toBe('2026-11-21T11:30:00.000Z')
    expect(latestEndsAt(rooms, 'a', fallback)).toBe('2026-11-21T12:00:00.000Z')
  })
  it('latestEndsAt falls back to the join-time copy when the list is missing or lacks the room', () => {
    expect(latestEndsAt(undefined, 'a', fallback)).toBe(fallback)
    expect(latestEndsAt([{ id: 'x', endsAt: '2026-11-21T12:00:00.000Z' }], 'a', fallback)).toBe(fallback)
  })
})
