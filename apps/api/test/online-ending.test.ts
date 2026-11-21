import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { roomMembers, rooms, users } from '@moc/db'
import { and, eq } from 'drizzle-orm'
import { bus, db } from '../src/context'
import { setLiveKit, roomName } from '../src/livekit'
import { enforceLiveMembership, runSweepPass, sweepEndedRooms } from '../src/roomsweep'
import { adminCall, adminLogin, call, fakeLiveKit, makeAdmin, makeUser, resetAll, type TestUser } from './helpers'

let fake: ReturnType<typeof fakeLiveKit>
beforeEach(async () => { await resetAll(); fake = fakeLiveKit(); setLiveKit(fake) })
afterEach(() => { setSystemTime(); bus.attach(() => {}) })

const H = 3600_000, MIN = 60_000
async function makeRoom(host: TestUser, o: Partial<typeof rooms.$inferInsert> = {}) {
  const now = Date.now()
  const [r] = await db.insert(rooms).values({
    intent: 'study', tag: 'CSS 411', title: 'Late night', place: 'Online', mode: 'online', capacity: 3,
    startsAt: new Date(now - H), endsAt: new Date(now + H), hostId: host.id, university: host.university, ...o,
  }).returning()
  await db.insert(roomMembers).values({ roomId: r!.id, userId: host.id, status: 'approved' })
  return r!
}
const member = (room: { id: string }, u: TestUser, status: 'pending' | 'approved' | 'declined' = 'approved') =>
  db.insert(roomMembers).values({ roomId: room.id, userId: u.id, status })
const remove = (host: TestUser, room: { id: string }, u: { id: string }) => call(host, 'POST', `/rooms/${room.id}/members/${u.id}/remove`)
const statusOf = async (room: { id: string }, u: { id: string }) =>
  (await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, u.id))))[0]

describe('the sweep', () => {
  test('the sweep closes the call of a room that has just ended and not one still live or ended long ago', async () => {
    const host = await makeUser('Host', { premium: true })
    const justEnded = await makeRoom(host, { endsAt: new Date(Date.now() - 5 * MIN) })
    await makeRoom(host, { endsAt: new Date(Date.now() + H) })
    await makeRoom(host, { endsAt: new Date(Date.now() - 2 * H) })
    await makeRoom(host, { endsAt: new Date(Date.now() - 2 * H), cancelledAt: new Date(Date.now() - 3 * H) })
    await makeRoom(host, { mode: 'physical', place: 'Library', endsAt: new Date(Date.now() - 5 * MIN) })
    expect(await sweepEndedRooms()).toBe(1)
    expect(fake.closed).toEqual([roomName(justEnded.id)])
  })

  test('the sweep survives LiveKit failing and reports the rest', async () => {
    const host = await makeUser('Host', { premium: true })
    await makeRoom(host, { endsAt: new Date(Date.now() - 2 * MIN) })
    await makeRoom(host, { endsAt: new Date(Date.now() - 3 * MIN) })
    fake.failNext()
    expect(await sweepEndedRooms()).toBe(1)
    expect(fake.closed).toHaveLength(1)
  })
})

describe('the sweep and cancelled rooms', () => {
  test('a cancelled online room whose end is still in the future is closed by the sweep', async () => {
    const host = await makeUser('Host', { premium: true })
    const c = await makeRoom(host, { endsAt: new Date(Date.now() + H), cancelledAt: new Date() })
    expect(await sweepEndedRooms()).toBe(1)
    expect(fake.closed).toEqual([roomName(c.id)])
    // and again on the next minute, while the room would still have been running
    expect(await sweepEndedRooms(new Date(Date.now() + MIN))).toBe(1)
  })

  test('a cancelled online room that ended recently is still closed, until 15 minutes after its original end', async () => {
    const host = await makeUser('Host', { premium: true })
    const c = await makeRoom(host, { endsAt: new Date(Date.now() - 5 * MIN), cancelledAt: new Date(Date.now() - H) })
    expect(await sweepEndedRooms()).toBe(1)
    expect(fake.closed).toEqual([roomName(c.id)])
    fake.closed.length = 0
    expect(await sweepEndedRooms(new Date(Date.now() + 11 * MIN))).toBe(0)
    expect(fake.closed).toHaveLength(0)
  })

  test('a cancelled online room that ended long ago is not touched', async () => {
    const host = await makeUser('Host', { premium: true })
    await makeRoom(host, { endsAt: new Date(Date.now() - 2 * H), cancelledAt: new Date(Date.now() - 3 * H) })
    await makeRoom(host, { mode: 'physical', place: 'Library', endsAt: new Date(Date.now() + H), cancelledAt: new Date() })
    expect(await sweepEndedRooms()).toBe(0)
    expect(fake.closed).toHaveLength(0)
  })

  test('a close that failed at cancel time is retried by the next sweep', async () => {
    const host = await makeUser('Host', { premium: true })
    const room = await makeRoom(host)
    fake.failNext()
    expect((await call(host, 'DELETE', `/rooms/${room.id}`)).status).toBe(200)
    expect(fake.closed).toHaveLength(0)
    expect(await sweepEndedRooms()).toBe(1)
    expect(fake.closed).toEqual([roomName(room.id)])
  })
})

