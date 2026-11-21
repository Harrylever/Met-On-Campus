import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { blocks, roomMembers, rooms, users } from '@moc/db'
import { eq } from 'drizzle-orm'
import { db } from '../src/context'
import { setLiveKit, roomName } from '../src/livekit'
import { call, fakeLiveKit, makeUser, resetAll, type TestUser } from './helpers'

let fake: ReturnType<typeof fakeLiveKit>
beforeEach(async () => { await resetAll(); fake = fakeLiveKit(); setLiveKit(fake) })
afterEach(() => setSystemTime())

const H = 3600_000
async function makeRoom(host: TestUser, o: Partial<typeof rooms.$inferInsert> = {}) {
  const now = Date.now()
  const [r] = await db.insert(rooms).values({
    intent: 'study', tag: 'CSS 411', title: 'Late night', place: 'Online', mode: 'online', capacity: 6,
    startsAt: new Date(now - H), endsAt: new Date(now + H), hostId: host.id, university: host.university, ...o,
  }).returning()
  await db.insert(roomMembers).values({ roomId: r!.id, userId: host.id, status: 'approved' })
  return r!
}
const member = (room: { id: string }, u: TestUser, status: 'pending' | 'approved' | 'declined' = 'approved') =>
  db.insert(roomMembers).values({ roomId: room.id, userId: u.id, status })
const join = (u: TestUser, room: { id: string }, body?: unknown) => call(u, 'POST', `/rooms/${room.id}/join`, body)

