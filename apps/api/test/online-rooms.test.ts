import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { rooms, users } from '@moc/db'
import { db } from '../src/context'
import { setLiveKit } from '../src/livekit'
import { call, fakeLiveKit, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const online = (o: Record<string, unknown> = {}) => ({ intent: 'study', mode: 'online', tag: 'CSS 411', title: 'Late night', startsAt: at(0), endsAt: at(2), capacity: 6, ...o })
const roomCount = async () => (await db.select().from(rooms)).length

describe('creating online rooms', () => {
  test('a premium host creates an online room, place is "Online" and mode is online', async () => {
    const host = await makeUser('Host', { premium: true })
    const r = await call(host, 'POST', '/rooms', online())
    expect(r.status).toBe(200)
    expect(r.json.room.mode).toBe('online')
    expect(r.json.room.place).toBe('Online')
  })

  test('a non-premium host can create an online room of exactly 5 minutes', async () => {
    const host = await makeUser('Host')
    const r = await call(host, 'POST', '/rooms', online({ endsAt: inMin(5) }))
    expect(r.status).toBe(200)
    expect(r.json.room.mode).toBe('online')
    expect(r.json.room.place).toBe('Online')
  })

  test('a non-premium host is refused an online room longer than 5 minutes with 422 online_too_long and maxMinutes 5', async () => {
    const host = await makeUser('Host')
    const r = await call(host, 'POST', '/rooms', online({ endsAt: inMin(6) }))
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('online_too_long')
    expect(r.json.maxMinutes).toBe(5)
    expect(await roomCount()).toBe(0)
  })

  test('a lapsed-premium host gets the free 5 minute cap when creating', async () => {
    const host = await makeUser('Host', { premium: true })
    await db.update(users).set({ premiumUntil: new Date(Date.now() - 1000) }).where(eq(users.id, host.id))
    const r = await call(host, 'POST', '/rooms', online({ endsAt: at(2) }))
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('online_too_long')
  })

  test('creating an online room fails with 503 online_unavailable when LiveKit is not configured', async () => {
    const fake = fakeLiveKit(); fake.setConfigured(false); setLiveKit(fake)
    const host = await makeUser('Host', { premium: true })
    const r = await call(host, 'POST', '/rooms', online())
    expect(r.status).toBe(503)
    expect(r.json.error).toBe('online_unavailable')
    expect(await roomCount()).toBe(0)
  })

  test('a premium host can create a 4 hour online room but not a longer one (422 online_too_long, maxMinutes 240)', async () => {
    const host = await makeUser('Host', { premium: true })
    expect((await call(host, 'POST', '/rooms', online({ endsAt: at(4) }))).status).toBe(200)
    const r = await call(host, 'POST', '/rooms', online({ endsAt: at(5) }))
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('online_too_long')
    expect(r.json.maxMinutes).toBe(240)
    expect(await roomCount()).toBe(1)
  })

  test('a physical room still needs a place (422 place_required) and works for non-premium hosts', async () => {
    const host = await makeUser('Host')
    const base = { intent: 'study', tag: 'CSS 411', title: 'Library', startsAt: at(0), endsAt: at(2), capacity: 4 }
    const bad = await call(host, 'POST', '/rooms', base)
    expect(bad.status).toBe(422)
    expect(bad.json.error).toBe('place_required')
    const ok = await call(host, 'POST', '/rooms', { ...base, place: 'University Library' })
    expect(ok.status).toBe(200)
    expect(ok.json.room.mode).toBe('physical')
    expect(ok.json.room.place).toBe('University Library')
  })

  test('the rooms list includes mode', async () => {
    const host = await makeUser('Host', { premium: true })
    await call(host, 'POST', '/rooms', online())
    await call(host, 'POST', '/rooms', { intent: 'study', tag: 'X', title: 'Phys', place: 'Library', startsAt: at(0), endsAt: at(2), capacity: 4 })
    const list = (await call(host, 'GET', '/rooms?intent=study')).json.rooms as any[]
    expect(list.map((r) => r.mode).sort()).toEqual(['online', 'physical'])
  })
})

describe('editing online rooms', () => {
  test('editing an online room refuses a new place (422 place_locked), refuses stretching it past 4 hours, and ignores a mode change', async () => {
    const host = await makeUser('Host', { premium: true })
    const id = (await call(host, 'POST', '/rooms', online())).json.room.id as string
    const p = await call(host, 'PATCH', `/rooms/${id}`, { place: 'Library' })
    expect(p.status).toBe(422); expect(p.json.error).toBe('place_locked')
    const long = await call(host, 'PATCH', `/rooms/${id}`, { endsAt: at(5) })
    expect(long.status).toBe(422); expect(long.json.error).toBe('online_too_long')
    const m = await call(host, 'PATCH', `/rooms/${id}`, { mode: 'physical', title: 'Renamed' })
    expect(m.status).toBe(200)
    expect(m.json.room.mode).toBe('online'); expect(m.json.room.place).toBe('Online'); expect(m.json.room.title).toBe('Renamed')
  })

  test('a host whose premium has lapsed keeps their long online room: renaming it with the same times works', async () => {
    const host = await makeUser('Host', { premium: true })
    const created = (await call(host, 'POST', '/rooms', online({ endsAt: at(3) }))).json.room
    await db.update(users).set({ premiumUntil: new Date(Date.now() - 1000) }).where(eq(users.id, host.id))
    const r = await call(host, 'PATCH', `/rooms/${created.id}`, { title: 'Still mine', startsAt: created.startsAt, endsAt: created.endsAt })
    expect(r.status).toBe(200)
    expect(r.json.room.title).toBe('Still mine')
    expect(r.json.room.mode).toBe('online')
  })

  test('once premium has lapsed, changing the times is held to 5 minutes: longer is refused, shorter is allowed', async () => {
    const host = await makeUser('Host', { premium: true })
    const id = (await call(host, 'POST', '/rooms', online({ endsAt: at(3) }))).json.room.id as string
    await db.update(users).set({ premiumUntil: new Date(Date.now() - 1000) }).where(eq(users.id, host.id))
    const longer = await call(host, 'PATCH', `/rooms/${id}`, { endsAt: at(4) })
    expect(longer.status).toBe(422); expect(longer.json.error).toBe('online_too_long'); expect(longer.json.maxMinutes).toBe(5)
    const shorter = await call(host, 'PATCH', `/rooms/${id}`, { endsAt: inMin(3) })
    expect(shorter.status).toBe(200)
  })

  test('a non-premium host cannot stretch their 5 minute online room past 5 minutes', async () => {
    const host = await makeUser('Host')
    const id = (await call(host, 'POST', '/rooms', online({ endsAt: inMin(5) }))).json.room.id as string
    const r = await call(host, 'PATCH', `/rooms/${id}`, { endsAt: inMin(45) })
    expect(r.status).toBe(422); expect(r.json.error).toBe('online_too_long'); expect(r.json.maxMinutes).toBe(5)
  })
})