describe('the sweep pass', () => {
  test('the sweep skips entirely when LiveKit is not configured', async () => {
    const host = await makeUser('Host', { premium: true }), out = await makeUser('Out')
    await makeRoom(host, { endsAt: new Date(Date.now() - 5 * MIN) })
    const live = await makeRoom(host)
    fake.setParticipants(roomName(live.id), [{ identity: out.id, name: 'Out' }])
    fake.setConfigured(false)
    const errors: unknown[] = []
    const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a) }
    try { expect(await runSweepPass()).toBe('skipped') } finally { console.error = orig }
    expect(fake.closed).toHaveLength(0); expect(fake.removed).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  test('a pass closes ended calls and enforces membership', async () => {
    const host = await makeUser('Host', { premium: true }), out = await makeUser('Out')
    const ended = await makeRoom(host, { endsAt: new Date(Date.now() - 5 * MIN) })
    const live = await makeRoom(host)
    fake.setParticipants(roomName(live.id), [{ identity: out.id, name: 'Out' }])
    expect(await runSweepPass()).toBe('ran')
    expect(fake.closed).toEqual([roomName(ended.id)])
    expect(fake.removed).toEqual([{ room: roomName(live.id), identity: out.id }])
  })

  test('an overlapping tick is skipped while a pass is still running', async () => {
    const host = await makeUser('Host', { premium: true })
    await makeRoom(host, { endsAt: new Date(Date.now() - 5 * MIN) })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let closes = 0
    setLiveKit({ ...fake, async closeRoom(room: string) { closes++; await gate; await fake.closeRoom(room) } })
    const first = runSweepPass()
    while (closes === 0) await new Promise((r) => setTimeout(r, 5))
    expect(await runSweepPass()).toBe('skipped')
    release()
    expect(await first).toBe('ran')
    expect(closes).toBe(1)
    expect(await runSweepPass()).toBe('ran')
    expect(closes).toBe(2)
  })
})