describe('joining a live online room', () => {
  test('an approved member gets a url and a token whose expiry is the room end', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    const ann = await makeUser('Ann'); await member(room, ann)
    const r = await join(ann, room)
    expect(r.status).toBe(200)
    expect(r.json.url).toBe('wss://livekit.test')
    expect(r.json.token).toBe(`fake-token:${roomName(room.id)}:${ann.id}`)
    expect(fake.tokens).toHaveLength(1)
    expect(fake.tokens[0]!.expiresAt.getTime()).toBe(room.endsAt.getTime())
    expect(fake.tokens[0]!.name).toBe('Ann')
    expect(fake.ensured).toEqual([{ room: roomName(room.id), maxParticipants: 50 }])
  })

  test('raising capacity mid-call does not lower the call\'s participant limit', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    expect((await join(host, room)).status).toBe(200)
    expect((await call(host, 'PATCH', `/rooms/${room.id}`, { capacity: 10 })).status).toBe(200)
    const ann = await makeUser('Ann'); await member(room, ann)
    expect((await join(ann, room)).status).toBe(200)
    expect(fake.ensured.map((e) => e.maxParticipants)).toEqual([50, 50])
  })

  test('the host can join', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    const r = await join(host, room)
    expect(r.status).toBe(200)
    expect(r.json.token).toContain(host.id)
  })

  test('a pending, declined or unrelated student gets 403 not_a_member', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    const p = await makeUser('Pen'), d = await makeUser('Dec'), o = await makeUser('Out')
    await member(room, p, 'pending'); await member(room, d, 'declined')
    for (const u of [p, d, o]) {
      const r = await join(u, room)
      expect(r.status).toBe(403)
      expect(r.json.error).toBe('not_a_member')
    }
    expect(fake.tokens).toHaveLength(0)
  })

  test('joining at exactly startsAt works, one second before is 409 not_live_yet', async () => {
    const host = await makeUser('Host', { premium: true })
    const startsAt = new Date(Math.floor((Date.now() + H) / 1000) * 1000)
    const room = await makeRoom(host, { startsAt, endsAt: new Date(startsAt.getTime() + 2 * H) })
    setSystemTime(new Date(startsAt.getTime() - 1000))
    const early = await join(host, room)
    expect(early.status).toBe(409)
    expect(early.json.error).toBe('not_live_yet')
    expect(fake.tokens).toHaveLength(0)
    setSystemTime(startsAt)
    expect((await join(host, room)).status).toBe(200)
  })

  test('joining at exactly endsAt is 409 ended', async () => {
    const host = await makeUser('Host', { premium: true })
    const endsAt = new Date(Math.floor((Date.now() + H) / 1000) * 1000)
    const room = await makeRoom(host, { endsAt })
    setSystemTime(new Date(endsAt.getTime() - 1))
    expect((await join(host, room)).status).toBe(200)
    setSystemTime(endsAt)
    const r = await join(host, room)
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('ended')
    expect(fake.tokens).toHaveLength(1)
  })

  test('a cancelled room is 409 cancelled', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host, { cancelledAt: new Date() })
    const r = await join(host, room)
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('cancelled')
    expect(fake.tokens).toHaveLength(0)
  })

  test("a physical room, another campus's room, or a room whose host is blocked with the caller is 404 not_found", async () => {
    const host = await makeUser('Host', { premium: true })
    const phys = await makeRoom(host, { mode: 'physical', place: 'Library' })
    const ok = await makeRoom(host)
    const stranger = await makeUser('Far', { university: 'unilag' })
    const blocker = await makeUser('Blk'); await member(ok, blocker)
    await db.insert(blocks).values({ blockerId: blocker.id, blockedId: host.id })
    const blocked = await makeUser('Blkd'); await member(ok, blocked)
    await db.insert(blocks).values({ blockerId: host.id, blockedId: blocked.id })
    const insider = await makeUser('Ins'); await member(phys, insider)
    await db.insert(roomMembers).values({ roomId: ok.id, userId: stranger.id, status: 'approved' })
    const cases = [await join(insider, phys), await join(stranger, ok), await join(blocker, ok), await join(blocked, ok), await call(insider, 'POST', '/rooms/00000000-0000-4000-8000-000000000000/join')]
    for (const r of cases) { expect(r.status).toBe(404); expect(r.json.error).toBe('not_found') }
    expect(fake.tokens).toHaveLength(0)
  })

  test('without LiveKit configured it is 503 online_unavailable', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    fake.setConfigured(false)
    const r = await join(host, room)
    expect(r.status).toBe(503)
    expect(r.json.error).toBe('online_unavailable')
    expect(fake.tokens).toHaveLength(0)
  })

  test('when LiveKit fails the answer is 502 voice_unavailable and no token is issued', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    fake.failNext() // fails participants()
    const a = await join(host, room)
    expect(a.status).toBe(502); expect(a.json.error).toBe('voice_unavailable')
    // A failure at ensureRoom or issueToken also fails closed.
    for (const method of ['ensureRoom', 'issueToken'] as const) {
      const orig = fake[method].bind(fake) as any
      ;(fake as any)[method] = async () => { throw new Error('boom') }
      const r = await join(host, room)
      expect(r.status).toBe(502); expect(r.json.error).toBe('voice_unavailable')
      ;(fake as any)[method] = orig
    }
    expect(fake.tokens).toHaveLength(0)
    expect((await join(host, room)).status).toBe(200)
  })

  test('the 31st join in an hour is 429', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    for (let i = 0; i < 30; i++) expect((await join(host, room)).status).toBe(200)
    expect((await join(host, room)).status).toBe(429)
  })

  test('block prompt: if someone the caller blocked is in the call the answer is 409 blocked_present with names only, and repeating with acknowledgeBlocked true returns the token', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    const ann = await makeUser('Ann'), bob = await makeUser('Bob'); await member(room, ann); await member(room, bob)
    await db.insert(blocks).values({ blockerId: ann.id, blockedId: bob.id })
    fake.setParticipants(roomName(room.id), [{ identity: bob.id, name: 'Bob' }, { identity: host.id, name: 'Host' }])
    const r = await join(ann, room)
    expect(r.status).toBe(409)
    expect(r.json).toEqual({ error: 'blocked_present', people: [{ name: 'Bob' }] })
    expect(JSON.stringify(r.json)).not.toContain(bob.id)
    expect(fake.tokens).toHaveLength(0)
    const no = await join(ann, room, { acknowledgeBlocked: false })
    expect(no.status).toBe(409)
    const ok = await join(ann, room, { acknowledgeBlocked: true })
    expect(ok.status).toBe(200)
    expect(ok.json.token).toContain(ann.id)
  })

  test('a caller who was blocked BY someone in the call joins normally with no mention of it', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    const ann = await makeUser('Ann'), bob = await makeUser('Bob'); await member(room, ann); await member(room, bob)
    await db.insert(blocks).values({ blockerId: bob.id, blockedId: ann.id })
    fake.setParticipants(roomName(room.id), [{ identity: bob.id, name: 'Bob' }])
    const r = await join(ann, room)
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).not.toContain('Bob')
  })

  test('a host who lost premium after creating the room can still be joined', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    await db.update(users).set({ premiumUntil: new Date(Date.now() - 1000) }).where(eq(users.id, host.id))
    const ann = await makeUser('Ann'); await member(room, ann)
    expect((await join(ann, room)).status).toBe(200)
    expect((await join(host, room)).status).toBe(200)
  })
})
