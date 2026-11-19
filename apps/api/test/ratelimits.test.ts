import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { redis } from '../src/context'
import { onPresenceFrame } from '../src/ws'
import * as presence from '../src/presence'
import { call, makeUser, resetAll, type TestUser } from './helpers'

let me: TestUser, pal: TestUser
beforeEach(async () => { await resetAll(); me = await makeUser('Amina'); pal = await makeUser('Tunde') })

/** Where a limit's counter lives: one per student, per rule, per window. */
const key = (u: { id: string }, name: string, windowSec: number) => `rl:rate:${u.id}:${name}:${windowSec}`
const setCount = (u: { id: string }, name: string, windowSec: number, n: number) => redis.set(key(u, name, windowSec), n, 'EX', windowSec)
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString()

// One row per limit: how to make the request, the rule it belongs to, and the cap. The request only has to get past the
// limiter (a 404 or 409 afterwards is fine); what matters is that the cap-th request is not refused and the next one is.
type Row = { label: string; name: string; windowSec: number; cap: number; run: () => Promise<{ status: number; json: any; headers: Headers }> }
const rows = (ctx: { room: string; conv: string }): Row[] => [
  { label: 'invites, 10 per 10 minutes', name: 'invite', windowSec: 600, cap: 10, run: () => call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' }) },
  { label: 'invites, 40 per day', name: 'invite', windowSec: 86400, cap: 40, run: () => call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' }) },
  { label: 'messages, 30 per minute', name: 'message', windowSec: 60, cap: 30, run: () => call(me, 'POST', `/conversations/${ctx.conv}/messages`, { kind: 'text', body: 'hi' }) },
  { label: 'messages, 600 per hour', name: 'message', windowSec: 3600, cap: 600, run: () => call(me, 'POST', `/conversations/${ctx.conv}/messages`, { kind: 'text', body: 'hi' }) },
  { label: 'meetup proposals, 10 per hour', name: 'meetup', windowSec: 3600, cap: 10, run: () => call(me, 'POST', `/conversations/${ctx.conv}/messages`, { kind: 'meetup', where: 'University Library', when: hours(2) }) },
  { label: 'new rooms, 5 per hour', name: 'roomCreate', windowSec: 3600, cap: 5, run: () => call(me, 'POST', '/rooms', { intent: 'study', tag: 'CSS', title: 'T', place: 'University Library', startsAt: new Date().toISOString(), endsAt: hours(2), capacity: 4 }) },
  { label: 'new rooms, 15 per day', name: 'roomCreate', windowSec: 86400, cap: 15, run: () => call(me, 'POST', '/rooms', { intent: 'study', tag: 'CSS', title: 'T', place: 'University Library', startsAt: new Date().toISOString(), endsAt: hours(2), capacity: 4 }) },
  { label: 'room join requests, 20 per hour', name: 'roomRequest', windowSec: 3600, cap: 20, run: () => call(me, 'POST', `/rooms/${ctx.room}/request`) },
  { label: 'room edits, 20 per hour', name: 'roomEdit', windowSec: 3600, cap: 20, run: () => call(me, 'PATCH', `/rooms/${ctx.room}`, { title: 'Renamed' }) },
  { label: 'Discover, 60 per minute', name: 'discover', windowSec: 60, cap: 60, run: () => call(me, 'GET', '/discover?intent=study') },
  { label: 'profile edits, 30 per hour (details)', name: 'profile', windowSec: 3600, cap: 30, run: () => call(me, 'PATCH', '/me', { level: 300 }) },
  { label: 'profile edits, 30 per hour (a mode)', name: 'profile', windowSec: 3600, cap: 30, run: () => call(me, 'PUT', '/me/profiles/study', { enabled: true }) },
  { label: 'check-in, 20 per hour', name: 'checkin', windowSec: 3600, cap: 20, run: () => call(me, 'POST', '/me/checkin') },
  { label: 'presence heartbeat, 30 per minute', name: 'heartbeat', windowSec: 60, cap: 30, run: () => call(me, 'POST', '/presence', {}) },
  { label: 'blocking, 60 per hour', name: 'block', windowSec: 3600, cap: 60, run: () => call(me, 'POST', '/blocks', { userId: pal.id }) },
  { label: 'everything else, 600 per minute', name: 'global', windowSec: 60, cap: 600, run: () => call(me, 'GET', '/me/progress') },
]

async function scenario() {
  const room = (await call(pal, 'POST', '/rooms', { intent: 'study', tag: 'CSS', title: 'Theirs', place: 'University Library', startsAt: new Date().toISOString(), endsAt: hours(2), capacity: 4 })).json.room.id as string
  const conv = (await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).json.conversationId as string
  // That setup used a few requests of its own; start every test from clean counters.
  for (const k of await redis.keys('rl:rate:*')) await redis.del(k)
  return { room, conv }
}

describe('each limit', () => {
  for (let i = 0; i < 16; i++) {
    test(`row ${i + 1}`, async () => {
      const ctx = await scenario()
      const r = rows(ctx)[i]!
      await setCount(me, r.name, r.windowSec, r.cap - 1)
      expect((await r.run()).status, `${r.label}: the last allowed request`).not.toBe(429)
      const over = await r.run()
      expect(over.status, `${r.label}: one more`).toBe(429)
      expect(over.json.error).toBe('too_many_requests')
      expect(over.json.retryAfter).toBeGreaterThan(0); expect(over.json.retryAfter).toBeLessThanOrEqual(r.windowSec)
      expect(Number(over.headers.get('retry-after'))).toBe(over.json.retryAfter)
    })
  }
})

describe('how they behave', () => {
  test('a real run: the 11th invite in ten minutes is refused, and nothing else of the student is affected', async () => {
    for (let i = 1; i <= 10; i++) expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status, `invite ${i}`).toBe(200)
    expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(429)
    expect((await call(me, 'GET', '/me')).status).toBe(200)                                  // reading is untouched
    expect((await call(me, 'POST', '/rooms', { intent: 'study', tag: 'X', title: 'T', place: 'University Library', startsAt: new Date().toISOString(), endsAt: hours(2), capacity: 4 })).status).toBe(200)
  })

  test('limits are per student: one student hitting a cap does not slow anyone else', async () => {
    await setCount(me, 'invite', 600, 10)
    expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(429)
    const third = await makeUser('Chidi')
    expect((await call(third, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(200)
  })

  test('a refused request is not performed', async () => {
    await setCount(me, 'invite', 600, 10)
    await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })
    expect((await call(pal, 'GET', '/me/unread')).json).toMatchObject({ requests: 0, total: 0 })   // nobody was invited
  })

  test('the window resets: after it expires the student can act again', async () => {
    await setCount(me, 'invite', 600, 10)
    expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(429)
    await redis.del(key(me, 'invite', 600))                                                  // what the expiry does
    expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(200)
  })

  test('if Redis fails the app keeps working: requests are let through', async () => {
    const down = spyOn(redis, 'incr').mockRejectedValue(new Error('redis down'))
    try {
      expect((await call(me, 'GET', '/me/progress')).status).toBe(200)
      expect((await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).status).toBe(200)
    } finally { down.mockRestore() }
  })

  test('the on-campus heartbeat over the socket is silently ignored past 30 a minute', async () => {
    await onPresenceFrame(me, 'Library'); expect(await presence.here(me.university)).toContain(me.id)
    await presence.leave(me.university, me.id)
    await setCount(me, 'heartbeat', 60, 30)
    await onPresenceFrame(me, 'Library')
    expect(await presence.here(me.university)).not.toContain(me.id)
  })
})