describe('removing a member', () => {
  test('the host can remove an approved member: status becomes declined, the member is disconnected, gets a room.decision declined event, capacity is freed', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann'), bob = await makeUser('Bob'), cy = await makeUser('Cy')
    const room = await makeRoom(host); await member(room, ann); await member(room, bob)
    await member(room, cy, 'pending')
    expect((await call(host, 'POST', `/rooms/${room.id}/requests/${cy.id}`, { decision: 'approved' })).json.error).toBe('room_full')
    const seen: { topic: string; payload: any }[] = []
    bus.attach((topic, payload) => seen.push({ topic, payload }))
    const r = await remove(host, room, ann)
    expect(r.status).toBe(200)
    const row = await statusOf(room, ann)
    expect(row!.status).toBe('declined'); expect(row!.decisionSeenAt).toBeNull()
    expect(fake.removed).toEqual([{ room: roomName(room.id), identity: ann.id }])
    expect(seen).toContainEqual({ topic: `user:${ann.id}`, payload: { type: 'room.decision', roomId: room.id, decision: 'declined' } })
    expect((await call(host, 'POST', `/rooms/${room.id}/requests/${cy.id}`, { decision: 'approved' })).status).toBe(200)
  })

  test('a removed member cannot join and cannot request again', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann')
    const room = await makeRoom(host); await member(room, ann)
    await remove(host, room, ann)
    const j = await call(ann, 'POST', `/rooms/${room.id}/join`)
    expect(j.status).toBe(403); expect(j.json.error).toBe('not_a_member')
    await call(ann, 'POST', `/rooms/${room.id}/request`)
    expect((await statusOf(room, ann))!.status).toBe('declined')
    expect((await call(ann, 'POST', `/rooms/${room.id}/join`)).status).toBe(403)
  })

  test('a failed disconnect answers 502 voice_unavailable and the member is still declined and cannot join', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann')
    const room = await makeRoom(host); await member(room, ann)
    fake.failNext()
    const r = await remove(host, room, ann)
    expect(r.status).toBe(502); expect(r.json.error).toBe('voice_unavailable')
    expect((await statusOf(room, ann))!.status).toBe('declined')
    expect((await call(ann, 'POST', `/rooms/${room.id}/join`)).status).toBe(403)
  })

  test('retrying after a failed disconnect succeeds, disconnects them, and sends no second room.decision', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann')
    const room = await makeRoom(host); await member(room, ann)
    const seen: { topic: string; payload: any }[] = []
    bus.attach((topic, payload) => seen.push({ topic, payload }))
    fake.failNext()
    expect((await remove(host, room, ann)).status).toBe(502)
    await db.update(roomMembers).set({ decisionSeenAt: new Date() }).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, ann.id)))
    const before = await statusOf(room, ann)
    expect((await remove(host, room, ann)).status).toBe(200)
    expect(fake.removed).toEqual([{ room: roomName(room.id), identity: ann.id }])
    const after = await statusOf(room, ann)
    expect(after!.status).toBe('declined'); expect(after!.decisionSeenAt).toEqual(before!.decisionSeenAt)
    expect(seen.filter((s) => s.payload.type === 'room.decision')).toHaveLength(1)
  })

  test('the host cannot remove themselves (422)', async () => {
    const host = await makeUser('Host', { premium: true }); const room = await makeRoom(host)
    expect((await remove(host, room, host)).status).toBe(422)
    expect((await statusOf(room, host))!.status).toBe('approved')
  })

  test('a non-host gets 403 host_only', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann'), bob = await makeUser('Bob')
    const room = await makeRoom(host); await member(room, ann); await member(room, bob)
    const r = await remove(ann, room, bob)
    expect(r.status).toBe(403); expect(r.json.error).toBe('host_only')
    expect((await statusOf(room, bob))!.status).toBe('approved')
    expect(fake.removed).toHaveLength(0)
  })

  test('removing someone who is not approved is 404', async () => {
    const host = await makeUser('Host', { premium: true }), pen = await makeUser('Pen'), out = await makeUser('Out')
    const room = await makeRoom(host); await member(room, pen, 'pending')
    expect((await remove(host, room, pen)).status).toBe(404)
    expect((await remove(host, room, out)).status).toBe(404)
    const phys = await makeRoom(host, { mode: 'physical', place: 'Library' }); await member(phys, out)
    expect((await remove(host, phys, out)).status).toBe(404)
    expect((await statusOf(phys, out))!.status).toBe('approved')
    expect(fake.removed).toHaveLength(0)
  })
})

describe('cancelling', () => {
  test('cancelling an online room closes its call, and cancelling still succeeds if LiveKit fails', async () => {
    const host = await makeUser('Host', { premium: true })
    const a = await makeRoom(host)
    expect((await call(host, 'DELETE', `/rooms/${a.id}`)).status).toBe(200)
    expect(fake.closed).toEqual([roomName(a.id)])
    const b = await makeRoom(host)
    fake.failNext()
    expect((await call(host, 'DELETE', `/rooms/${b.id}`)).status).toBe(200)
    expect((await db.select().from(rooms).where(eq(rooms.id, b.id)))[0]!.cancelledAt).not.toBeNull()
    const phys = await makeRoom(host, { mode: 'physical', place: 'Library' })
    await call(host, 'DELETE', `/rooms/${phys.id}`)
    expect(fake.closed).toEqual([roomName(a.id)])
  })
})

describe('suspending', () => {
  test('suspending a student removes them from live calls they are in', async () => {
    const host = await makeUser('Host', { premium: true }), bad = await makeUser('Bad')
    const live = await makeRoom(host); await member(live, bad)
    const later = await makeRoom(host, { startsAt: new Date(Date.now() + H), endsAt: new Date(Date.now() + 2 * H) }); await member(later, bad)
    const notIn = await makeRoom(host); await member(notIn, bad, 'pending')
    const S = await adminLogin(await makeAdmin())
    const rep = (await call(host, 'POST', '/reports', { userId: bad.id, reason: 'harassment' })).json.id as string
    const r = await adminCall('POST', `/admin/reports/${rep}/resolve`, { action: 'suspend', note: 'Repeated harassment of students' }, { session: S })
    expect(r.status).toBe(200)
    expect(fake.removed).toEqual([{ room: roomName(live.id), identity: bad.id }])
  })

  test('suspension still succeeds if LiveKit fails', async () => {
    const host = await makeUser('Host', { premium: true }), bad = await makeUser('Bad')
    const live = await makeRoom(host); await member(live, bad)
    const S = await adminLogin(await makeAdmin())
    const rep = (await call(host, 'POST', '/reports', { userId: bad.id, reason: 'harassment' })).json.id as string
    fake.failNext()
    const r = await adminCall('POST', `/admin/reports/${rep}/resolve`, { action: 'suspend', note: 'Repeated harassment of students' }, { session: S })
    expect(r.status).toBe(200)
    expect((await call(bad, 'GET', '/me')).status).toBe(401)
  })
})

describe('membership enforcement', () => {
  const here = (room: { id: string }, ...us: { id: string; name: string }[]) =>
    fake.setParticipants(roomName(room.id), us.map((u) => ({ identity: u.id, name: u.name })))

  test('a removed member who reconnects with their still-valid token is kicked on the next enforcement pass', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann')
    const room = await makeRoom(host); await member(room, ann)
    await remove(host, room, ann)
    fake.removed.length = 0
    here(room, host, ann)
    expect(await enforceLiveMembership()).toBe(1)
    expect(fake.removed).toEqual([{ room: roomName(room.id), identity: ann.id }])
  })

  test('a participant who was never a member (or only pending) is kicked', async () => {
    const host = await makeUser('Host', { premium: true }), out = await makeUser('Out'), pen = await makeUser('Pen')
    const room = await makeRoom(host); await member(room, pen, 'pending')
    here(room, host, out, pen)
    expect(await enforceLiveMembership()).toBe(2)
    expect(fake.removed.map((r) => r.identity).sort()).toEqual([out.id, pen.id].sort())
  })

  test('a suspended student still present is kicked', async () => {
    const host = await makeUser('Host', { premium: true }), bad = await makeUser('Bad')
    const room = await makeRoom(host); await member(room, bad)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, bad.id))
    here(room, host, bad)
    expect(await enforceLiveMembership()).toBe(1)
    expect(fake.removed).toEqual([{ room: roomName(room.id), identity: bad.id }])
  })

  test('approved members and the host are left alone', async () => {
    const host = await makeUser('Host', { premium: true }), ann = await makeUser('Ann')
    const room = await makeRoom(host); await member(room, ann)
    here(room, host, ann)
    expect(await enforceLiveMembership()).toBe(0)
    expect(fake.removed).toHaveLength(0)
  })

  test('a non-UUID identity is left alone and does not break the pass', async () => {
    const host = await makeUser('Host', { premium: true }), out = await makeUser('Out')
    const room = await makeRoom(host)
    here(room, { id: 'egress-recorder', name: 'Rec' }, out)
    expect(await enforceLiveMembership()).toBe(1)
    expect(fake.removed).toEqual([{ room: roomName(room.id), identity: out.id }])
  })

  test('one failing room does not stop the pass', async () => {
    const host = await makeUser('Host', { premium: true }), o1 = await makeUser('One'), o2 = await makeUser('Two')
    const a = await makeRoom(host), b = await makeRoom(host)
    here(a, o1); here(b, o2)
    fake.failNext() // the first participants() call throws
    expect(await enforceLiveMembership()).toBe(1)
    expect(fake.removed).toHaveLength(1)
  })
})
